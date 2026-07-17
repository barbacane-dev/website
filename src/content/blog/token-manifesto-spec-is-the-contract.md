---
title: "You don't have a prompt problem. You have a contract problem."
description: "The Token Manifesto argues for discipline over verbosity in the LLM era. We agree so much that we built a gateway that enforces it instead of hoping for it. A reaction, mapped point by point to how we build Barbacane."
publishDate: 2026-07-17
author: "Nicolas Dreno"
tags: ["barbacane", "spec-driven", "ai-gateway", "ways-of-working", "opinion"]
draft: false
---

*A manifesto is a set of good intentions. Good intentions drift. So we stopped writing them down and started compiling them.*

I read [The Token Manifesto](https://www.touilleur-express.fr/2026/07/17/the-token-manifesto) this morning, and it stuck. It's a satirical rewrite of the Agile Manifesto for the age of large language models, and like the best satire it's mostly just true. Its values, stripped of the wink:

- **Brevity over sophistication.** A tight system prompt beats an elaborate one.
- **Examples over explanation.** Showing beats describing.
- **Incremental refinement over upfront specification.** Small steps beat comprehensive briefs.
- **Structured outputs over freeform responses.** A defined shape wastes fewer tokens than prose.

The thesis underneath is simple: your context window is a finite, expensive resource, and the discipline of working with models is the discipline of *not wasting it*. My favorite line from the piece: *"You don't have a prompt problem. You have a context-window problem."*

It resonated, and not for the reason you'd expect. It isn't that we build AI tooling, though we do. It's that the manifesto describes, almost point for point, the philosophy we bet the whole product on. With one difference that turns out to be the entire difference.

---

### A manifesto is a set of good intentions

Every value in that list is something a team *agrees to* and then slowly stops doing. The prompt starts lean and accretes edge cases. The "structured output" stays structured until the Friday hotfix that returns a bare string. The spec was the source of truth right up until someone tweaked the gateway config directly in prod because it was faster.

This is the oldest failure mode in software: two sources of truth that are supposed to agree, maintained by different people under different pressures, drifting apart one reasonable exception at a time. The Agile Manifesto had it too. You value working software over documentation, until the documentation is the only thing that outlives the people who wrote it.

Barbacane's entire premise is a refusal to rely on good intentions. **Your spec is your gateway.** Your OpenAPI or AsyncAPI document isn't documentation that describes the gateway, and it isn't config that sits next to the gateway. It *is* the gateway. We compile it into a single sealed artifact and run that. There is no second place for the truth to live, so there is no drift to manage. We've written about why [any parallel configuration surface will diverge](/blog/beyond-configuration-drift/); the manifesto is that same lesson, told in tokens instead of YAML.

So let me read the manifesto through that lens. Each of its values is a good intention. Here's what each one looks like when you stop hoping for it and start enforcing it.

---

### Brevity over sophistication → one artifact, no shadow config

The manifesto wants the smallest thing that works. So do we, but we mean it structurally. A traditional gateway is a pile of routing rules, middleware YAML, auth config, and rate-limit tables, none of which the API spec knows about. That surface area is where sophistication hides and where bugs breed.

Barbacane collapses it. Routing, validation, auth, rate limits, and AI policy are all declared inline on the operation they govern, in the spec you already write:

```yaml
paths:
  /v1/chat/completions:
    post:
      operationId: chatCompletions
      x-barbacane-middlewares:
        - name: jwt-auth
          config: { issuer: "https://auth.example/", audience: ai-gateway }
        - name: ai-token-limit
          config:
            partition_key: "header:x-auth-sub"
            profiles:
              standard: { quota: 100000, window: 60 }
```

The compiler seals it into a `.bca` artifact, pinned plugin WASM included. Nothing is fetched at request time. There's no sophisticated second system to reason about, because there's no second system. Brevity as an architectural guarantee, not a resolution someone has to keep.

---

### Examples over explanation → the spec is executable, not prose

"Showing beats describing" is exactly why we don't let the spec be prose *about* the gateway. An OpenAPI document that merely documents intended behavior is an explanation, and explanations rot. A spec that compiles and runs is an example, the only kind that can't lie, because if it were wrong it wouldn't compile.

That's the whole point of compile-time safety. Invalid schemas, missing dispatchers, conflicting routes: caught before deployment, not discovered in an incident. If it compiles, it runs. The spec doesn't describe the behavior; it *is* the behavior, demonstrated on every request.

---

### Structured outputs over freeform → validation you can't opt out of

This is the one where the alignment is almost embarrassing. The manifesto says defined shapes waste fewer tokens than freeform prose. We say: a defined shape you merely *prefer* is a shape you'll abandon under load.

If the spec says a field is required, the gateway enforces it, on every request, in about 1.2 microseconds. If the spec says an endpoint is rate-limited, it is. There's no path where a request skips validation because someone was in a hurry. Structured isn't a style we recommend; it's the only state the system has. "Zero runtime surprises" isn't a slogan, it's the mechanical consequence of the spec being the contract.

---

### Incremental refinement over upfront specification → the honest tension

Here's where an honest reader stops me. The manifesto explicitly prefers *incremental refinement over upfront specification*, and Barbacane is, right there in the category name, spec-driven. Isn't that big-design-upfront wearing a modern hat?

No, and the distinction matters. "Upfront specification" in the waterfall sense means a heavy document, written before the work, that starts drifting from reality the moment it's signed off. That's the thing the manifesto is right to reject. A Barbacane spec is the opposite: it's small, it's the artifact itself, and it changes constantly. `barbacane dev` compiles, serves, and hot-reloads on every save. You refine incrementally, in tiny steps, and each step is validated the instant you make it.

The spec isn't a plan you commit to before building. It's the running thing, edited live. We didn't choose *specification* over *iteration*. We made the specification the medium you iterate *in*, so that every increment is a real, enforced, compiled state rather than a promise about a future one. Spec-driven and incremental stop being opposites the moment the spec stops being a document and becomes the executable.

---

### The part where we stopped talking and shipped it

The manifesto is *about* token economy. Its closing jab: *"Everyone's a prompt engineer until they run out of monthly quota."* We took that seriously enough to make the quota a first-class, spec-declared, enforced policy. Barbacane's AI gateway ships four middlewares that exist for exactly the discipline the manifesto preaches:

- `ai-token-limit` — token-based rate limiting, per user, per window. The monthly-quota problem, handled at the edge.
- `ai-cost-tracker` — per-call cost accounting against your real provider prices.
- `ai-prompt-guard` — bounds on message count and blocked patterns, so a runaway context can't quietly balloon.
- `ai-response-guard` — redaction on the way out.

They sit in the same middleware chain as your auth and validation, declared in the same spec, sealed in the same artifact. Token discipline stops being advice you give a team and becomes a policy the gateway applies whether or not anyone remembers to.

---

### How we actually work

None of this would be believable if we didn't build the product the way the product asks you to build APIs. We do. The spec goes first. We prefer errors caught at compile time to errors explained at runtime. We refuse the second source of truth, in the codebase and in our own process, because we've felt what it costs. The manifesto's real subject isn't tokens; it's the cost of things drifting apart, and the discipline of keeping one authoritative version of the truth. That's the same conviction that made us build a gateway with no config language of its own.

So: I loved the manifesto, and I'll borrow its ending. You don't have a prompt problem, and you don't only have a context-window problem. You have a contract problem. The fix isn't a better set of intentions. It's a single source of truth that the machine enforces, so that discipline is what the system *is*, not what you keep meaning to do.

Your spec is your gateway.
