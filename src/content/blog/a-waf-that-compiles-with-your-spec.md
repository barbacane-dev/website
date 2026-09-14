---
title: "A WAF that compiles with your spec"
description: "Most WAFs parse their rules at runtime and silently drop the ones they can't enforce. Barbacane validates an OWASP CRS rule set at build time, seals it into the signed artifact, and refuses to start if the rules and the binary disagree. Here's how it works, and why compile time is the right place for it."
publishDate: 2026-09-14
author: "Nicolas Dreno"
tags: ["barbacane", "api-gateway", "waf", "security", "owasp-crs", "modsecurity", "libinjection"]
---

*A rule that silently never fires is worse than no rule. It reads like coverage and behaves like a gap.*

A web application firewall is a negative security model. Your OpenAPI spec is a positive one: it says what a request is allowed to look like, and anything outside the schema is rejected. That is necessary and not sufficient. A perfectly schema-valid `?q=1' OR 1=1--` passes validation cleanly, because it is a valid string in a valid parameter. The WAF exists to catch exactly the payloads that are shaped correctly and mean harm.

Barbacane now ships one, compatible with ModSecurity and the OWASP Core Rule Set. The interesting part is not that it runs CRS. Plenty of things run CRS. The interesting part is *when* it decides whether your rules are real: at compile time, against the same binary that will enforce them, sealed into the artifact you sign.

---

### A rule that never fires is a comment

Here is the failure mode that made us build this the way we did.

A traditional WAF loads its rule set at runtime. The gateway boots, reads a directory of `.conf` files, parses what it can, and starts serving. When it hits a directive it does not understand, or an operator it has not implemented, the usual behaviour is to log a warning and move on. The request path comes up. Traffic flows. Dashboards are green.

And a rule you thought was protecting you is doing nothing. Not failing loudly, just absent. The rule set on disk says you block SQL injection on that route. The engine that actually ran quietly decided it could not compile that operator and skipped it. Nobody notices until an incident review, months later, asks why the payload that hit production matched a rule that was supposedly enabled.

This is the same shape we keep finding everywhere in security work: a boundary that was designed, written down, and never actually enforced. A rule set is a promise. A WAF that drops rules on the floor at boot turns that promise into a comment.

The fix is to move the decision earlier, to a moment when a human is watching.

---

### Compile the rules, or don't ship them

In Barbacane, the WAF rule set is an input to `barbacane compile`, the same step that turns your OpenAPI and AsyncAPI into a sealed `.bca` artifact. The compiler parses the rule set, resolves the `@pmFromFile` phrase lists the rules reference, and refuses anything it cannot enforce.

By default, a rule the build cannot compile fails the build:

```text
error[E1080]: x-barbacane-waf: 1 rule(s) in the rule set cannot be enforced by
this build: rule 900500 (line 12): @rx (: unclosed group
```

That error is the whole point. The gateway will never run with a rule set it does not fully understand, because the artifact does not get built. If you genuinely want to ship the rest of a rule set without a rule that will not compile, you have to say so out loud with `unsupported_rules: skip`. That is not silent either: the compiler warns with the specific rule ids, the ids go into the manifest, and the running gateway logs them at WARN on every boot. An operator can prove, from the signed artifact, exactly which rules are not being enforced. Absence becomes a fact you can audit rather than a surprise you discover.

Stock CRS v4.9.0 compiles in full, so in practice this gate is quiet. It earns its keep on the day someone adds a custom rule with a typo, or points the gateway at a rule set built for a different engine. The build stops. Nothing reaches production half-enforced.

---

### Sealed into the thing you sign

Once compiled, the rule set is not a file the gateway reads at runtime. It travels inside the artifact, alongside the phrase lists the rules depend on, and it is covered by the artifact hash. Barbacane recomputes and verifies that hash on load, so a rule set cannot be swapped after signing.

The policy is covered too, not just the rules: the blocking mode, the paranoia level, the anomaly thresholds. That means a signed artifact cannot be quietly downgraded from blocking to detection-only, or have its paranoia level lowered, without invalidating the signature. The WAF configuration is part of the provenance of the build, the same as the routes and the plugins. If you can prove which artifact is running, you can prove which rules and which policy are running, because they are the same object.

This is the compile-time model applied to security rules: decide once, at build time, and make the decision tamper-evident. The runtime does not get a vote.

---

### libinjection, in Rust, checked against the original

CRS leans on two libinjection classifiers, `@detectSQLi` and `@detectXSS`, for the injection payloads that regular expressions miss, like the tautology `1' OR '1'='1`. libinjection is a C library. We did not want a C dependency with its own memory-safety surface sitting on the request path of a gateway whose whole pitch is a safe runtime.

So the classifiers run on a pure-Rust port. The obvious risk with a reimplementation is that it drifts from the original and quietly disagrees on real payloads, which for a security classifier is the worst kind of bug: it looks like it works. We treat that risk the way we treat every other boundary, by testing it against ground truth rather than against our own assumptions. The port is differential-tested against the original C library through an FFI harness over a corpus of roughly 163,000 inputs, and it matches on every one, both the block or allow verdict and the fingerprint the rule captures. Any divergence fails CI. On top of the corpus, a long differential-fuzzing campaign drives new inputs at both implementations to push the agreement surface past the fixed corpus.

The result is that `@detectSQLi` and `@detectXSS` behave like the reference operators CRS expects, with the capture semantics ModSecurity rules rely on, without a C library in the address space.

---

### Both directions: request and response

A WAF that only inspects requests is watching half the conversation. Data leaves the way it arrived, and a stack trace, a SQL error, or a credential in a response body is a disclosure the request-side rules never see.

Barbacane runs the response phases too. Response headers are inspected on every path, including streaming, because the headers arrive before the body does. Response bodies are inspected up to a configurable size cap, buffered and scanned before they reach the client. A response that is streamed, or whose body is larger than the cap, has its headers inspected and its body skipped rather than silently passed, and the skip is counted in a metric so you can see how often it happens instead of assuming it never does.

The two directions share one transaction. The anomaly score a request accumulates is the score the outbound rules read, which is how CRS is designed to work, and it only works if the response side continues the same evaluation rather than starting a fresh one. A rule can score on the way in and block on the way out, and the logging phase runs even on a blocked transaction, so a request that was refused is still recorded and correlated the way ModSecurity intends.

---

### The audit log

Every inspected transaction can produce one structured record: the rules that matched with their messages and the variable that triggered them, the inbound and outbound anomaly scores, the verdict, and the response status. It lands on its own log target so you can route it to a SIEM without drowning in it, and the policy is a single knob: off, relevant-only, or on. Relevant-only, the CRS default, records a transaction that was blocked or matched a rule and stays quiet for clean traffic. Rules marked `nolog` stay out of the record, the same as they would in the ModSecurity audit log.

This is the difference between a WAF that blocks and a WAF you can operate. Tuning a rule set is the real work, and it is impossible without a per-transaction trail of what matched and why.

---

### Where it sits, and what it costs

The WAF runs after spec validation and before the middleware chain. That order is deliberate. The spec has already said what the request may look like, so by the time the rule set sees a request it is dealing with something that is schema-valid and still wants inspecting. Positive model first, negative model second, both declared on the same spec.

It is not free. Measured through a real gateway with full CRS at paranoia level 1, inspection runs around 2 ms mean, which is enormous next to the roughly 1.2 microseconds spec validation costs. A WAF is a real per-request budget, so enable it where it earns its place rather than globally by reflex, and start at a lower paranoia level until you have tuned out the false positives. This is not a criticism of the design; it is what a full rule set costs in any implementation, and it is comparable to the alternatives. The honest move is to make the cost visible rather than hide it.

---

### What this actually changes

A WAF is only as good as the rules it is actually running, and the industry norm is to find out which rules those are at runtime, quietly, often too late. Barbacane moves that decision to compile time, where a failed build is cheap and a human is watching, and then seals the answer into the artifact you sign so it cannot drift afterward. The rules are validated against the same binary that enforces them. The injection classifiers are checked against the original. The response side runs, and every transaction can be audited.

None of that makes the WAF catch more attacks than CRS already catches. What it changes is whether you can trust that the rules you think are enabled are the rules that ran. For a security control, that is the whole game.
