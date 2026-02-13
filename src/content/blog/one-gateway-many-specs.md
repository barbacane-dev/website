---
title: "One Gateway, Many Specs: How Barbacane Unifies Your API Ecosystem"
description: "Most API tooling assumes one repo, one spec. But microservices don't work that way. Explore how Barbacane's multi-spec compilation merges your OpenAPI and AsyncAPI files into a single, validated artifact."
publishDate: 2026-02-13
author: "Nicolas Dreno"
tags: ["barbacane", "api-gateway", "openapi", "asyncapi", "microservices"]
---

*Most API tooling assumes one repository, one specification. But your architecture doesn't work that way.*

In our [previous article](/blog/beyond-configuration-drift/), we explored how Barbacane eliminates configuration drift by compiling your OpenAPI spec directly into the gateway's runtime artifact. One spec, one `.bca` file, zero drift.

But what happens when your architecture has more than one spec?

---

### The Multi-Spec Reality

In a typical microservices setup, your API surface isn't described by a single file. Whether you're working contract-first or generating specs from code, you end up with multiple specifications:

- A **User Service** with its own `openapi.yaml`
- An **Order Service** with its own `openapi.yaml`
- An **Inventory Service** exposing both REST endpoints and event consumers, described across OpenAPI and AsyncAPI files
- Event schemas scattered across repos

Each file is validated in isolation, deployed independently, and versioned on its own timeline. Single-spec tools can't see across these boundaries, so cross-service mismatches only surface at runtime. The feedback loop is as slow as it gets: write specs, deploy, discover the conflict in production, fix, redeploy.

---

### One Command, Multiple Specs

Barbacane's `compile` command accepts multiple specification files in a single invocation:

```bash
barbacane compile \
  -s services/user-service/openapi.yaml \
  -s services/order-service/openapi.yaml \
  -s services/inventory-service/openapi.yaml \
  -s services/inventory-service/asyncapi.yaml \
  -m barbacane.yaml \
  -o gateway.bca
```

The compiler parses every file (OpenAPI 3.x and AsyncAPI 3.0.x) and merges their routes into a single `.bca` artifact. The output message tells you exactly what you got:

```
compiled 4 spec(s) to gateway.bca (23 routes, 5 plugin(s) bundled)
```

One artifact. One routing table. One deployment.

---

### What Multi-Spec Compilation Actually Does

When you pass multiple specs, the compiler:

1. **Parses each file independently.** OpenAPI and AsyncAPI specs are each validated against their respective standards.

2. **Merges routes into a unified routing table.** All operations from all specs end up in a single `routes.json` inside the `.bca` artifact. The gateway doesn't care which file a route came from; it serves them all.

3. **Detects routing conflicts.** If two specs define the same path and method combination (e.g., both declare `GET /users/{id}`), compilation fails with error `E1010`. This is a hard gate: you cannot produce an artifact with ambiguous routing.

4. **Bundles everything together.** WASM plugins, dispatcher configurations, and the original source specs are all packaged into the artifact. The source specs remain accessible at `/__barbacane/specs` for documentation and debugging.

This isn't magic. It's the same compilation pipeline applied across multiple input files. But the practical impact is a meaningful **shift left**: routing conflicts that would previously surface as mysterious 404s or wrong-handler bugs in production now fail your build.

---

### Specs Stay Accessible at Runtime

Compilation merges routes, but the original source specs aren't thrown away. They're embedded in the `.bca` artifact and served by the gateway at `/__barbacane/specs`:

```
GET /__barbacane/specs
```

This returns an index of every spec that was compiled into the running artifact, with links to the full OpenAPI and AsyncAPI documents. The served specs are stripped of Barbacane-specific extensions (`x-barbacane-*`), so what your API consumers and documentation tools see is clean, standard OpenAPI and AsyncAPI with no vendor-specific noise. And because these are the exact specs that were compiled, they can't drift from what the gateway is actually running.

No separate spec hosting. No stale docs. The gateway *is* the documentation server.

---

### A Practical Example

Consider an e-commerce platform with four services:

```
User Service      → openapi.yaml
Order Service     → openapi.yaml
Inventory Service → openapi.yaml + asyncapi.yaml
Notification Svc  → asyncapi.yaml
```

Without multi-spec compilation, you'd deploy each service's gateway configuration independently, trusting that teams coordinated their path prefixes and schema versions. With Barbacane:

```bash
barbacane compile \
  -s services/user-service/openapi.yaml \
  -s services/order-service/openapi.yaml \
  -s services/inventory-service/openapi.yaml \
  -s services/inventory-service/asyncapi.yaml \
  -s services/notification-service/asyncapi.yaml \
  -m barbacane.yaml \
  -o gateway.bca
```

If the Order Service accidentally defines a route that collides with the User Service, compilation fails. You find out in seconds, not after a deploy.

---

### CI/CD Integration

Multi-spec compilation fits naturally into a CI gate. Block merges to `main` if the combined specs don't compile cleanly:

```yaml
# .github/workflows/validate-contracts.yml
jobs:
  validate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Compile gateway artifact
        run: |
          barbacane compile \
            -s services/user-service/openapi.yaml \
            -s services/order-service/openapi.yaml \
            -s services/inventory-service/openapi.yaml \
            -s services/inventory-service/asyncapi.yaml \
            -m barbacane.yaml \
            -o gateway.bca
```

A non-zero exit code (1 for validation failures, 2 for manifest errors) blocks the pipeline. No ambiguous warnings: either the specs compile together, or they don't.

---

### Progressive Adoption

You don't have to compile everything at once. Start with your most critical services and expand:

```bash
# Start with two services
barbacane compile \
  -s user-service/openapi.yaml \
  -s auth-service/openapi.yaml \
  -m barbacane.yaml \
  -o gateway.bca

# Later, add event-driven services
barbacane compile \
  -s user-service/openapi.yaml \
  -s auth-service/openapi.yaml \
  -s order-service/openapi.yaml \
  -s order-service/asyncapi.yaml \
  -m barbacane.yaml \
  -o gateway.bca
```

Each additional spec increases the surface area of conflict detection. The more specs you compile together, the more mismatches you catch before deployment.

---

### Strengths and Limitations

Multi-spec compilation extends the "compile, don't configure" philosophy across service boundaries, but it's worth understanding what it does and doesn't do today.

**What it catches:**
- Routing conflicts (duplicate path + method across specs)
- Spec-level validation errors (malformed OpenAPI/AsyncAPI)
- Missing plugin or dispatcher declarations

**What it doesn't do (yet):**
- Cross-spec schema validation (e.g., verifying that an `Order` object is consistent between two specs)
- Breaking change detection between spec versions
- Dependency graph analysis between services

These are real limitations. Multi-spec compilation today is primarily about *route-level unification and conflict detection*, not deep semantic analysis across your API ecosystem. For schema consistency, you'll still need complementary tooling or careful code review.

---

### Shifting Left Across Service Boundaries

The idea behind "shift left" is simple: catch problems earlier in the development lifecycle, when they're cheapest to fix. Linters shift left on code quality. Type systems shift left on correctness. Multi-spec compilation shifts left on *cross-service integration*.

In our [previous article](/blog/beyond-configuration-drift/), we showed how Barbacane shifts gateway configuration left by compiling the spec into the runtime artifact. Multi-spec compilation takes this further: instead of discovering that two services disagree on routing after deployment, you discover it at compile time, in CI, on a pull request.

It's not a silver bullet. Cross-service consistency is a hard problem, and route-level conflict detection is just one piece of the puzzle. But it's a piece that most gateway tooling doesn't offer at all, and one that pays off immediately in any multi-service architecture. The earlier you catch a conflict, the less it costs.

---

*Barbacane is open source (Apache 2.0) and available at [github.com/barbacane-dev/barbacane](https://github.com/barbacane-dev/barbacane). Check the [documentation](https://docs.barbacane.dev/) for the full CLI reference and getting started guide.*
