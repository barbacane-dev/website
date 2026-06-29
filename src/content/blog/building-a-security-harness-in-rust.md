---
title: "Building a security harness for complex Rust software"
description: "Memory safety is the easy 30%. The boundaries that actually matter in a complex system, capability sandboxes, artifact integrity, SSRF, auth, are application-level, and Rust won't enforce them for you. Here's how we built a harness that does."
publishDate: 2026-06-30
author: "Nicolas Dreno"
tags: ["barbacane", "rust", "security", "wasm", "testing", "fuzzing", "api-gateway"]
---

*A security boundary you designed but never enforced is not a boundary. It's a comment.*

Barbacane is an API gateway written in Rust. It compiles your OpenAPI and AsyncAPI specs into a sealed `.bca` artifact and runs them with sandboxed WebAssembly plugins. It sits on the request path, which makes it a security boundary by definition: every request into the system passes through it, and a single soft spot is a soft spot for everything behind it.

We recently put the whole codebase through a deep security review and then a hardening pass. The most useful thing I took away wasn't any individual bug. It was a pattern, repeated across subsystems, that I think shows up in most complex software: **the boundaries were designed, documented, even tested for happy-path behavior, but never actually enforced.**

This is the story of what that looks like in a real Rust codebase, and how we built a harness so it stops happening.

---

### Rust gives you the easy 30 percent

The pitch for Rust in infrastructure software is memory safety, and that pitch is real. A whole category of catastrophic bugs, use-after-free, buffer overflows, data races, mostly disappears. For a gateway terminating TLS and parsing untrusted bytes all day, that alone is worth the price of admission.

But memory safety is the easy 30 percent. It's the part the compiler hands you. The boundaries that actually decide whether your system is secure are almost all *application-level*, and the compiler has nothing to say about them:

- A WASM plugin must only reach the host functions it was granted. Rust won't check that. `wasmtime` will happily link every host function into every module unless you tell it not to.
- An untrusted plugin must not make the gateway fetch `http://169.254.169.254/` and hand back your cloud credentials. The borrow checker does not have opinions about SSRF.
- A compiled artifact must be the artifact you signed, not one an attacker swapped on a registry. `Vec<u8>` is `Vec<u8>` whether it's trustworthy or not.
- The admin API must require a credential. Rust will let you serve an unauthenticated `DELETE /projects/{id}` with perfect memory safety.

Every one of these is a policy that lives in *your* code, not the language. And policies rot. Someone writes the capability manifest format, documents it beautifully in an ADR, ships the parser, and then... never wires the enforcement in. The manifest becomes documentation. The system keeps working, because nothing depends on the boundary being real until someone hostile shows up.

When we reviewed our own gateway, that exact shape appeared more than once. A capability system whose validation function was written, tested, exported, and never called. An artifact format with per-plugin checksums that the loader never recomputed. The fix in each case was small. The interesting question was: **how do you make sure it stays fixed, and how do you catch the next one before a reviewer does?**

You build a harness.

---

### A harness, not a checklist

A security checklist is a document. A security harness is code that runs in CI and fails the build when a boundary regresses. The difference matters because checklists describe intentions and harnesses describe reality, and in security only reality counts.

Ours has three layers. None of them is exotic. The discipline is in combining them and in one rule that ties them together: **write the test to assert the secure behavior, not the current behavior.**

That rule is the whole game. If you write a test that passes against today's code, you've documented today's code. If you write a test that asserts what *should* be true, and it fails, you've found a gap, and the day it goes green is the day the gap closed. Red-to-green becomes a forcing function instead of a chore.

---

### Layer 1: boot the real thing and attack it

Unit tests are great for logic and useless for boundaries, because boundaries live in the seams between components. So the first layer is an adversarial integration suite that starts the actual gateway and control plane and then behaves like an attacker.

```rust
// Every mutating control-plane route must reject an unauthenticated caller.
#[tokio::test]
async fn control_plane_requires_auth() {
    let cp = spawn_control_plane().await;
    for (method, path) in MUTATING_ROUTES {
        let status = cp.request_no_token(method, path).await;
        assert_eq!(status, 401, "{method} {path} must require auth");
    }
}

// A plugin must not be able to reach the cloud metadata endpoint.
#[tokio::test]
async fn plugin_egress_blocks_metadata() {
    let gw = spawn_gateway_with_dispatcher("http://169.254.169.254/").await;
    let resp = gw.get("/proxy").await;
    assert_ne!(resp.status, 200, "SSRF to metadata must be blocked");
}
```

These read like a pentest written down. Auth bypass, SSRF, slowloris, oversized and chunked bodies, artifact tampering, capability escape, JWT forgery, spoofed `X-Forwarded-For`. Each category gets a module. Each test asserts the hardened outcome.

The payoff is twofold. First, the obvious one: regression locking. Once a boundary is real, it can never silently become unreal again, because the build goes red. Second, the less obvious one: these tests *document the threat model in executable form*. A new contributor reading `tests/security/ssrf.rs` learns more about what the gateway promises than any prose I could write, and they can't accidentally let the promise lapse.

---

### Layer 2: fuzz the trust boundaries

Integration tests check the boundaries you thought of. Fuzzing finds the ones you didn't, and it's tailor-made for the highest-risk surfaces in a system like this: the parsers and loaders that turn untrusted bytes into structured data.

The candidates pick themselves. Anywhere hostile input crosses into the process is a fuzz target:

- The spec parser (OpenAPI/AsyncAPI in, structured routes out).
- The `.bca` artifact loader (a gzip + tar archive an attacker might hand you).
- The MCP JSON-RPC parser, exposed on the request path.
- The request validator and its percent-decoder.
- The WASM host-memory accessors, where guest-controlled pointers and lengths meet host memory.

`cargo-fuzz` makes each of these a few lines:

```rust
#![no_main]
use libfuzzer_sys::fuzz_target;

fuzz_target!(|data: &[u8]| {
    // Must never panic, hang, or stack-overflow on hostile input.
    let _ = barbacane_compiler::load_artifact_from_bytes(data);
});
```

The bar for a fuzz target is deliberately low and absolute: **it must never panic, abort, hang, or run out of memory, no matter the input.** That sounds modest until you remember that a panic on the request path is a denial of service, and a stack overflow from an unbounded `$ref` chain in a spec is a denial of service you'll only discover when someone submits one. Fuzzing is how you find the decompression bomb and the billion-laughs spec before they find you.

A note on honesty here: fuzz targets that can't reach the real function are theater. When a guest-memory bounds check was buried inline in a 2,000-line file, the right move wasn't to fake a target around it, it was to extract the check into a `pub fn` with a clear contract so the fuzzer could hammer it directly. If you find yourself writing a fuzz target that doesn't actually exercise the dangerous code, that's a signal the dangerous code needs to be refactored into something testable.

---

### Layer 3: verify against ground truth, not your assumptions

This is the lesson I'd most want someone else to take from our hardening pass, because it nearly bit us.

We have a capability model: each plugin declares the host functions it needs in a manifest, and the runtime is supposed to reject a plugin that imports anything it didn't declare. Turning enforcement on sounds trivial, until you realize the official plugins' manifests had drifted into three incompatible dialects over time, and flipping the switch naively would have rejected most of them at load. The gateway would have "secured" itself into not working.

The instinct is to fix the manifests by reading the source. **Don't trust the source.** I started by grepping each plugin for its `extern` host-function declarations, and it lied to me. One plugin declared its HTTP imports through `#[link_name]` aliases that a naive grep missed entirely; another imported a time function the host didn't even provide, dead-code-eliminated away at build time so it never mattered. Source is what the author wrote. It is not what the machine runs.

So I derived the truth from the artifact instead. Build every plugin to wasm, then read the actual import section of each compiled module:

```rust
for payload in Parser::new(0).parse_all(&wasm) {
    if let Payload::ImportSection(reader) = payload? {
        for import in reader {
            let import = import?;
            if import.module == "barbacane" {
                imports.push(import.name.to_string());
            }
        }
    }
}
```

With the real imports in hand, computing the minimal capability set per plugin became mechanical, and I could *prove* the migration was safe before changing anything: for all 33 plugins, do the declared capabilities cover exactly the imports the compiled module actually makes? Zero gaps, zero over-grants, verified against the bytes that will actually run. Only then did I turn enforcement on.

The general principle: when you secure a boundary in a system that's already shipping, your verification has to run against what the system *does*, not what you believe it does. Source code, comments, and your own mental model are all hypotheses. The artifact is the evidence.

---

### Make the default fail closed, then test the closed path

A harness checks behavior, but it can only check the behavior you ship. The other half of the work is choosing defaults that fail closed, because a boundary that's off by default is off in most deployments.

Concretely, that meant a set of deliberately breaking changes: the control plane now refuses to start without an admin token rather than serving an open API; `file://` secret references must be confined to a configured directory rather than reading any path on disk; plugin egress to internal addresses is denied unless explicitly allowed; an MCP session is required rather than optional. Each one can be loosened by an operator who knows what they're doing. None of them is loose by accident.

Fail-closed defaults are only trustworthy if you test the closed path, which is easy to forget. It's natural to test that a valid token works. It's the test that *no* token returns 401, that a `..` traversal is rejected, that the metadata IP is blocked, that catches the regression. The negative test is the one that matters.

---

### Testability is a security property

One last lesson, because it surprised me. The first version of our SSRF guard read its allow-flag from a global, cached on first use. It worked, and it was almost impossible to test, because one test setting the flag would poison every other test in the process. The race made the suite flaky, and a flaky security test is one you'll eventually delete.

The fix was to move the flag onto the client's own config instead of a global. Suddenly each test could construct exactly the client it needed, the flakiness vanished, and as a bonus the code got more honest: the SSRF policy now visibly belongs to the thing making the request. Global mutable state isn't just an architecture smell; in security code it's the thing that makes your guarantees untestable, and an untestable guarantee is a guarantee you can't trust.

If a security control is hard to test, that's not a testing problem to route around. It's a design problem telling you the control is in the wrong place.

---

### The boring conclusion

There's no clever trick here. The harness is integration tests that attack the running system, fuzz targets on every untrusted-input boundary, and verification that runs against compiled reality instead of source. The defaults fail closed and the closed path is tested. The controls live somewhere testable.

What makes it work isn't any one technique. It's the shift from treating security as a property you assert to treating it as a property you *continuously prove*, in CI, on every commit, against what the machine actually runs. Designing a boundary is the easy part and the part everyone does. Enforcing it, and proving it stays enforced, is the work. In complex software it's most of the work, and Rust, for all its gifts, won't do it for you.

---

*Barbacane is open source (AGPLv3) and available at [github.com/barbacane-dev/barbacane](https://github.com/barbacane-dev/barbacane). The security testing harness and the hardening described here ship with the gateway, and secure-by-default configuration is part of [Barbacane's platform-team story](/platform/). It remains an early-stage project, evaluate thoroughly before production use.*
