---
title: "Gradual migration, zero downtime: the Strangler Fig pattern with spec-driven API gateways"
description: "Instead of risky big-bang rewrites, the Strangler Fig pattern lets you modernize legacy systems incrementally. Learn how Barbacane's spec-driven, compiled approach makes it the ideal facade for safe, reversible migrations."
publishDate: 2026-03-16
author: "Nicolas Dreno"
tags: ["barbacane", "api-gateway", "strangler-fig", "migration", "microservices", "openapi", "architecture"]
draft: true
---

*The Strangler Fig pattern, popularized by Martin Fowler, offers a pragmatic approach to modernizing legacy systems: instead of risky "big bang" rewrites, you incrementally replace functionality by routing traffic through a facade that gradually shifts requests from old to new systems.*

Modern API gateways are the ideal facade for this pattern. They provide the routing flexibility, policy enforcement, and observability needed to run legacy and new services side-by-side - safely and reversibly.

In this article, we'll explore how **Barbacane**, a spec-driven API gateway built in Rust, enables Strangler Fig migrations with compile-time safety, OpenAPI as configuration, and WASM-extensible middleware.

---

### What is the Strangler Fig pattern?

The Strangler Fig pattern helps modernize legacy systems incrementally, with reduced transformation risk and business disruption. Whether you're decomposing a monolith into microservices, migrating between platforms, replacing a third-party dependency, or upgrading a protocol layer, the approach is the same. The pattern works in three phases:

1. **Transform**: Introduce a facade (typically an API gateway) that intercepts all incoming requests
2. **Elongate**: Gradually route specific endpoints or features to new implementations while legacy code handles the rest
3. **Strangle**: Once all functionality is migrated, retire the legacy system entirely

The key insight: **you never have two systems "live" for the same endpoint**. The gateway ensures requests go to exactly one backend at a time, eliminating race conditions and data inconsistencies.

---

### Why modern API gateways excel at Strangler Fig migrations

Traditional gateways often require separate configuration languages, creating drift between your API contract and runtime behavior. New-generation gateways like Barbacane solve this by making **your OpenAPI spec the single source of truth**.

#### Key capabilities for incremental migration

| Capability | Why it matters for Strangler Fig |
|------------|----------------------------------|
| **Spec-driven routing** | Define routes in OpenAPI; no separate DSL to maintain or sync |
| **Path-level dispatch** | Route `/v1/users` to legacy, `/v2/users` to new service - same spec, different backends |
| **Middleware chaining** | Apply auth, rate limiting, or transformation logic uniformly across old and new endpoints |
| **Compile-time validation** | Catch routing conflicts, missing backends, or security misconfigurations before deployment |
| **WASM plugins** | Extend gateway behavior safely without recompiling the core runtime |

---

### Implementing Strangler Fig with Barbacane: a step-by-step example

Let's walk through migrating a legacy `/users` endpoint to a new microservice.

#### Phase 1: Establish the facade

Start by defining your API in OpenAPI and adding Barbacane's `x-barbacane-dispatch` extension to route all traffic to the legacy system:

```yaml
# api.yaml
openapi: "3.1.0"
info:
  title: User API
  version: "1.0.0"

paths:
  /users:
    get:
      summary: List users
      responses:
        '200':
          description: Success
      x-barbacane-dispatch:
        name: http-upstream
        config:
          url: "https://legacy-monolith.internal"
          path: "/api/v1/users"
```

Compile and deploy:

```bash
barbacane compile --spec api.yaml --manifest plugins.yaml --output api.bca
barbacane serve --artifact api.bca --listen 0.0.0.0:8080
```

All traffic now flows through Barbacane, but still reaches the legacy backend.

#### Phase 2: Elongate - migrate one endpoint

Now extract the `GET /users` endpoint to a new service. Update the spec to route just this operation to the new backend:

```yaml
paths:
  /users:
    get:
      summary: List users (new implementation)
      responses:
        '200':
          description: Success
      x-barbacane-dispatch:
        name: http-upstream
        config:
          url: "https://user-service.internal"  # New microservice
          path: "/users"
```

Other endpoints (e.g., `POST /users`, `/users/{id}`) remain routed to the legacy system. No code changes elsewhere, just update the spec and recompile.

**Traffic is now split**: reads go to the new service, writes still hit the monolith. You can validate behavior, monitor performance, and roll back instantly by reverting the spec.

#### Phase 3: Apply cross-cutting concerns uniformly

Use global middleware to apply policies across both legacy and new endpoints:

```yaml
# Global middleware (applies to all operations)
x-barbacane-middlewares:
  - name: rate-limit
    config:
      quota: 100
      window: 60
  - name: cors
    config:
      allowed_origins: ["https://app.example.com"]
  - name: correlation-id
    config:
      header_name: "X-Request-ID"
      generate_if_missing: true
```

Operation-specific middleware can override or extend the chain:

```yaml
paths:
  /users:
    get:
      x-barbacane-middlewares:
        - name: cache
          config:
            ttl: 300  # Cache GET /users for 5 minutes
      # ... dispatch config
```

This ensures consistent security, observability, and performance policies regardless of which backend handles the request.

#### Phase 4: Deprecate and sunset legacy endpoints

As you migrate more functionality, mark legacy endpoints for retirement using OpenAPI's `deprecated` field and Barbacane's `x-sunset` extension:

```yaml
paths:
  /v1/users:
    get:
      deprecated: true
      x-sunset: "Sat, 31 Dec 2026 23:59:59 GMT"
      summary: Legacy user endpoint (use /v2/users)
      x-barbacane-dispatch:
        name: http-upstream
        config:
          url: "https://legacy-monolith.internal"
```

Clients receive `Deprecation: true` and `Sunset` headers, giving them time to migrate. When the sunset date arrives, simply remove the route from your spec.

#### Phase 5: Strangle - remove the legacy

Once all endpoints are migrated:

1. Remove legacy dispatch configurations from your OpenAPI spec
2. Recompile the artifact
3. Decommission the monolith

Migration complete - with zero downtime and full auditability via your version-controlled spec.

---

### Advanced patterns

#### Wildcard routing for bulk migration

Use greedy path parameters (`{path+}`) to proxy entire subtrees during early migration phases:

```yaml
# Proxy all /legacy/* paths to the monolith
/legacy/{path+}:
  get:
    parameters:
      - name: path
        in: path
        required: true
        allowReserved: true
        schema: { type: string }
    x-barbacane-dispatch:
      name: http-upstream
      config:
        url: "https://legacy-monolith.internal"
        path: "/{path}"
```

As you extract services, replace wildcard routes with specific paths pointing to new backends.

#### Mock dispatchers for contract-first development

Before a new service is ready, use Barbacane's `mock` dispatcher to stub responses and validate client integrations:

```yaml
/users/{id}:
  get:
    x-barbacane-dispatch:
      name: mock
      config:
        status: 200
        body: '{"id":"123","name":"Test User"}'
```

Switch to `http-upstream` when the real service is deployed - no client changes needed.

#### AsyncAPI for event-driven migration

Barbacane supports AsyncAPI 3.x, enabling sync-to-async bridging. Publish events from HTTP endpoints to Kafka or NATS while legacy systems still poll databases:

```yaml
# AsyncAPI operation exposed via HTTP POST
/events/user.created:
  post:
    x-barbacane-dispatch:
      name: kafka
      config:
        topic: "user-events"
        brokers: "kafka:9092"
```

This lets you decouple systems incrementally without rewriting consumers upfront.

---

### Why Barbacane's compilation model reduces migration risk

Unlike configuration-driven gateways, Barbacane **compiles your OpenAPI spec into a portable `.bca` artifact**. This provides critical safety guarantees:

- **Routing conflicts** (same path+method in multiple specs) are caught at compile time (error `E1010`)
- **Missing dispatchers** trigger validation errors (`E1020`) before deployment
- **Insecure upstream URLs** (`http://`) are rejected by default in production builds (`E1031`)
- **Path template errors** (invalid wildcards, duplicate params) fail fast (`E1054`)

This means your Strangler Fig migration is **validated before it reaches production** - no more "works on my machine" surprises.

---

### Observability: monitor your migration in real time

Barbacane emits Prometheus metrics, structured logs, and OpenTelemetry traces out of the box. During migration, track:

```promql
# Compare latency between legacy and new endpoints
rate(barbacane_request_duration_seconds_sum{path="/v1/users"}[5m])
  /
rate(barbacane_request_duration_seconds_count{path="/v1/users"}[5m])

# Monitor SLO violations on migrated endpoints (requires observability middleware)
increase(barbacane_plugin_observability_slo_violation{path="/users"}[1h])
```

Use the built-in Grafana dashboards (available in the [Playground](https://github.com/barbacane-dev/playground)) to visualize traffic shifting, error rates, and middleware performance.

---

### Getting started

1. **Try the Playground**:
   ```bash
   git clone https://github.com/barbacane-dev/playground
   cd playground && docker-compose up -d
   # Gateway: http://localhost:8080 | Control Plane: http://localhost:3001
   ```

2. **Read the Docs**: Full reference at [docs.barbacane.dev](https://docs.barbacane.dev)

3. **Start Small**: Pick one low-risk endpoint, define it in OpenAPI, and route it through Barbacane. Iterate from there.

---

### Conclusion

The Strangler Fig pattern works because it trades big-bang risk for **incremental change, continuous validation, and reversible decisions**. Modern API gateways like Barbacane amplify this approach by making your API spec the executable contract for routing, policy, and observability.

By compiling OpenAPI into portable artifacts, enforcing safety at build time, and supporting extensible middleware via WASM, Barbacane lets you strangle legacy systems with confidence - one endpoint at a time.

*Ready to start your migration? Explore the [Barbacane Playground](https://github.com/barbacane-dev/playground) or dive into the [documentation](https://docs.barbacane.dev).*

---

### Resources

- [Barbacane Documentation](https://docs.barbacane.dev)
- [Interactive Playground](https://github.com/barbacane-dev/playground)
- [GitHub Repository](https://github.com/barbacane-dev/barbacane)
- [Strangler Fig Pattern (Martin Fowler)](https://martinfowler.com/bliki/StranglerFigApplication.html)
- [AWS Prescriptive Guidance: Strangler Fig](https://docs.aws.amazon.com/prescriptive-guidance/latest/cloud-design-patterns/strangler-fig.html)

---

> **Pro Tip**: Keep your OpenAPI spec in version control alongside your application code. Every migration step becomes a reviewable, reversible commit - turning infrastructure changes into collaborative, auditable workflows.

---

*Barbacane is open source and available at [github.com/barbacane-dev/barbacane](https://github.com/barbacane-dev/barbacane). Questions or feedback? Reach us at [contact@barbacane.dev](mailto:contact@barbacane.dev).*
