---
title: "Barbacane vs Portkey and LiteLLM: picking an AI gateway in 2026"
description: "Portkey, LiteLLM, and Barbacane all ship an outbound AI gateway. Where they diverge is what else the gateway does: spec-first routing, MCP for the inbound direction, and composition with the rest of your API governance. An honest comparison for teams picking one."
publishDate: 2026-04-29
author: "Nicolas Dreno"
tags: ["ai-gateway", "mcp-gateway", "portkey", "litellm", "comparison", "model-context-protocol", "ai-governance"]
draft: false
---

*If you are picking an AI gateway in 2026, Portkey, LiteLLM, and Barbacane are all real options. They overlap enough to make the choice real, and they differ enough that the right answer depends on what else you want your gateway to do.*

Every AI-gateway evaluation runs into the same question after the first demo: once your OpenAI calls go through a gateway, what about everything else? The rate limits your platform team owns, the auth your security team owns, the audit trail your compliance team owns, the spec-first workflow your API team relies on, the agents calling back the other way. The more of that lives next to the AI traffic, the more the choice of AI gateway becomes an architecture decision and not a feature match.

This post compares the three products on that axis. What they share. What separates them. How to pick.

---

### The overlap: outbound LLM proxying

All three products sit between your application and one or more LLM providers. All three give you:

- **Provider abstraction** with an OpenAI-compatible API surface
- **Fallback chains** when a provider errors, times out, or is unreachable
- **Token usage and latency metrics** per call and per provider
- **Budget and rate-limit guardrails** at the gateway layer
- **Prompt and response guardrails** (scope varies by product)

If outbound LLM proxy is all you need, all three will work. The differences show up in what else the gateway does, how it is configured, and what happens when your requirements grow beyond the LLM path.

---

### What Portkey is

Portkey is a commercial AI gateway, available as managed SaaS or self-hosted. It focuses specifically on the LLM path and invests heavily in the operator experience: a configuration UI, a playground, a prompt library, an observability dashboard purpose-built for LLM traffic. It tends to be the right pick if you want an AI gateway as a product (vendor support, managed upgrades, fancy UI) and AI is the thing your team cares about most.

### What LiteLLM is

LiteLLM is an open-source Python proxy that exposes a very broad set of LLM providers behind one unified OpenAI-compatible API. Actively developed, wide provider coverage, can run as a Python library or as a proxy server. Good pick if you want broad provider support, an MIT-licensed OSS foundation, and a Python-native runtime that plays well with your ML tooling.

### What Barbacane is

Barbacane is an open-source, Rust-native API gateway. AI capability is built from composable plugins rather than a monolithic feature:

- **`ai-proxy` dispatcher** routes requests to OpenAI, Anthropic, and Ollama (plus any OpenAI-compatible endpoint: vLLM, TGI, LocalAI, Azure). The client always sends OpenAI format; the dispatcher translates per provider, pins the provider API version, and handles SSE streaming where the provider supports it.
- **Named targets + `cel` middleware** express policy-driven routing. A target like `premium` is a full provider profile (provider, model, credentials); the `cel` middleware writes `ai.target` into the request context when a rule matches, and the dispatcher picks the target from there. Credentials never leave dispatcher config.
- **`ai-prompt-guard`, `ai-token-limit`, `ai-cost-tracker`, `ai-response-guard`** middlewares compose around the dispatcher. Each is a separate, skippable concern with named profiles, CEL expressions, and fail-closed defaults on misconfig.

And one more capability Portkey and LiteLLM do not offer: Barbacane is also an [MCP gateway](/mcp/). The same artifact that proxies your LLM traffic outbound also exposes your existing APIs to AI agents as tools inbound. One gateway covers both directions of AI traffic.

---

### The architectural difference: monolithic AI proxy vs dispatcher plus middlewares

This is where the three products diverge.

Portkey and LiteLLM treat the AI gateway as a unified product: one binary, one config, one API surface. Every operational concern (rate limits, caching, observability, guardrails) is a feature baked into the proxy. This is the right shape when AI is the only traffic the gateway handles.

Barbacane treats the AI gateway as a set of primitives you compose:

- The `ai-proxy` dispatcher handles translation and routing.
- Each concern is a separate middleware, ordered explicitly in the spec.
- You stack the middlewares you need, skip the ones you do not, and compose multiple instances of the same plugin (stack two `ai-token-limit` instances for a minute-and-hour window, stack multiple `cel` rules for routing).
- The exact same primitives govern non-AI traffic on the same gateway.

The trade-off is sharp. If you want the shortest path from zero to "OpenAI call via a gateway", Portkey and LiteLLM win on time-to-live. If you want AI traffic governed the same way your team already governs every other HTTP request, Barbacane's composition model gets you there without a second product to run, a second config source to reconcile, or a second telemetry stack to watch.

The architectural bet is the same one the service-mesh community made five years ago: specialized proxies for specialized traffic, or one data plane that handles every protocol your platform cares about. Both are valid; they produce different operational footprints.

---

### Spec-first: OpenAPI as source of truth

Portkey and LiteLLM configure AI routes in their own config files (YAML for LiteLLM, config UI or SDK for Portkey). Barbacane configures AI routes in your OpenAPI spec:

```yaml
paths:
  /v1/chat/completions:
    post:
      operationId: chatCompletion
      summary: Route LLM chat completion requests
      x-barbacane-dispatch:
        name: ai-proxy
        config:
          provider: openai
          model: gpt-4o
          api_key: "${OPENAI_API_KEY}"
          fallback:
            - provider: anthropic
              model: claude-sonnet-4-20250514
              api_key: "${ANTHROPIC_API_KEY}"
            - provider: ollama
              model: llama3
              base_url: http://ollama:11434
```

The documentation your frontend team reads, the client SDKs they generate, the contracts your platform team enforces, and the gateway config your SRE team operates all derive from the same file. Adding an LLM route adds an entry in the spec. Renaming a parameter renames it everywhere. Vacuum-based lint runs shift-left in your editor, in a pre-commit hook, or in CI, so provider typos and invalid regex patterns fail at lint time, not at call time.

If your organization is already spec-first for non-AI APIs, extending that discipline to AI routes is the cheapest integration path. If you do not run spec-first APIs, Portkey and LiteLLM feel more familiar because they do not ask you to change your workflow.

---

### The inbound direction: MCP

One axis Portkey and LiteLLM do not compete on.

Portkey and LiteLLM sit between your application and the LLM. They do not stand between an AI agent and your APIs. That inbound direction is a different gateway category; we covered it at length in the [canonical MCP gateway post](/blog/what-is-an-mcp-gateway/).

Barbacane is a full MCP gateway in addition to its outbound AI capability. One artifact handles both directions. Whether that matters depends on whether agents calling your APIs is in scope:

- If you are building an agent product and your agents only hit public tools and third-party services, the inbound direction does not apply and the MCP capability is not doing work for you.
- If your agents call your internal APIs, or if you are a platform team preparing to expose internal APIs to agents built elsewhere, the inbound direction is real work. Barbacane treats it as a first-class concern. Portkey and LiteLLM leave it outside the gateway entirely, which means a separate MCP server per service and all the sprawl the canonical post describes.

---

### When to pick which

| Situation                                                                           | Pick                          |
|---                                                                                 |---                            |
| Fastest path from zero to an OpenAI call via a gateway, with an operator UI        | Portkey                       |
| Very broad LLM provider coverage, Python-native, OSS-first                         | LiteLLM                       |
| Managed SaaS with vendor support and a polished dashboard                          | Portkey                       |
| AI gateway as part of a broader API gateway, not a second box                      | Barbacane                     |
| AI routes defined in your OpenAPI spec alongside the rest of your API              | Barbacane                     |
| Same gateway also exposes your APIs to AI agents via MCP                           | Barbacane                     |
| OSS, self-hostable, Rust-native, FIPS-ready for regulated-industry posture         | Barbacane                     |
| Platform team; AI is one of many gateway concerns (auth, routing, observability)   | Barbacane                     |
| AI-first product team; LLM calls are the only traffic the gateway proxies          | Portkey or LiteLLM            |

---

### Feature comparison

A compact, direction-setting comparison. All three products evolve; check current docs before committing.

| Concern                              | Portkey                  | LiteLLM                    | Barbacane                                              |
|---                                   |---                       |---                         |---                                                     |
| Outbound LLM proxy                   | Yes                      | Yes                        | Yes (`ai-proxy` dispatcher)                            |
| Inbound MCP gateway                  | No                       | No                         | Yes                                                    |
| Provider coverage                    | Broad                    | Very broad (100+ models)   | OpenAI, Anthropic, Ollama, plus any OpenAI-compat API  |
| Provider fallback                    | Yes                      | Yes                        | Yes                                                    |
| Policy-driven routing                | Yes                      | Yes                        | Yes (via `cel` middleware + named targets)             |
| Prompt and response guardrails       | Built in                 | Built in                   | `ai-prompt-guard` + `ai-response-guard` middlewares    |
| Token rate limits                    | Built in                 | Built in                   | `ai-token-limit` middleware                            |
| Cost tracking                        | Built-in dashboard       | Built-in metrics           | `ai-cost-tracker` middleware                           |
| Source of truth for config           | Config UI or SDK         | YAML config                | OpenAPI spec                                           |
| Runtime                              | SaaS and self-host       | Python proxy               | Rust binary                                            |
| License                              | Commercial               | MIT                        | AGPLv3 + commercial                                    |
| Governs non-AI HTTP traffic          | No                       | No                         | Yes (full API gateway)                                 |

Where a row says "No", the product was not designed for that concern. Forcing a tool into the wrong role is how shadow stacks start.

---

### What to watch for during procurement

If you are being pitched an AI gateway and the first question is "do you already run an API gateway?", you are in the right conversation. If it is not asked, ask it yourself. The answer changes what you need from the new product.

A short procurement checklist:

1. **Where does AI gateway config live?** If the answer is "a second config file", you are creating a drift source. Prefer products that integrate with the spec or config surface your team already uses.
2. **Is the feature set monolithic or composable?** Monolithic is simpler day one and harder to extend. Composable is more to learn and easier to shape to your operational model.
3. **Does it govern agent traffic too?** If agents calling your APIs is on your roadmap, ask about MCP. If not, skip.
4. **How does it integrate with your observability stack?** Prometheus, OpenTelemetry, structured logs. Avoid products that ship their own telemetry you have to separately consume.
5. **Self-hosting path and license.** SaaS is fine for many teams; regulated, on-prem, or air-gapped environments will need an OSS, self-hostable option.

---

### Closing thoughts

All three products handle the core outbound LLM path competently. The axis that differentiates them is how the AI gateway relates to the rest of your infrastructure:

- If AI is the primary problem and the AI gateway stands alone, **Portkey or LiteLLM** will get you live faster. Pick Portkey if you want SaaS with a UI. Pick LiteLLM if you want OSS breadth and a Python runtime.
- If AI is one of several gateway concerns and you want one spec-first artifact covering auth, rate limits, routing, AI, and MCP, **Barbacane** is the architecture fit.

Pick by architecture, not feature count. The feature sets will converge; the architectural assumptions will not.

For the Barbacane side of the comparison, [the /mcp page](/mcp/) is the five-minute version, and the [canonical MCP gateway post](/blog/what-is-an-mcp-gateway/) is the longer read. For Portkey and LiteLLM, their own docs are the right place to start; their positioning is consistent enough that a fair comparison is easier now than it was a year ago.
