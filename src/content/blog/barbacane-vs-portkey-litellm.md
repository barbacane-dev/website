---
title: "Barbacane vs Portkey and LiteLLM: inbound vs outbound AI gateways"
description: "You need to stop your application from exploding the OpenAI bill. You also need to stop agents from exploding your production APIs. These are different problems with different gateways. Here is how to tell them apart, and why most teams end up running both."
publishDate: 2026-04-29
author: "Nicolas Dreno"
tags: ["mcp-gateway", "ai-gateway", "portkey", "litellm", "comparison", "model-context-protocol", "ai-governance"]
draft: true
---

*If your team is running agents in production, someone has already asked about Portkey or LiteLLM. Someone else has started asking about MCP. Both groups are right, and they are not asking about the same thing.*

The AI gateway market in early 2026 is confused by a vocabulary problem. "AI gateway" describes two categories that share exactly one letter in common, and asking a buyer to pick one over the other is like asking them to pick between a load balancer and a CDN. You probably want both.

This post is a map. What Portkey and LiteLLM are for. What Barbacane is for. Where they overlap (almost nowhere). How they compose (they do, cleanly). When you need which.

---

### Two different directions of traffic

Start with the bottom of the stack. Every AI gateway sits in the path of one of two kinds of traffic:

**Outbound AI traffic.** Your application calls an LLM provider. You send prompts and tokens out, you get completions back. The outbound gateway is a proxy in front of OpenAI, Anthropic, Bedrock, Gemini, or your own hosted model. Portkey and LiteLLM are outbound gateways.

**Inbound AI traffic.** An AI agent calls your APIs. The agent discovers tools, picks one, and invokes it. The inbound gateway is a proxy in front of your own services, speaking the Model Context Protocol on the agent-facing side. [Barbacane](/mcp/) is an inbound gateway.

The two travel opposite directions. That is why "AI gateway" collides badly as a term: the same word is doing double duty for two products that touch different parts of your infrastructure, solve different problems, and typically do not compete at procurement.

---

### What Portkey and LiteLLM do, concretely

Portkey and LiteLLM are not identical, but they solve the same category of problem. Both let your application call LLMs through one interface, with the operational controls an application team needs.

Both typically provide:

- **Provider abstraction.** Swap OpenAI for Anthropic with a config change, not a code change.
- **Fallbacks and retries.** If one provider errors, try another. If the first attempt fails, back off and try again.
- **Caching.** Identical prompts can return cached completions, saving latency and tokens.
- **Observability.** Per-call traces, token usage, latency histograms, cost dashboards.
- **Budget guardrails.** Spend limits per key, tenant, or user.
- **Prompt safety.** Varies by product, but most offer some form of scrubbing and policy enforcement on the prompt leaving your infrastructure.

Portkey and LiteLLM do these jobs well. If your application sends prompts to an LLM, you should be running one of them, or something similar, between the application and the provider. Calling OpenAI directly from production code without this layer is a common way to turn a weekend experiment into a Monday incident.

---

### What Barbacane does, concretely

Barbacane is an [MCP gateway](/blog/what-is-an-mcp-gateway/). It does not sit between your application and OpenAI. It sits between an AI agent and your internal APIs, turning operations in your OpenAPI spec into MCP tools the agent can discover and call.

Specifically:

- **Tool exposure.** Your existing OpenAPI spec compiles into an MCP tool server. Every operation with an `operationId` and a `summary` becomes a typed, agent-callable tool.
- **Opt-out per operation.** Hide admin endpoints, destructive actions, or anything you do not want agents touching, with a spec annotation.
- **Middleware pass-through.** Tool calls are HTTP requests under the hood. Your existing auth, rate limits, validation, transformations, and observability apply without re-plumbing.
- **AI governance.** Prompt guarding, token limits, cost tracking, response guarding, layered on top of the API-gateway basics.
- **Spec-first.** The schema agents see is derived from the spec your API team already maintains. No parallel source of truth.

None of this is a replacement for what Portkey or LiteLLM do. Your agent still needs an outbound LLM gateway to talk to its model. Barbacane does not talk to LLMs at all.

---

### How they compose

Most production systems running agents in 2026 look roughly like this:

```
  [your application]
         |
         v
  [outbound AI gateway]      <- Portkey / LiteLLM
         |
         v
  [LLM provider]             <- OpenAI / Anthropic / self-hosted
         |
         v  (the model decides to call a tool)
         |
  [MCP-compatible agent]
         |
         v
  [inbound AI gateway / MCP gateway]   <- Barbacane
         |
         v
  [your APIs and services]
```

The outbound gateway is everything between your application and the model. The inbound gateway is everything between the agent and your infrastructure. The agent itself is the hinge.

If you are building an agent product end-to-end, you probably want both. If you are only publishing APIs to be used by agents built elsewhere (which is the more common case for platform teams), you only need the inbound gateway. If you are only calling LLMs from your application without running agents against your APIs, you only need the outbound one.

---

### Where the overlap actually is

There is one real overlap worth naming, so nobody buys the same thing twice: **AI governance middleware.**

Both categories have to think about prompt safety, cost attribution, and rate limiting. The middleware surface looks similar on paper. The differences:

- Outbound gateways govern traffic *your application sends to the LLM*. The prompt being guarded is written by your code or your user, on the way out.
- Inbound gateways govern traffic *an agent sends to your APIs*. The prompt, if there is one, is written by the agent and has already passed through the model, on the way in.

Both layers are useful. They catch different things. A prompt-injection pattern that slips past your outbound PII scrubber can still be caught by your inbound response guard before it reaches the user. Budget limits at the outbound layer control what you pay OpenAI. Budget limits at the inbound layer control what the agent costs *you* to serve.

Treating them as redundant is a mistake. Running both is defense in depth.

---

### When you need which: a decision table

| Situation                                                                     | You need                                 |
|---                                                                            |---                                       |
| Your application calls OpenAI or Anthropic directly                           | Outbound AI gateway (Portkey, LiteLLM)   |
| You want one interface across multiple LLM providers                          | Outbound AI gateway                      |
| You want caching, retries, fallbacks, and cost dashboards for LLM calls       | Outbound AI gateway                      |
| Your APIs are going to be called by AI agents                                 | Inbound AI gateway / MCP gateway         |
| You want your existing OpenAPI operations to become MCP tools                 | MCP gateway                              |
| You want auth, rate limits, and audit applied to agent tool calls             | MCP gateway                              |
| You want to cap how much agents can cost you to *serve*                       | MCP gateway                              |
| You are shipping an end-to-end agent product                                  | Both                                     |
| You are a platform team enabling other teams' agents                          | MCP gateway; outbound is their problem   |

---

### Feature comparison

A compact comparison. All three products evolve quickly, so treat this as direction, not specification. Check current docs before committing.

| Concern                          | Portkey                   | LiteLLM                   | Barbacane                |
|---                               |---                        |---                        |---                       |
| Direction of traffic             | Outbound                  | Outbound                  | Inbound                  |
| Primary surface                  | LLM provider API          | LLM provider API          | MCP tool server          |
| Source of truth for tools        | N/A                       | N/A                       | Your OpenAPI spec        |
| Protocol                         | HTTP JSON                 | HTTP JSON                 | JSON-RPC 2.0 (MCP)       |
| Runtime                          | SaaS or self-host         | Python proxy, self-host   | Rust binary, self-host   |
| License                          | Commercial + OSS core     | Open source (MIT)         | AGPLv3 + commercial      |
| Typical buyer                    | Application team          | Application team          | Platform or AI team      |
| Governs agent calls to your APIs | No                        | No                        | Yes                      |
| Governs calls to LLM provider    | Yes                       | Yes                       | No                       |

Where a row says "No", the product was not designed for that concern. Forcing a tool into the wrong role is how shadow stacks start.

---

### What to watch for during procurement

If you are being pitched an "AI gateway" and the direction of traffic is not the first slide, ask. If you are being told a product does both inbound and outbound, dig into which side has actual engineering depth. Most products excel on one side and offer thin coverage on the other, usually because the sides solve structurally different problems and require different primitives.

The healthy procurement pattern:

1. **Decide which direction matters.** If you are a platform team, start with inbound. If you are an application team, start with outbound. If you are both, buy both.
2. **Prefer specialists over generalists.** A sharp inbound gateway and a sharp outbound gateway compose cleanly. A vague do-everything gateway usually means you rebuild the missing side yourself later.
3. **Check the seam.** Verify that the outbound gateway's audit logs can correlate with the inbound gateway's audit logs, ideally on the agent identity. When an incident happens, you will want to follow the request from application through LLM through agent through your API without stitching together three different telemetry stacks.

---

### Closing thoughts

Portkey and LiteLLM are good at what they do. Barbacane is good at what it does. They are not in the same evaluation.

If you are running agents in production and your infrastructure includes only one of these two gateway categories, you have a blind spot. If you are still deciding which to adopt first, ask which direction of traffic is currently unguarded. That is the gateway you need next.

For the inbound side, [Barbacane's /mcp page](/mcp/) is the five-minute version. For the outbound side, Portkey's and LiteLLM's own docs are the right place to start. The category distinction is doing most of the work; from there, evaluation is the usual procurement grind.
