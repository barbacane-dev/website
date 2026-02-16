---
title: "How We Build Our Roadmap at Barbacane"
description: "A roadmap isn't a feature wishlist. It's a series of bets about what matters most, made with incomplete information. Here's how we decide what to build next for an open-source API gateway."
publishDate: 2026-02-16
author: "Nicolas Dreno"
tags: ["barbacane", "open-source", "roadmap", "engineering"]
---

*A roadmap is not a list of features. It's a sequence of decisions about what to ignore.*

Every open-source project accumulates more ideas than it can build. GitHub issues pile up. Users request features that contradict each other. Contributors propose directions that pull the project in three ways at once. The hard part isn't generating ideas. The hard part is saying no to most of them while still building something coherent.

After fifteen-plus years working with API gateways, deploying them, contributing to them, watching teams struggle with them, I've learned one thing: the projects that try to please everyone end up pleasing no one. The best tools are opinionated. They make choices early, defend those choices, and let the people who disagree use something else.

At Barbacane, we've built the roadmap around this conviction. It's a set of hard-won opinions applied consistently, shaped by patterns I've seen repeat across dozens of organizations and gateway migrations.

---

### One principle drives everything

Before talking about *how* we prioritize, it's worth restating *what* Barbacane is: **your spec is your gateway.**

I've spent years watching teams struggle with the same problem: the API specification says one thing, the gateway does another, and nobody notices until production breaks. Every gateway I've worked with eventually drifts from the spec it's supposed to enforce. The gap is small at first (a route added through the admin UI, a middleware configured outside the spec) and then it compounds.

Barbacane eliminates that gap by making your OpenAPI and AsyncAPI specs the authoritative configuration. You enhance them with `x-barbacane-*` extensions, compile them into an optimized `.bca` artifact, and deploy. No separate configuration layer. No drift. This isn't a novel idea. It's the obvious idea, once you've cleaned up enough configuration messes to know that any parallel surface *will* diverge.

This principle is not a tagline. It's a filter. Every feature we consider gets measured against it. If a feature strengthens the spec-to-gateway loop, it's a candidate. If it creates a parallel configuration surface or bypasses the spec, it's out, no matter how popular the request.

---

### Start with the constraint, not the feature

Most roadmap discussions start with "what should we build?" We start with a different question: **"what constraint are we solving?"**

Features are solutions. And solutions are dangerous when they arrive before the constraint is clearly understood. Build the wrong feature and you're stuck maintaining it. Solve the right constraint and the feature designs itself.

When we built [multi-spec compilation](/blog/one-gateway-many-specs/), it wasn't because "multi-spec support" appeared on a feature list. It was because every team running microservices hit the same wall: their specs were validated in isolation, and routing conflicts only surfaced in production. The constraint was clear. The feature followed.

Same story with AsyncAPI support. Teams were already using event-driven architectures with Kafka, NATS, MQTT, and AMQP. They couldn't describe those interfaces in a spec-driven gateway because the gateway only understood OpenAPI. The constraint, "my event-driven services are invisible to the gateway," led directly to the AsyncAPI 3.x parser and real broker implementations for Kafka and NATS (others will follow...).

---

### Three filters

Every candidate for the roadmap passes through three filters. If it doesn't clear all three, it doesn't ship.

**1. Does it belong in the gateway?**

An API gateway can do almost anything. Request transformation, caching, analytics, service discovery, rate limiting, A/B testing. The temptation is to become a Swiss Army knife. I've watched it happen, more than once.

Kong started as a lean Nginx-based proxy. Today it's an "API connectivity platform" spanning a gateway, a service mesh, an Insomnia-based developer tool, and a SaaS control plane. Tyk followed a similar arc: a lightweight Go gateway that grew into a full API management suite with its own dashboard, developer portal, identity broker, and analytics engine. WSO2 took the expansion even further, starting from an ESB and absorbing API management, identity, analytics, and integration into a sprawling product suite where the gateway is just one module among many. These are commercially successful products. But they've drifted far from the focused proxy that made each of them compelling in the first place, and the complexity tax is paid by every team that deploys them.

We resist this path. Our [out-of-scope list](https://github.com/barbacane-dev/barbacane/blob/main/ROADMAP.md) is explicit: no automatic API version negotiation, no request transformation between versions, no native Gateway API controllers, no request fan-out patterns. These aren't bad ideas. They're just not gateway concerns in our model, or they'd pull the project toward a different product. Obviously these boundaries aren't set in stone; our drivers must adapt along the product life. But we'd rather evolve deliberately than expand reactively.

**2. Does it compose with existing features?**

Barbacane's architecture is a middleware pipeline. Every feature (authentication, authorization, rate limiting, request validation) is a middleware that plugs into the chain. A new feature must compose cleanly with everything that already exists.

When we designed the [CEL and OPA authorization plugins](/blog/authorization-at-the-gateway/), this filter was critical. Both had to work downstream of *any* authentication middleware. Both had to produce consistent error responses ([RFC 9457 Problem Details](https://www.rfc-editor.org/rfc/rfc9457)). Both had to be declarable per-route in the OpenAPI spec using `x-barbacane-middlewares`. When we added OIDC authentication, it had to set the same `x-auth-consumer`, `x-auth-consumer-groups`, and `x-auth-claims` headers as every other auth plugin. No exceptions.

If a feature requires special-casing elsewhere in the pipeline, that's a design smell. We go back and rethink it.

**3. Can we ship it incrementally?**

We don't build features that require six months of work before they're usable. If a feature can't ship in a state that's useful on day one and extensible later, we either scope it down or defer it.

Case in point: Multi-spec compilation.
We shipped this feature without cross-spec schema validation. We were transparent about the trade-off: users got route-level conflict detection immediately, while we were explicit about what wasn't supported yet. This allowed us to gather real-world feedback, ensuring the next iteration (adding schema validation) will be informed by actual usage, not speculation.

---

### How We Prioritize

We use a simple priority system (P0 through P3) for our plugin roadmap. The labels encode two things: **how many users are blocked** and **how fundamental the capability is**.

P0 items are table stakes: request validation, JWT authentication, rate limiting, basic observability. Without them, no one puts a gateway in production. P1 items unlock new categories of use: OIDC, policy-driven authorization, event-driven routing. They open the door to user segments that were previously out of reach. P2 items improve the experience for existing users: request/response transformation, bot detection, URL redirection. P3 items serve narrow audiences but can be critical for specific deployments: LDAP authentication, enterprise-specific features.

The priority doesn't dictate the order strictly. A well-designed P2 contribution from the community can ship before a P1 item that needs more design work. But the labels help us make conscious tradeoffs when choosing between competing items.

---

### Where Ideas Come From

Our roadmap inputs come from four sources, in rough order of signal strength:

**Production friction.** The highest-signal input is watching what happens when someone actually deploys Barbacane. Where do they get stuck? What do they misconfigure? In v0.1.2, we consolidated the workspace from 11 to 8 crates and improved error handling, not because it was exciting work, but because the codebase structure was creating friction and the error messages could confuse users.

**GitHub issues and discussions.** Community feedback is invaluable, but it requires interpretation. Users describe symptoms, not root causes. "Can you add header rewriting?" might really mean "my auth middleware sets a header my backend doesn't understand." Understanding the *why* behind a request often leads to a different (better) solution than the one proposed.

**Spec ecosystem changes.** OpenAPI and AsyncAPI evolve. New versions introduce capabilities that change what's possible at the gateway layer. We track these actively. When AsyncAPI 3.0 formalized operation-level bindings, it opened the door for first-class event-driven routing with protocol-specific bindings for Kafka, NATS, MQTT, and AMQP.

**Our own experience.** We've spent years using the alternatives. When you've configured enough gateways to know where the friction points always emerge, you develop intuitions about what a tool needs before users ask for it. That's not guesswork; it's pattern recognition. Every feature goes through internal deployment before it ships. If something feels awkward to configure, we fix it before release.

---

### What we say no to

A roadmap is defined as much by what's absent as by what's present. Here are recurring requests we've deliberately declined, not because we haven't thought about them, but because we've seen where they lead.

**"Add a GUI for configuration."** I've seen this pattern too many times: a gateway ships a web console, teams start clicking instead of writing specs, and within months the GUI becomes the real configuration while the specs rot in a repository nobody reads. If you want a visual editor, use an OpenAPI editor. The spec *is* the configuration.

**"Support non-spec-driven routes."** Every gateway that allows imperative route definitions alongside spec-driven ones eventually becomes spec-optional. One "quick" imperative route becomes ten, and then the spec is a partial lie. Every route in Barbacane traces back to a specification. Relaxing that constraint would undermine compile-time validation, embedded documentation, and conflict detection. The entire model depends on it.

**"Build a plugin marketplace."** Barbacane plugins are WASM modules compiled from Rust via Wasmtime with AOT compilation. A marketplace would incentivize quantity over quality and create a maintenance surface we can't control. We've shipped over a dozen first-party plugins, from basic auth to correlation IDs to request size limits, and we'd rather have twelve solid plugins than a hundred fragile ones.

**"Create an enterprise edition."** I've lived through the open-core playbook from the inside. Kong's split between Gateway OSS and Kong Enterprise, Tyk's gated dashboard and developer portal, Gravitee's community-versus-enterprise feature matrix: I've seen how this plays out. The community version gets slower updates, the best features land behind a paywall, and contributors eventually realize they're building someone else's commercial product. Barbacane is fully open source under Apache 2.0. There is no enterprise edition. We generate revenue through professional services, not feature paywalls.

---

### What's next

Right now, we're building request and response transformation middleware: the ability to modify headers, query parameters, and message bodies as they flow through the pipeline.

Beyond that, our near-term focus areas include:

- **Logging infrastructure.** Better integration points for Datadog, Splunk, and other observability platforms.
- **Documentation expansion.** More guides, more examples, more integration walkthroughs.
- **Data plane enhancements.** Streaming support, connection pooling, TLS certificate management.
- **Control plane maturity.** Rollback capabilities, audit logging, RBAC.

Further out, bot detection, URL redirection, and LDAP authentication are on the radar. They'll ship when they pass the three filters and when we (or a contributor) have a design that composes well with the existing pipeline.

---

### The Roadmap Is a Byproduct

The best way to think about our roadmap is as a byproduct of a clear set of principles, not as a plan that exists independently. If you understand that Barbacane makes the spec the gateway, that every feature must compose with the middleware pipeline, and that we ship incrementally with honest documentation of limitations, you can predict most of what we'll build next.

Being open source makes this legible. Our [ROADMAP.md](https://github.com/barbacane-dev/barbacane/blob/main/ROADMAP.md) is public, our [CHANGELOG.md](https://github.com/barbacane-dev/barbacane/blob/main/CHANGELOG.md) documents every release in detail, and decisions to defer or reject features get written rationale. When a community member shows up with a well-designed pull request for a feature we hadn't scheduled yet, it moves up. If it passes the three filters, we review it, refine it, and ship it. The line between user and contributor is blurry, and that's by design.

The gateways that started with a clear philosophy and then abandoned it under commercial pressure aren't better for it. They're harder to deploy, harder to reason about, and harder to contribute to. We'd rather be the right tool for teams who think spec-first than a mediocre tool for everyone.

If you have ideas, constraints, or feedback that should inform our next decisions, reach out at [contact@barbacane.dev](mailto:contact@barbacane.dev). We read everything.

---

*Barbacane is open source (Apache 2.0) and available at [github.com/barbacane-dev/barbacane](https://github.com/barbacane-dev/barbacane). Check the [documentation](https://docs.barbacane.dev/) for the full CLI reference and getting started guide.*
