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

It helps to see where the harness sits. Defense in depth here is three architectural layers, and only the third is something you build and run yourself:

```text
   Untrusted input: network bytes · .bca artifacts · plugin WASM
                              │
                              ▼
  ┌─────────────────────────────────────────────────────────┐
  │  LAYER 1  Memory & type safety                           │ ← Rust compiler
  └─────────────────────────────────────────────────────────┘
                              │
                              ▼
  ┌─────────────────────────────────────────────────────────┐
  │  LAYER 2  Runtime isolation                              │ ← wasmtime sandbox,
  │           per-plugin linker · fuel + epoch · memory caps │   capability gating
  └─────────────────────────────────────────────────────────┘
                              │
                              ▼
  ┌─────────────────────────────────────────────────────────┐
  │  LAYER 3  The security harness (your CI pipeline)        │
  │   • adversarial integration tests   (wiremock)          │
  │   • property-based invariants        (proptest)         │
  │   • byte-boundary fuzzing            (cargo-fuzz)       │
  │   • static WASM import validation    (wasmparser)       │
  └─────────────────────────────────────────────────────────┘
                              │
                              ▼
                      Safe execution
```

Layers 1 and 2 you mostly *get*: the compiler enforces the first, and `wasmtime` enforces the second once you configure it. Layer 3 is the one you have to *build*, and it's the subject of the rest of this post. It combines a few techniques, none of them exotic. The discipline is in combining them under one rule: **write the test to assert the secure behavior, not the current behavior.**

That rule is the whole game. If you write a test that passes against today's code, you've documented today's code. If you write a test that asserts what *should* be true, and it fails, you've found a gap, and the day it goes green is the day the gap closed. Red-to-green becomes a forcing function instead of a chore.

---

### Boot the real thing and attack it

Unit tests are great for logic and useless for boundaries, because boundaries live in the seams between components. So the first technique is an adversarial integration suite that starts the actual gateway and control plane and then behaves like an attacker.

```rust
use wiremock::{MockServer, Mock, ResponseTemplate};
use wiremock::matchers::method;

// Every mutating control-plane route must reject an unauthenticated caller.
#[tokio::test]
async fn control_plane_requires_auth() {
    let cp = spawn_control_plane().await; // boots the real axum router
    for (verb, path) in MUTATING_ROUTES {
        let status = cp.request_no_token(verb, path).await;
        assert_eq!(status, 401, "{verb} {path} must require auth, got {status}");
    }
}

// A plugin must not be able to reach the cloud metadata endpoint, even when a
// real upstream is standing by. The upstream is a wiremock server, so the test
// is hermetic: no live network, no flakiness.
#[tokio::test]
async fn plugin_egress_blocks_metadata() {
    let upstream = MockServer::start().await;
    Mock::given(method("GET"))
        .respond_with(ResponseTemplate::new(200))
        .mount(&upstream)
        .await;

    let gw = spawn_gateway_dispatching_to("http://169.254.169.254/").await;
    let resp = gw.get("/proxy").await;
    assert_ne!(resp.status, 200, "SSRF to metadata must be blocked");
}
```

These read like a pentest written down. Auth bypass, SSRF, slowloris, oversized and chunked bodies, artifact tampering, capability escape, JWT forgery, spoofed `X-Forwarded-For`. Each category gets a module. Each test asserts the hardened outcome.

The payoff is twofold. First, the obvious one: regression locking. Once a boundary is real, it can never silently become unreal again, because the build goes red. Second, the less obvious one: these tests *document the threat model in executable form*. A new contributor reading `tests/security/ssrf.rs` learns more about what the gateway promises than any prose I could write, and they can't accidentally let the promise lapse.

---

### Fuzz the byte boundaries

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

### Property tests for the invariants fuzzing can't reach

Fuzzing is the right tool for raw bytes, where the input space is "any sequence of `u8`" and you're hunting for a crash. It's a poor tool for deep, structured state machines. Hand `cargo-fuzz` a pile of random bytes and ask it to discover a *valid* gateway configuration in which an auth rule is mis-applied, and it will spend almost all of its time being rejected by your JSON parser long before it reaches the logic you care about. Coverage-guided fuzzing can claw its way through that, but it's a slow, indirect way to test a property you can state directly.

That's what property-based testing is for. With `proptest` (or `quickcheck`), you generate structurally *valid* inputs and assert an invariant holds across all of them. The generator understands your domain; the fuzzer doesn't. The two are complementary: fuzz the byte parsers, property-test the system invariants.

The invariant worth testing here is the one a checklist can only assert in prose: *no matter what configuration we compile, an unauthenticated request to a route that declares a security scheme is never dispatched to its backend.*

```rust
proptest! {
    #[test]
    fn protected_routes_never_dispatch_unauthenticated(spec in arb_api_spec()) {
        let artifact = compile(&spec);
        let gw = Gateway::load(&artifact);

        for route in spec.routes_with_security_scheme() {
            let resp = gw.request_without_credentials(&route);
            // Reaching the backend unauthenticated is the failure we forbid,
            // for every spec proptest can dream up, not just the ones we wrote.
            prop_assert!(!resp.reached_backend());
            prop_assert_eq!(resp.status, 401);
        }
    }
}
```

`arb_api_spec()` is a strategy that builds arbitrary-but-valid specs: random routes, methods, middleware orders, and security schemes. When this fails, `proptest` shrinks the input to the *minimal* spec that breaks the invariant, which usually hands you the bug on a plate. A hand-written example test checks the cases you imagined; a property test checks the case you didn't.

---

### Verify against ground truth, not your assumptions

This is the lesson I'd most want someone else to take from our hardening pass, because it nearly bit us.

We have a capability model: each plugin declares the host functions it needs in a manifest, and the runtime is supposed to reject a plugin that imports anything it didn't declare. Turning enforcement on sounds trivial, until you realize the official plugins' manifests had drifted into three incompatible dialects over time, and flipping the switch naively would have rejected most of them at load. The gateway would have "secured" itself into not working.

The instinct is to fix the manifests by reading the source. **Don't trust the source.** I started by grepping each plugin for its `extern` host-function declarations, and it lied to me. One plugin declared its HTTP imports through `#[link_name]` aliases that a naive grep missed entirely; another imported a time function the host didn't even provide, dead-code-eliminated away at build time so it never mattered. Source is what the author wrote. It is not what the machine runs.

So I derived the truth from the artifact instead. Build every plugin to wasm, then read the actual import section of each compiled module with `wasmparser` (the `walrus` crate works too if you want a higher-level IR):

```rust
use wasmparser::{Parser, Payload};

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

A forward-looking note: inspecting raw import sections is the right move *today*, because our plugins are core-wasm modules with a flat list of `barbacane`-namespaced imports. The WebAssembly ecosystem is standardizing exactly this kind of interface restriction with the [Component Model](https://component-model.bytecodealliance.org/) and WIT (Wasm Interface Type) files, where a component's imports and exports are declared in a typed `world` and the host can refuse to satisfy anything outside it. As that lands in production toolchains, "verify against ground truth" shifts from parsing import sections by hand to checking a component against its declared world, which is the same principle with a stronger type system behind it. Worth watching if you're designing a capability model now.

---

### Make the default fail closed, then test the closed path

A harness checks behavior, but it can only check the behavior you ship. The other half of the work is choosing defaults that fail closed, because a boundary that's off by default is off in most deployments.

Concretely, that meant a set of deliberately breaking changes: the control plane now refuses to start without an admin token rather than serving an open API; `file://` secret references must be confined to a configured directory rather than reading any path on disk; plugin egress to internal addresses is denied unless explicitly allowed; an MCP session is required rather than optional. Each one can be loosened by an operator who knows what they're doing. None of them is loose by accident.

Fail-closed defaults are only trustworthy if you test the closed path, which is easy to forget. It's natural to test that a valid token works. It's the test that *no* token returns 401, that a `..` traversal is rejected, that the metadata IP is blocked, that catches the regression. The negative test is the one that matters.

And "fail closed" has to mean a *clean* refusal, not a crash. A panic or a 500 on the adversarial path is its own vulnerability: a leaked stack trace, a downed worker, an attacker-triggered restart loop. So the negative test asserts the *specific* refusal, not merely "not success":

```rust
#[tokio::test]
async fn tampered_artifact_is_refused_cleanly() {
    let mut artifact = compile_signed(&spec, &signing_key);
    flip_one_byte_in_a_plugin(&mut artifact); // attacker swaps plugin WASM

    let result = Gateway::load(&artifact);

    // The point: a *defined* error, not a panic and not a 500.
    assert!(matches!(result, Err(LoadError::SignatureInvalid)));
}
```

`assert_ne!(status, 200)` would pass even if the gateway paniced. `assert_eq!(status, 401)` (or matching a typed `SignatureInvalid` error) is what proves the boundary fails *closed and clean*. Test the exact failure, not the absence of success.

---

### Keeping the harness fast enough that nobody routes around it

A harness only protects you if it runs, and the fastest way to kill one is to make it slow or flaky. If the security suite turns a five-minute build into twenty-five, developers will start merging around it, and a control nobody runs is a control you don't have. So the cadence of each technique has to match its cost.

The cheap, deterministic checks gate every commit. Unit and boundary tests run as `cargo test --workspace --lib --bins`, finishing in seconds, on every push. The heavier adversarial suite, which boots the gateway binary and a real Postgres for the control plane, runs as its own dedicated CI job on each pull request, isolated so it never slows the fast feedback loop.

The thing that keeps that heavier suite from being flaky is that it never touches a live network. Upstreams are `wiremock` servers spun up inside the test, so responses are deterministic and there's no external endpoint to be slow or down. The gateway's own listener is on loopback, and because the SSRF guard is configured per-client (see below) rather than from global state, loopback tests are deterministic instead of racing each other. Hermetic tests are the only kind worth gating a merge on.

Fuzzing is deliberately *not* a per-commit gate. `cargo-fuzz` needs the nightly toolchain, and a fuzzing run doesn't "pass", it runs until you stop it. So the fuzzers run out of band: as a scheduled soak job and locally before releases. The important part is the feedback loop: every crash a fuzzer finds becomes a committed regression test (and a seed in the corpus), so the open-ended, expensive tier keeps feeding cheap, deterministic checks back into the tier that gates every commit. Match the technique to the cadence, and let the slow tier harden the fast one.

---

### Testability is a security property

One last lesson, because it surprised me. The first version of our SSRF guard read its allow-flag from a global, cached on first use. It worked, and it was almost impossible to test, because one test setting the flag would poison every other test in the process. The race made the suite flaky, and a flaky security test is one you'll eventually delete.

The fix was to move the flag onto the client's own config instead of a global. Suddenly each test could construct exactly the client it needed, the flakiness vanished, and as a bonus the code got more honest: the SSRF policy now visibly belongs to the thing making the request. Global mutable state isn't just an architecture smell; in security code it's the thing that makes your guarantees untestable, and an untestable guarantee is a guarantee you can't trust.

If a security control is hard to test, that's not a testing problem to route around. It's a design problem telling you the control is in the wrong place.

---

### The boring conclusion

There's no clever trick here. The harness is adversarial integration tests that attack the running system, property tests for the invariants those examples can't cover, fuzz targets on every untrusted-input byte boundary, and verification that runs against compiled reality instead of source. The cheap deterministic checks gate every commit; the expensive open-ended ones run on a schedule and feed their findings back. The defaults fail closed, the closed path is tested for a clean refusal, and the controls live somewhere testable.

What makes it work isn't any one technique. It's the shift from treating security as a property you assert to treating it as a property you *continuously prove*, in CI, on every commit, against what the machine actually runs. Designing a boundary is the easy part and the part everyone does. Enforcing it, and proving it stays enforced, is the work. In complex software it's most of the work, and Rust, for all its gifts, won't do it for you.

---

*Barbacane is open source (AGPLv3) and available at [github.com/barbacane-dev/barbacane](https://github.com/barbacane-dev/barbacane). The security testing harness and the hardening described here ship with the gateway, and secure-by-default configuration is part of [Barbacane's platform-team story](/platform/). It remains an early-stage project, evaluate thoroughly before production use.*
