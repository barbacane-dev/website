---
title: "Less is better: why we removed the AI gateway, MCP and the web UI"
description: "Barbacane 1.0 ships with roughly 27,000 fewer lines than 0.12. Here is why a zero-trust API gateway gets stronger by doing less, and what we took out to get there."
publishDate: 2026-11-06
author: "Nicolas Dreno"
tags: ["barbacane", "security", "zero-trust", "engineering"]
draft: true
---

*The most secure line of code is the one that is not there.*

On the road to 1.0, we did something that rarely makes a changelog look exciting: we deleted features. The AI gateway is gone. The MCP server is gone. The web UI is gone. Together that is roughly 27,000 lines of Rust, TypeScript, tests and documentation that no longer ship with Barbacane.

This post explains why. The short version: we are building a light, robust, zero-trust API gateway, and every one of those features was pulling in the opposite direction.

---

### What we took out

**The AI gateway.** An `ai-proxy` dispatcher that spoke to OpenAI, Anthropic and Ollama behind one OpenAI-compatible surface (Chat Completions, the Responses API, an aggregated model catalog), plus four middlewares for prompt guarding, token limits, cost tracking and response redaction. About 8,000 lines of Rust.

**The MCP server.** An endpoint that turned the operations in your spec into Model Context Protocol tools for AI agents, with its own JSON-RPC handling and its own session store. About 1,700 lines inside the data plane, plus compiler support.

**The web UI.** About 10,000 lines of TypeScript and the web server that served them from the control-plane image. A command-line client replaces it, talking to the same authenticated control-plane API.

None of these were bad ideas, and some of you used them. They were simply not what Barbacane is for.

---

### Reason one: it already exists somewhere else

When we started on AI features, every gateway was racing to add them, and we did too. A year later, the picture is clearer. Routing LLM traffic is a product category of its own, with teams that do nothing else. Provider APIs change every few weeks: a new endpoint, a new streaming format, a new way to describe tool calls. Keeping a translation layer correct for three providers is a full-time job, and our open issues showed it.

The same goes for MCP. Generating agent tools from an OpenAPI document is useful, and dedicated tools do it well, outside the request path of your production gateway.

Barbacane's job is narrower and, I think, more valuable: stand in front of your APIs and enforce the contract you wrote. If you route LLM traffic, put a dedicated LLM gateway behind Barbacane as an upstream. Barbacane still authenticates the caller, validates the request against your spec, applies your rate limits and runs the WAF. Each component does one thing, and you choose the best tool for each.

---

### Reason two: everything you ship, you maintain

A feature is never just its code. Each one came with integration tests, fixtures, documentation pages, lint rules, CI jobs, dependency updates and its share of every security advisory. The web UI had not changed meaningfully in months, yet it still needed its JavaScript dependencies patched, its end-to-end tests kept green and its web server configured and hardened.

That time came from somewhere. Every hour spent following a provider's API change or upgrading a frontend toolchain was an hour not spent on request validation, on the WAF, on the plugin sandbox: the parts that every Barbacane user relies on, on every request.

Removing features is how a small team keeps its promises about the ones that remain.

---

### Reason three: every line is attack surface

A gateway is the most exposed component you run. It faces the internet, it holds credentials for your upstreams, and it decides who gets in. Everything inside it is something you have to trust.

Every endpoint is an entry point. Every parser is a place where malformed input arrives first. Every session store is state that has to be protected, expired and bounded. Every dependency is a feed of future advisories. The MCP server added an endpoint, a JSON-RPC parser, a session store and a second protocol to secure alongside HTTP. The AI plugins added provider clients, regex engines over untrusted text and streaming translation. The web UI added a browser application with administrative powers and a web server in front of it.

None of that makes Barbacane better at its core job. All of it makes the trusted code larger.

---

### Zero trust is subtraction

Zero trust is often presented as something you add: more checks, more policies, more tokens. In practice, the strongest move is usually the opposite. You reduce what has to be trusted until what remains can actually be verified.

That is the logic behind how Barbacane works:

- **Only what the spec declares gets through.** Undeclared operations are refused, every input is validated against its schema, and request headers the spec does not mention are dropped before any plugin sees them.
- **Artifacts are sealed and signed.** What runs is what you compiled, and a pinned key makes the gateway refuse anything else.
- **Plugins get a sandbox, not the keys.** Each one declares the host functions it needs, and the data plane refuses one that asks for more.

Removing features is the same principle applied to the gateway itself. A smaller data plane is easier to audit, easier to fuzz, faster to start and simpler to reason about when something goes wrong at three in the morning. We would rather ship a gateway you can read end to end than one that does everything.

You can see how this plays out, control by control, on our new [security page](/security/).

---

### What this means if you used these features

Barbacane 1.0 is a breaking release. If you rely on `ai-proxy`, the AI middlewares, MCP or the web UI, 0.12 keeps working as it does today, and the [changelog](https://github.com/barbacane-dev/barbacane/blob/main/CHANGELOG.md) lists every removal. The artifact format moves to version 8, so artifacts must be recompiled for 1.0.

Our earlier articles about AI and MCP stay online. They are an honest record of what we explored, and the questions they raise about agents and APIs remain real. We just no longer think the answer belongs inside your gateway.

---

### Light, robust, zero trust

That is the whole roadmap for 1.0: a gateway that is light enough to run anywhere, robust enough to fail at build time instead of in production, and suspicious enough to trust nothing it has not checked.

Doing less is how we get there.
