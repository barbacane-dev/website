---
title: "API Retirement Done Right: How Spec-Driven Gateways Turn End-of-Life Into a Non-Event"
description: "APIs are easy to launch and nearly impossible to kill. Explore how Barbacane's compiled, spec-driven approach turns API retirement from an organizational ordeal into a routine lifecycle operation."
publishDate: 2026-03-03
author: "Nicolas Dreno"
tags: ["barbacane", "api-gateway", "api-lifecycle", "versioning", "openapi", "deprecation"]
---

*APIs are easy to launch and nearly impossible to kill.*

Most API programs invest heavily in design, launch, and adoption. Far less attention is given to what happens years later, when early versions remain active long after their original purpose has faded. The result is predictable: APIs accumulate. v1 still runs alongside v2 and v3. Each version carries its own routing rules, authentication flows, rate limits, and schema quirks. Nobody is confident enough to turn anything off, because nobody knows who's still calling what.

This isn't a discipline problem. It's a visibility problem, amplified by tooling that was never designed to make retirement safe.

---

### The Long Tail of Legacy Versions

The original intent behind strict backward compatibility is sound. Breaking client integrations damages trust and disrupts revenue-generating workflows. So teams avoid removing endpoints, even when newer versions exist and migration guides have been published for months.

Over time, this creates real operational drag:

- **Expanded testing surface.** Every release must be validated against every active version. Three concurrent versions don't triple the effort, but they come close.
- **Security exposure.** Legacy endpoints may use deprecated authentication schemes, outdated schemas, or pre-date current authorization policies. Each is a potential vulnerability that must still be monitored and patched.
- **Incident complexity.** When something breaks, the investigation must account for historical behaviors across versions. "Which version was the client calling?" becomes the first question in every postmortem.
- **Documentation burden.** Maintaining accurate docs for versions that nobody wants to support but nobody dares to remove.

The fundamental challenge is uncertainty. Organizations frequently lack clear visibility into who is still consuming older versions, how heavily, and whether those consumers have been notified about available upgrades.

---

### Why Traditional Gateways Make Retirement Harder

In a conventional gateway setup, the API specification and the gateway configuration are separate artifacts maintained by separate processes. This dual-source model, the [configuration drift problem](/blog/beyond-configuration-drift/) we've discussed before, makes retirement particularly painful.

Consider what it takes to retire `v1` of an API on a traditional gateway:

1. **Identify what's running.** Which routes belong to v1? Are they in the same config file as v2, or spread across multiple configurations? Are there routes that were added as hotfixes and never documented in any spec?
2. **Determine who's calling.** Gateway logs might tell you about traffic patterns, but correlating log entries to specific consumer identities across versions requires additional telemetry that may or may not exist.
3. **Coordinate the removal.** Delete routes from the gateway config. Update the spec (if it's still maintained). Remove documentation. Hope nothing was missed.
4. **Verify nothing broke.** Because the config and spec are separate, removing something from one doesn't guarantee it's gone from the other. The gateway might still serve a route that was "retired" in the spec, or the spec might still document a route that was removed from the config.

At every step, the gap between specification and configuration creates ambiguity. And ambiguity is what makes retirement decisions stall. When you can't confidently answer "what exactly will change when we remove this?", the safe default is to do nothing.

---

### Lean on OpenAPI - Don't Reinvent

Barbacane's approach to API lifecycle is deliberately minimal: use what OpenAPI already gives you, and make the gateway enforce it. No custom lifecycle DSL. No retirement orchestration layer. Just standard fields, compiled into standard behavior.

This philosophy extends to versioning itself. Barbacane does not impose a versioning strategy. URL-path versioning (`/v1/users`, `/v2/users`), header-based content negotiation, or separate spec files per version - all work because the gateway routes what the spec declares. Versioning is a spec concern, not a gateway concern.

What Barbacane *does* add is enforcement. When you mark something as deprecated in your spec, the gateway acts on it. When you remove a route from the spec, it's gone from the gateway. There's no separate configuration layer where retired routes could linger.

---

### Deprecation: Built Into the Spec, Enforced by the Gateway

OpenAPI has a standard `deprecated` field on operations. Most tools treat it as documentation metadata. Barbacane treats it as a runtime directive.

```yaml
paths:
  /v1/users:
    get:
      deprecated: true
      summary: List users (deprecated, use /v2/users)
      x-barbacane-dispatch:
        name: http-upstream
        config:
          url: "https://api.example.com"
```

When a client calls a deprecated endpoint, Barbacane does three things automatically:

1. **Serves the request.** Deprecated does not mean removed. The endpoint still works, preserving backward compatibility during the migration window.

2. **Injects a `Deprecation: true` response header** per [draft-ietf-httpapi-deprecation-header](https://datatracker.ietf.org/doc/draft-ietf-httpapi-deprecation-header/). Well-behaved HTTP clients and API tooling surface this automatically.

3. **Increments a dedicated metric:** `barbacane_deprecated_route_requests_total`, labeled by method, path, and API name. This is the telemetry that makes retirement decisions data-driven.

No middleware to configure. No plugin to enable. The `deprecated` field in your OpenAPI spec is all it takes.

---

### Sunset Headers: Communicating the Timeline

Deprecation signals intent. The [Sunset HTTP header](https://datatracker.ietf.org/doc/html/rfc8594) (RFC 8594) signals a deadline. Barbacane supports both through a single extension:

```yaml
paths:
  /v1/users/{id}:
    get:
      deprecated: true
      x-sunset: "Sat, 01 Jun 2026 00:00:00 GMT"
      summary: Get user by ID (use /v2/users/{id})
      x-barbacane-dispatch:
        name: http-upstream
        config:
          url: "https://api.example.com"
```

The response now carries both signals:

```
HTTP/1.1 200 OK
Deprecation: true
Sunset: Sat, 01 Jun 2026 00:00:00 GMT
Content-Type: application/json
```

The sunset date uses HTTP-date format (RFC 9110). It's machine-readable, so automated monitoring tools can alert consumers about approaching deadlines without manual outreach.

And because the `x-sunset` value lives in the spec, it's visible in code review, tracked in Git, and compiled into the artifact. The `/__barbacane/specs` endpoint preserves `x-sunset` in the served specs, so developer portals and API catalogs consuming those specs can display retirement timelines to consumers automatically.

---

### Telemetry: Knowing When It's Safe

The biggest blocker to API retirement is "we don't know who's still using it." The `barbacane_deprecated_route_requests_total` metric directly addresses this.

Because the metric is labeled by method, path, and API name, you can query Prometheus for exactly the data you need to make retirement decisions:

- **Is v1 traffic declining after the deprecation announcement?** Track the counter over time.
- **Which endpoints are still receiving traffic?** Break down by path.
- **Are specific consumers still calling deprecated routes?** Combine with authentication telemetry to identify API keys or JWT subjects hitting deprecated endpoints.

When the counter flatlines, the removal becomes a confident operation rather than a leap of faith. When it doesn't, the data tells you exactly which endpoints need targeted outreach before you can proceed.

---

### Removal: Just Remove From Spec

When the sunset date passes and traffic has migrated, retirement is a one-line change:

```yaml
# Before: v1 and v2 coexist
paths:
  /v1/users:
    get:
      deprecated: true
      x-sunset: "Sat, 01 Jun 2026 00:00:00 GMT"
      # ...
  /v2/users:
    get:
      # ...
```

```yaml
# After: v1 removed
paths:
  /v2/users:
    get:
      # ...
```

The compiler produces an artifact without v1 routes. Requests to `/v1/users` return `404`. No separate configuration to clean up. No documentation to reconcile. No routes that might linger because someone forgot to update a YAML file in a different repo.

For multi-spec architectures, it's equally clean. Remove the spec file from the compile command:

```bash
# Before
barbacane compile \
  -s specs/users-v1.yaml \
  -s specs/users-v2.yaml \
  -m barbacane.yaml \
  -o gateway.bca

# After
barbacane compile \
  -s specs/users-v2.yaml \
  -m barbacane.yaml \
  -o gateway.bca
```

The compiled artifact now contains exactly one spec. The `/__barbacane/specs` endpoint reflects exactly what's running. There is no residual state.

---

### Git as the Lifecycle Ledger

In Barbacane's workflow, the full lifecycle of an API version, from introduction to deprecation to retirement, is captured in Git history:

1. **Introduction:** A PR adds `specs/users-v1.yaml` and includes it in the compile command
2. **Deprecation:** A PR adds `deprecated: true` and `x-sunset` to v1 operations
3. **Retirement:** A PR removes v1 routes or the entire spec file

Each transition is a reviewable, approvable change. The commit history answers questions that traditional gateways struggle with:

- *When was v1 deprecated?* Check the PR that added `deprecated: true`.
- *What was the announced sunset date?* Read the `x-sunset` value in that same diff.
- *Who approved the retirement?* Check the PR that removed the spec.
- *What exactly changed when v1 was retired?* The spec diff shows every route that disappeared.

For organizations with compliance requirements around change management, this audit trail covers the entire API lifecycle with no additional tooling.

---

### Migration Incentives

Clear deprecation signals and sunset dates reduce friction, but sometimes consumers need a stronger nudge. Rate limiting on deprecated versions encourages timely upgrades:

```yaml
# specs/users-v1.yaml (deprecated, reduced quota)
paths:
  /v1/users:
    get:
      deprecated: true
      x-sunset: "Sat, 01 Aug 2026 00:00:00 GMT"
      x-barbacane-middlewares:
        - name: rate-limit
          config:
            quota: 10        # was 100
            window: 60
            partition_key: "header:x-api-key"

# specs/users-v2.yaml (current, full quota)
paths:
  /v2/users:
    get:
      x-barbacane-middlewares:
        - name: rate-limit
          config:
            quota: 100
            window: 60
            partition_key: "header:x-api-key"
```

The deprecation policy is visible in the spec diff. A reviewer can see, in a single pull request, that v1's quota dropped from 100 to 10 while v2 remains unchanged. The intent is self-documenting.

---

### CI/CD as the Safety Net

Multi-spec compilation, which we covered in [One Gateway, Many Specs](/blog/one-gateway-many-specs/), gives you a compile-time safety net for retirement operations. Block merges to `main` if the combined specs don't compile cleanly:

```yaml
# .github/workflows/api-lifecycle.yml
jobs:
  validate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Compile gateway artifact
        run: |
          barbacane compile \
            -s specs/users-v2.yaml \
            -s specs/orders-v2.yaml \
            -m barbacane.yaml \
            -o gateway.bca
```

When you remove a spec from compilation, the compiler produces a new artifact with a smaller route set. A spec accidentally dropped from the compile command produces an artifact with fewer routes than expected. The pipeline ensures that retirement is intentional, not accidental.

---

### Strengths and Limitations

Barbacane's spec-driven model addresses the core challenge in API retirement: bridging the gap between intent and enforcement. But it's worth being precise about what it does and doesn't solve.

**What this approach gives you:**
- **Zero-config deprecation.** `deprecated: true` in the spec → `Deprecation` header in the response → counter in Prometheus. No middleware, no plugins.
- **Standards-compliant sunset signaling.** RFC 8594 `Sunset` header via `x-sunset`, machine-readable by any HTTP-aware tooling.
- **Atomic retirement.** Removing a spec removes all its routes, middleware, and configuration in one operation. No partial states.
- **Auditable lifecycle.** Every transition is a Git commit with a reviewable diff.
- **No configuration residue.** There's no separate config layer where retired routes could linger.

**What it doesn't solve:**
- **Consumer discovery.** Telemetry tells you *how much* traffic a version receives and from which identities, but Barbacane doesn't maintain a registry of registered consumers. If you need formal consumer onboarding and offboarding, that's a separate concern.
- **Client-side migration.** The gateway can signal deprecation and reduce quotas, but it can't rewrite client code. SDK updates, migration guides, and direct outreach remain necessary.
- **Automatic version negotiation.** Barbacane routes what the spec declares. Transparent redirects from v1 to v2, request transformation between versions - these are application concerns, not gateway concerns.

---

### The Bigger Picture

The apidays community recently highlighted API retirement as one of the most underserved areas of API lifecycle management. The diagnosis is accurate: most organizations lack the tooling and visibility to retire APIs confidently, so they don't. Versions accumulate. Operational overhead grows. Security surface expands.

The conventional response is to add process on top of existing tooling: retirement policies, sunset committees, usage audits. These help, but they're fighting against an architecture that wasn't designed for lifecycle management.

Barbacane's approach is different: don't add a retirement process on top of the gateway - make retirement a natural consequence of how the gateway already works. Mark an operation as deprecated in your spec: the gateway emits headers and metrics. Set a sunset date: consumers are notified automatically. Remove the route: it's gone. Everything in between lives in the same spec, reviewed in the same PRs, compiled into the same artifacts.

API retirement shouldn't require a committee. It should require a pull request.

---

*Barbacane is open source (Apache 2.0) and available at [github.com/barbacane-dev/barbacane](https://github.com/barbacane-dev/barbacane). Check the [documentation](https://docs.barbacane.dev/) for the full CLI reference and getting started guide.*
