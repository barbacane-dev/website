---
title: "What is an MCP gateway? The category every API team will need in 2026"
description: "Model Context Protocol turns any API into a potential AI agent tool. MCP gateways solve the same problem API gateways solved 15 years ago: centralize tool exposure, governance, and observability instead of letting every team ship their own."
publishDate: 2026-04-23
author: "Nicolas Dreno"
tags: ["mcp", "mcp-gateway", "ai-gateway", "api-gateway", "model-context-protocol", "ai-governance"]
draft: true
---

*If you have an API and you have agents, someone on your team is about to ask: how do we expose this to MCP?*

The Model Context Protocol hit production readiness in late 2024, and by early 2026 it is the default way agents discover and call external tools. Every major AI platform speaks MCP. Every team with an internal API has been pulled into a conversation about "MCP-enabling" their service.

The first instinct, after ten minutes of reading the spec, is to write an MCP server. That instinct is wrong, for the same reason that writing a custom reverse proxy per service was wrong 15 years ago. This post is about what the right instinct looks like: **the MCP gateway.**

---

### A quick refresher on MCP

Model Context Protocol (MCP) is an open standard for connecting AI agents to external capabilities. It defines three primitives: **tools** that agents can call, **resources** that agents can read, and **prompts** they can consume as templates. Tool calls are the primitive almost every conversation about MCP actually cares about.

Under the hood, MCP is JSON-RPC 2.0 over a choice of transports (stdio, HTTP, or SSE). The wire format is boring on purpose. What matters is that an agent can query `tools/list` to discover what it can do, call `tools/call` to do it, and receive structured responses it can feed back into its reasoning.

Adoption in early 2026 is uneven but accelerating. Most new agent frameworks ship MCP support out of the box. Most internal APIs do not. That gap is where platform teams are spending their time.

---

### The naive path: every team writes its own MCP server

The shortest path from "our API is not MCP-exposed" to "our API is MCP-exposed" is to write a small MCP server. A few hundred lines of code, one endpoint per tool, wrap the existing HTTP client. Ship it.

Do this once and it is fine. Do this ten times, across ten product teams, and you have rebuilt the mid-2010s API sprawl, but for agents:

- **Ten auth implementations.** Every MCP server has to verify the agent's identity before letting it call anything. Ten teams will handle JWTs, OIDC, and API keys ten different ways. Some of those ways will be wrong.
- **Ten rate limits.** Runaway agents are already a production incident pattern. If each MCP server re-implements rate limiting, you discover the gaps one outage at a time.
- **Ten observability stacks.** Your SRE team wants one dashboard for "calls made by agents." They will not get one. They will get ten.
- **Ten attack surfaces.** Every MCP server is a new entry point into your infrastructure. Your security team will find out at the worst possible time.
- **Shadow stacks.** The MCP server almost always sits in front of the same HTTP endpoints the rest of your platform uses. Now you have two ways to call the API: the front door (with auth, rate limits, audit) and the side door (the MCP server, with whatever got re-implemented). The side door rots.

This is the same pattern that drove the API gateway category in the first place. It is worth learning the lesson faster this time.

---

### Enter the MCP gateway

An MCP gateway is exactly what it sounds like: a gateway that speaks MCP on the front side and speaks your existing APIs on the back side. Instead of every team shipping a bespoke tool server, they register with the gateway and inherit its governance. Instead of agents learning ten tool catalogs, they see one.

The conceptual move is simple. An MCP `tools/call` is, structurally, an HTTP request with some type information wrapped around it. The gateway takes the tool call, translates it into the HTTP request the backing API already expects, runs it through the same middleware chain every other request uses (authentication, authorization, rate limits, validation, transformation, observability), and hands the response back to the agent.

The benefits are the same benefits an API gateway delivered 15 years ago, restated for agents:

- **One auth story** for every tool call, instead of ten partial implementations
- **One rate-limit surface**, visible and tunable in one place
- **One audit trail** your compliance team can actually point to
- **One blast radius**, with a known perimeter and known defenses
- **No shadow stack.** Tool calls run through the same pipeline as HTTP requests, so there is nothing to drift from.

If you already run an API gateway, the MCP gateway is usually an extension of it, not a separate piece of infrastructure. If you do not, this is the moment to stop postponing it.

---

### What an MCP gateway must do: four jobs

A serious MCP gateway in 2026 has four jobs. Any candidate that does one or two is a prototype; it is not ready for the traffic agents will generate.

**1. Tool exposure.** The gateway turns your existing API surface into tools agents can discover and call. In practice that means synthesising tool schemas from your OpenAPI definitions (or whatever spec language you use), presenting them via `tools/list`, and translating `tools/call` into upstream HTTP requests. Opt-out should be per-operation: admin endpoints, destructive actions, and anything with blast radius too wide for an agent should be trivial to hide.

**2. Governance.** Everything your API gateway already does, applied to tool calls: authentication, authorization, rate limits, request and response validation, transformations, consumer ACLs. The important word is *applied*, not *re-implemented*. If your gateway has OPA policies in production, those policies should cover tool calls on day one, not after a six-month re-plumbing project.

**3. Observability.** Every tool call should produce a trace, a metric, and a log entry in the same format as every other request your platform emits. Agent-caused incidents are hard enough to debug without a separate telemetry stack. Prometheus metrics per tool and per consumer, OpenTelemetry spans linked to upstream requests, structured audit logs with the agent identity and the tool invoked.

**4. AI-specific middleware.** This is the new job. Agents are not regular API consumers. They are cheaper, faster, dumber, and more prone to loops than humans. A mature MCP gateway layers AI-specific governance on top of the API-gateway basics:

- **Prompt guarding.** PII scrubbing, regex allow and deny lists, shape constraints on inbound prompts. Shift-left where possible so bad inputs fail at lint time rather than at call time.
- **Token limits.** Token-based sliding windows per consumer, per operation, per tenant. Request-per-second is the wrong denominator for LLM-adjacent traffic.
- **Cost tracking.** Per-operation spend as Prometheus metrics. Budget alerts and cost attribution across tenants, teams, and agents.
- **Response guarding.** Output scrubbing, schema re-validation, and policy checks before responses leave the gateway.

None of these are unique to MCP. All of them are missing from the typical 2022-era API gateway. That is the gap the MCP gateway category is filling.

---

### MCP gateway vs AI gateway vs API gateway

Three words that sound interchangeable, and are not. Getting the disambiguation right saves your team from buying the wrong thing.

**API gateway.** Manages HTTP traffic between clients and your internal services. Authentication, rate limits, routing, validation. Kong, Tyk, Apigee, AWS API Gateway, KrakenD. Table stakes for any platform team.

**AI gateway.** Ambiguous term, usually meaning an *outbound* AI gateway: sits between your application and an LLM provider (OpenAI, Anthropic, your hosted model). Manages API keys, caches responses, tracks token usage, offers fallbacks. Portkey, LiteLLM, Cloudflare AI Gateway, Helicone. If your application calls LLMs, this is where you centralise that.

**MCP gateway.** *Inbound* AI gateway: sits between an AI agent and *your* APIs. Exposes your operations as tools, governs the calls, tracks costs, enforces policy. Different problem from an outbound AI gateway. Complementary, not substitutable.

Many teams end up running all three. The outbound AI gateway stops your app from exploding your OpenAI bill. The MCP gateway stops the agents that call your APIs from exploding your production. The API gateway handles the boring HTTP that underlies both. They are not the same box, and collapsing them is usually how shadow stacks start.

---

### Why spec-first matters

The single biggest difference between the MCP gateways that will still be running in 2028 and the ones that quietly die is whether they are spec-first.

Tool schemas are, unavoidably, derived from something. You can type them by hand into a config file per tool, and watch them drift from the real API within a quarter. Or you can derive them from the thing your API team already maintains, which is the OpenAPI (or AsyncAPI, or GraphQL) spec.

When the spec is the source of truth, you get a set of nice properties for free:

- Adding an endpoint adds a tool. No parallel deploy pipeline.
- Renaming a field renames the tool parameter. No second file to update.
- Shift-left lint (with Vacuum, Spectral, or similar) catches missing `operationId`s and descriptions before agents ever see them.
- Opt-out is a spec annotation, not a separate access-control document.
- The documentation your frontend team reads is the same documentation the agents consume. Contract-first becomes agent-first by default.

Gateways that treat the spec as input and the tool surface as output inherit these properties. Gateways that require manual tool registration do not. The ecosystem will converge on the first pattern because the second is unsustainable at any team size.

---

### What to look for when picking one

A short checklist for the 2026 buyer:

- **Standard transport.** JSON-RPC 2.0 over HTTP POST is the interoperable default. Avoid products that invent their own wire format.
- **Spec-first tool derivation.** Your OpenAPI spec is the input, not a second thing to maintain.
- **Opt-out model.** Everything becomes a tool unless you say otherwise, with per-operation overrides. Opt-in sounds safer and turns into a coverage gap.
- **Middleware composition.** Auth, rate limits, and validation should be the same primitives your non-MCP traffic already uses. If the MCP path has its own parallel middleware catalog, you have bought a shadow stack.
- **AI governance.** Prompt guard, token limits, cost tracking, response guard, ideally as first-class plugins rather than as a separate sidecar you also have to operate.
- **Self-hostable and open-source.** MCP gateways sit inside your network, next to your authentication, next to your audit logs. Treat them like you treat your API gateway: prefer software you can read, patch, and run on your own infrastructure.
- **Observability in the format you already use.** Prometheus, OpenTelemetry, structured logs. No snowflake telemetry.
- **Compliance posture.** If you are in a regulated industry, check for FIPS, audit log formats, and on-prem deployment options. The agent era is not going to make your compliance team less cautious.

Anything missing two or three of the above is fine as a prototype and risky as a production bet.

---

### Closing thoughts

The MCP gateway category is in the same place the API gateway category was in around 2012: the pattern is obvious in retrospect, the first-generation tools are uneven, and the teams that adopt the pattern early avoid a class of scaling pain that will make the teams that do not look, later, like they took a wrong turn.

If you are on a platform team and agents are not yet in your threat model, they are about to be. If you are on an AI product team and your agents are still calling internal APIs with hand-rolled tool servers, the shadow stack is already forming. The good news is the fix is cheap compared to the sprawl it prevents.

At Barbacane we are building the MCP gateway that takes this seriously: open source, Rust-native, spec-first, with the MCP layer integrated into the API gateway rather than bolted beside it. If that sounds like what you need, [the /mcp page](/mcp/) is the five-minute version. Otherwise, the ideas above hold regardless of which tool you pick. The category matters more than the product.
