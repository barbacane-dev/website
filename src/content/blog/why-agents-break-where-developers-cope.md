---
title: "Why agents break where developers cope: API governance as agent readiness"
description: "Human developers route around inconsistent contracts, undocumented auth quirks, and drifted specs. Agents cannot. As agents become first-class API consumers, the dev-experience hygiene your team has been postponing turns into a production reliability problem."
publishDate: 2026-05-12
author: "Nicolas Dreno"
tags: ["ai-agents", "mcp", "mcp-gateway", "api-governance", "spec-first", "openapi", "barbacane"]
draft: false
---

*Every API team has a list of things they keep meaning to fix. Agents are about to decide which of those things are actually optional.*

If you have worked on an internal API platform for any length of time, you know the inventory. The endpoint that returns `200` with an error body instead of `4xx`. The field that is documented as required and is, in practice, sometimes null. The auth header that is technically optional because one legacy caller never adopted the new flow. The OpenAPI spec that is mostly right, drifting from reality at the edges. The rate-limit response that returns a different shape on the staging cluster than in production.

None of this stops anyone from shipping. Human developers absorb it. They read the issue tracker, ask in Slack, copy a working example from another service, and move on. The API works, in the sense that the people calling it have learned how to call it.

Then agents show up, and the bill comes due.

---

### What human developers absorb

Most internal APIs are held together by a layer of unwritten knowledge. Some of it is documented, most of it is not, and a meaningful slice is contradictory. Developers cope by reading source code, copying from working clients, asking the team that owns the service, and pattern-matching from other APIs they have used.

A short, non-exhaustive list of things human developers routinely route around:

- **Spec drift.** The OpenAPI file says one thing, the runtime returns another. Devs notice the divergence, log a ticket, and update their client by hand.
- **Field shape inconsistency.** `created_at` is a Unix timestamp on one endpoint, an ISO string on another, both in the same service. The dev writes a small adapter.
- **Inconsistent error contracts.** Some endpoints return RFC 9457 problem details, some return a custom envelope, some return a string. Each is fine if you know about it.
- **Auth quirks.** The endpoint accepts either a JWT in `Authorization` or a session cookie, but only the JWT path enforces the scope check. Nobody documents this; everyone who matters knows.
- **Undocumented side effects.** Calling `POST /orders` also triggers a webhook to billing. The doc does not mention it; the integration tests imply it.
- **Inconsistent pagination.** Some endpoints use cursor pagination, some use offset, some return the whole list because "it is a small table." Until it is not.
- **Rate limit signals.** One service returns `429` with `Retry-After`, another returns `503`, another returns `200` with an empty list. Backoff logic is written defensively.
- **Operation IDs and descriptions.** Often missing, sometimes copy-pasted, occasionally lying. Developers ignore the field and read the path.

Every one of these has a workaround. The workaround lives in someone's head, or in a wrapper library, or in a runbook, or in the code of the first team that integrated and figured it out. The API surface and the API contract are two different things, and human developers spend a non-trivial fraction of their time reconciling them.

This has been tolerable for fifteen years because the cost of friction is bounded by the patience of the human on the other end. The pattern works until the other end stops being human.

---

### What agents cannot absorb

An LLM-driven agent is not a slower developer. It is a different kind of consumer, and the differences matter.

Agents work from declared contracts. When an agent calls a tool via MCP, the only thing it knows about that tool is what the schema says. Tool name, description, parameters, return type. If the schema is wrong, the agent's plan is wrong. There is no Slack channel to check. There is no senior engineer who has seen this bug before. The agent does what the contract advertises, and when reality diverges from the contract, the agent loops, hallucinates, or fails.

Agents do not pattern-match across services the way developers do. A developer who has used twenty APIs has a strong prior about how errors look, how pagination works, how dates are encoded. They bring that prior to every new API and use it to fill in gaps. An agent has only the current contract. If the contract is incomplete, the gap is a coin flip.

Agents fail loudly and expensively. A confused developer pauses and asks a question. A confused agent burns tokens, retries, fans out, and produces a plausible-looking wrong answer. Every retry is paid for. Every loop shows up as latency. Every wrong tool call may have side effects the agent does not understand it has triggered.

Agents are cheap and parallel. There will be more agent traffic against your API in 2027 than human-developer traffic, by orders of magnitude, on any service that gets MCP-exposed. The handful of pain points your developers tolerate gets multiplied by a number you have not budgeted for.

Concretely, every item in the previous section becomes something different when the caller is an agent:

- Spec drift becomes silent tool failure.
- Field shape inconsistency becomes unparseable responses and retry loops.
- Inconsistent error contracts become an agent that does not know whether to back off, retry, or escalate.
- Auth quirks become unpredictable 401s the agent has no strategy for.
- Undocumented side effects become consequences the agent never planned for and cannot reason about.
- Inconsistent pagination becomes either truncated answers or runaway scans.
- Inconsistent rate limit signals become traffic that does not back off, because the agent does not recognise the signal as a limit.
- Missing operation IDs and descriptions become tools the agent never selects, because nothing in the schema told it what they do.

The cost of inconsistency stops being a friction tax on developer time and becomes a reliability tax on production.

---

### The reframe: agent readiness is API discipline

For a decade, the case for spec-first development, schema linting, consistent error contracts, and centralized auth has been made on developer-experience grounds. Cleaner specs make for happier integrators. Consistent errors make for nicer SDKs. Centralized auth makes for a saner security review. All true, all worth doing, all easy to push to next quarter.

The agent era reframes the same investments as reliability work. The exact same backlog, with a different price tag attached.

- **Spec discipline is no longer about docs.** Your OpenAPI file is the input to the tool surface agents see. A missing `description` is a tool the agent cannot use. A missing `operationId` is a tool with no stable identity. A wrong type is a contract the agent will honor and the runtime will reject.
- **Consistent error contracts are no longer about SDK ergonomics.** They are the signal agents use to decide between "retry," "back off," "ask the human," and "escalate." Without consistency, every agent has to implement bespoke heuristics per endpoint, and most will get it wrong.
- **Centralized auth is no longer about security review.** It is about giving agents one predictable failure mode for "you are not allowed to do this," instead of N endpoint-specific ones.
- **Rate limits and quotas are no longer about cost control.** They are the only thing standing between an agent in a loop and your database.
- **Observability is no longer about debugging.** It is about being able to answer "what did the agent do last night, in what order, with what consequences," which is a question your team will start getting asked.

This is not a new investment. It is the investment you have been postponing, with a new and less negotiable deadline.

---

### Where the gateway sits in this

If the contract is the thing agents depend on, the question is where the contract gets enforced. The historical answer, "each backend service enforces its own piece," is exactly the pattern that produced the inconsistencies in the first place. Ten teams will produce ten error envelopes, ten auth flows, and ten rate-limit responses, no matter how good the style guide is.

The gateway is the natural enforcement point because it is the only place that sees every request the same way. Auth, rate limits, validation, error shape, and observability can be applied uniformly there, without asking ten teams to coordinate. This is the same argument that drove the API gateway category fifteen years ago, with a different forcing function: agents instead of integration partners.

In practice, agent-readiness at the gateway looks like:

- **Spec-first compilation.** The OpenAPI spec is not documentation that lives next to the gateway; it is the input the gateway is built from. Tool surfaces, request validation, and response schemas are all derived from the same artifact. There is nothing to drift.
- **Uniform auth and authorization.** One identity story across every operation, with [policy decisions made at the gateway](/blog/authorization-at-the-gateway/) before the request reaches a backend that might implement them differently.
- **One error contract.** Every failure mode, validation, auth, rate limit, upstream error, returns the same shape. Agents learn one envelope, not ten.
- **Consistent rate limit signaling.** One `429` shape, one `Retry-After` semantic, one rate-limit headers convention, applied to every route the gateway fronts.
- **Spec validation in CI.** Missing descriptions, missing operation IDs, drifted types, and inconsistent error references fail the build, not the agent at 3am. Linting the spec used to be a nice-to-have. With agents in the loop, it is the cheapest reliability investment available.
- **Agent-specific middleware.** Token-based limits, prompt and response guarding, cost attribution, and per-agent audit logs sit at the same layer as the API governance, not as a separate sidecar.

None of this is new infrastructure. It is the API gateway you already wanted, with the dev-experience arguments replaced by reliability arguments, and the deadline moved up.

---

### What to do about it

The honest version of the advice: take the list of things your developers have been quietly working around, and treat it as a backlog of agent-readiness work. Sort it by how often the workaround shows up in client code, because that is a good proxy for how often an agent will hit it.

A few specific moves that pay off quickly:

- **Lint your specs in CI.** Use Vacuum, Spectral, or equivalent. Fail the build on missing descriptions, missing `operationId`s, undeclared error responses, and inconsistent schema references. This is a one-week project that catches a quarter of the problems described above.
- **Pick one error contract and enforce it at the gateway.** RFC 9457 problem details is a defensible default. The exact choice matters less than the consistency.
- **Move authorization decisions to the gateway** where the decision can be expressed declaratively, not implemented per service. CEL for route-level guards, OPA for centralized policy; [we wrote about the two approaches here](/blog/authorization-at-the-gateway/).
- **Audit your rate-limit responses.** Pick one signaling convention. Make sure every limit, gateway-side and backend-side, follows it.
- **Treat your OpenAPI as the source of truth, not a derivative.** If your gateway is configured separately from your spec, your gateway will drift from your spec, and your agents will fail in the gap. [The compile-don't-configure pattern](/blog/beyond-configuration-drift/) closes the gap by construction.
- **Decide what gets MCP-exposed at the spec level**, not in a parallel registry. Per-operation opt-out via spec annotation keeps the agent surface honest. [More on that here](/blog/what-is-an-mcp-gateway/).

The pattern across all of these is the same: the contract is the thing agents depend on, the gateway is the place where the contract becomes operational, and the spec is the source of truth that connects them.

---

### Closing thoughts

The agent era is not a new layer of work bolted on top of API platforms. It is a forcing function that converts the discretionary improvements API teams have been making the case for, contract discipline, consistency, centralized policy, observable surfaces, into operational requirements. The work was always worth doing. The new thing is that postponing it now produces user-visible failures instead of developer-visible friction.

The good news is that everything that makes an API agent-ready also makes it better for the humans who were already using it. The teams that get this right do not end up with a second platform for agents. They end up with one well-governed platform that happens to also be safe for agents to call.

At Barbacane we build that platform on the assumption that this is where things are going: spec-first compilation, gateway-enforced governance, MCP exposure derived from the same OpenAPI you already maintain. The categories matter more than the product. But the categories are converging quickly, and the teams that act on the convergence early will skip the second-system rebuild that the ones who delay are about to start.

---

*Barbacane is open source (AGPLv3) and available at [github.com/barbacane-dev/barbacane](https://github.com/barbacane-dev/barbacane). If MCP and agent-readiness are on your roadmap, [the /ai page](/ai/) is the short version of how we approach it.*
