---
title: "Beyond Configuration Drift: How Barbacane Reimagines the API Gateway with Rust and WASM"
description: "What if your OpenAPI spec wasn't just documentation, but the actual configuration of your production gateway? Explore how Barbacane eliminates configuration drift with a spec-driven, compiled approach."
publishDate: 2026-02-12
author: "Nicolas Dreno"
tags: ["barbacane", "api-gateway", "rust", "wasm", "openapi"]
---

*What if your OpenAPI spec wasn't just documentation, but the actual configuration of your production gateway?*

For years, API teams have lived with a quiet frustration: the gap between specification and reality. You write a beautiful OpenAPI spec. You configure your gateway (Kong, Tyk, AWS API Gateway) with routes, plugins, and security rules. And then… drift happens. A hotfix bypasses the spec. A plugin gets misconfigured. The documentation lies. The gateway behaves unexpectedly. The contract between frontend and backend fractures.

This isn't a people problem. It's an architecture problem.

Enter **Barbacane**, a spec-driven API gateway built in Rust that treats your OpenAPI (and AsyncAPI) specification as the *single source of truth*. No separate configuration files. No UI clicks that diverge from Git. Just your spec, compiled into a self-contained artifact that runs at the edge with memory safety guarantees and sub-millisecond latency.

Let's dive into why this approach matters, and whether it's ready for your production workloads.

---

### The Configuration Drift Crisis

Most API gateways follow the same pattern:

1. You write an OpenAPI spec (hopefully)
2. You *separately* configure the gateway via YAML, UI, or CLI
3. You hope these two artifacts stay in sync

This dual-source model creates inevitable drift:

```yaml
# openapi.yaml
paths:
  /users/{id}:
    get:
      security: [{ jwt: [] }]

# kong.yaml (oops, forgot to add auth plugin!)
routes:
  - name: users-get
    paths: [/users/{id}]
    # missing jwt-auth plugin configuration
```

The result? A route that *should* require authentication ships to production wide open. Security teams panic. Post-mortems happen. Trust erodes.

Barbacane eliminates this entire class of failure by making drift *architecturally impossible*.

---

### The Core Insight: Compile, Don't Configure

Barbacane's philosophy is radical in its simplicity:

> **Your spec is your gateway.**

Instead of parsing specs at runtime or maintaining parallel configuration, Barbacane introduces a *compilation step*:

```bash
# Step 1: Write your spec (as usual)
openapi: 3.1.0
info:
  title: User API
  version: 1.0.0
x-barbacane-plugins:
  - name: oidc-auth
    config:
      issuer_url: "https://auth.example.com"
      audience: "my-api"

# Step 2: Compile it
barbacane compile --spec openapi.yaml --manifest barbacane.yaml --output api.bca

# Step 3: Run the gateway
barbacane serve --artifact api.bca
```

The `.bca` artifact is a self-contained binary bundle:
- Pre-compiled routing trie (FlatBuffers, zero-copy deserialization)
- JSON Schema validators for request/response validation
- WASM plugins (including your auth middleware)
- OPA policies for fine-grained authorization
- Dispatcher configurations (HTTP upstreams, Lambda, Kafka)

Critically: **no runtime spec parsing**. The gateway starts in <100ms because everything is pre-optimized. What you compile is exactly what runs. No surprises.

---

### Architecture Deep Dive: Control Plane vs. Data Plane

Barbacane cleanly separates concerns:

#### The Control Plane (`barbacane-control`)
- Stateful service (PostgreSQL-backed)
- Handles spec ingestion, validation, and compilation
- Serves artifacts to data planes
- Provides UI for fleet visibility

#### The Data Plane (`barbacane`)
- **Completely stateless** single binary
- Loads `.bca` artifact at startup (memory-mapped via FlatBuffers)
- Zero runtime dependencies
- Optional WebSocket connection to control plane for health reporting

This separation enables true edge deployment: ship a 15MB static binary with your compiled artifact to a CDN POP, and it runs independently. No coordination required. Scale horizontally by launching more binaries. No consensus protocols. No distributed state.

---

### WASM Plugins: Safety Without Sacrifice

Barbacane ships as a "bare binary" with **zero bundled plugins**. Every capability (JWT auth, rate limiting, CORS) is implemented as a WASM module explicitly declared in your spec:

```yaml
x-barbacane-plugins:
  - name: rate-limit
    config:
      quota: 100
      window: 60
      partition_key: "header:x-api-key"
```

During compilation:
1. Plugin is fetched from registry (or local cache)
2. Validated against spec requirements
3. Bundled into the `.bca` artifact

At runtime:
- Plugins execute in a `wasmtime` sandbox with strict resource limits
- Memory isolation prevents plugin crashes from taking down the gateway
- Host functions are capability-gated (e.g., vault access requires explicit grant)
- Execution timeouts prevent CPU starvation

This model delivers what Lua plugins in Kong *wish* they had: true isolation without sacrificing performance. Benchmarks show 261us overhead per WASM middleware invocation, including instantiation, on modern hardware.

---

### Security by Construction

Barbacane's security model is defense-in-depth by design:

| Layer | Mechanism | Why It Matters |
|-------|-----------|----------------|
| **Memory Safety** | Rust + WASM sandbox | Eliminates entire classes of CVEs (buffer overflows, use-after-free) |
| **Secrets Management** | Vault fetch at startup only | No secrets in Git, specs, or artifacts. Only in runtime memory |
| **AuthN/AuthZ** | Plugin-based + OPA | No vendor lock-in; policies compiled to WASM for speed |
| **Compilation** | Fail-fast validation | Blocks dangerous configs early (e.g., `http://` backends in prod) |
| **Transport** | Rustls (no OpenSSL) | Memory-safe TLS with modern crypto defaults |

For secrets, specs reference them by ID only:

```yaml
x-barbacane-dispatcher:
  name: http-upstream
  config:
    url: "https://backend.example.com"
    headers:
      Authorization: "Bearer {{ vault://prod/api-gateway/backend-token }}"
```

At startup, the data plane fetches secrets from HashiCorp Vault or AWS Secrets Manager, never storing them on disk. Rotate keys in Vault, and the gateway picks up new values on next restart (or via periodic refresh).

---

### Performance: Why FlatBuffers Matters

Most gateways deserialize JSON configs at startup. For small specs, this is fine. For large specs (500+ routes, complex schemas), it becomes a bottleneck.

Barbacane uses **FlatBuffers** for its artifact format, a choice that pays dividends:

- **Zero-copy deserialization**: Memory-map the artifact and access data directly
- **Startup in <100ms**: Even for 1,000-route specs
- **No GC pressure**: Critical for latency-sensitive edge workloads
- **Schema evolution**: Backward/forward compatibility built-in

Benchmarks show route lookup in **83 nanoseconds** for 1,000 routes, faster than a single L3 cache miss. Full request validation (parameters + body schema) averages **1.2 microseconds**. This isn't theoretical; it's the difference between viable and non-viable edge deployment.

---

### Strengths and Tradeoffs

No tool is the right fit for every situation. Here's where Barbacane shines and what to keep in mind.

#### Strengths
- **Spec integrity**: Drift is architecturally impossible
- **Security posture**: Rust + WASM sandboxing beats Lua/JS runtimes
- **Edge readiness**: Stateless, fast startup, minimal footprint
- **AsyncAPI support**: Rare among gateways. Handles WebSockets/MQTT alongside HTTP
- **GitOps native**: Specs in Git → CI validation → artifact deployment

#### Tradeoffs to consider
- **Young project**: v0.1.x, actively developed with a growing community
- **Focused plugin set**: ~17 official plugins covering core use cases, with more on the way
- **Compile-first workflow**: Changes go through CI/CD rather than runtime hot-patching
- **Static backends**: Service discovery requires a custom plugin or DNS-based resolution

Barbacane prioritizes configuration integrity and safety over plugin breadth and dynamic reconfiguration. If that tradeoff works for your team, it's worth evaluating.

---

### Competitive Landscape

| Gateway | Spec-Driven | Memory Safe | WASM Plugins | Edge-Ready | AsyncAPI |
|---------|-------------|-------------|--------------|------------|----------|
| **Barbacane** | Native | Rust | First-class | Stateless | Yes |
| Kong | Separate config | Lua/Nginx | Experimental | Heavy | No |
| Tyk | Separate config | Go (GC) | No | Heavy | No |
| AWS API Gateway | Import only | N/A | No | Managed | No |
| KrakenD | JSON config | Go (GC) | No | Yes | No |

Barbacane targets a different design point than Kong or Tyk: *configuration integrity* and *security* over plugin ecosystem breadth.

---

### Who Should Consider Barbacane Today?

**Strong fits**:
- Greenfield APIs with OpenAPI-first development workflows
- Edge deployments requiring sub-5ms latency overhead
- Security-sensitive domains (fintech, healthcare, govtech)
- Teams with mature GitOps/CI-CD practices
- Organizations investing in Rust/WASM toolchains

**Poor fits**:
- Legacy systems requiring dynamic runtime reconfiguration
- Teams needing 50+ pre-built plugins immediately
- Environments without DevOps automation for compilation
- Brownfield migrations where spec completeness is low

---

### The Bigger Picture: A Shift in Gateway Philosophy

Barbacane represents more than a new gateway. It's a philosophical shift:

> **Stop configuring your gateway to match your spec. Make your spec the configuration.**

This aligns with broader industry movements:
- **Infrastructure as Code** → **Behavior as Specification**
- **Runtime validation** → **Compile-time validation**
- **Configuration drift** → **Configuration integrity**

It's not the only path forward (declarative gateways like KrakenD point in a similar direction), but Barbacane's Rust/WASM/FlatBuffers stack delivers uniquely strong safety and performance guarantees.

---

### Final Thoughts

Barbacane's spec-driven model addresses a real pain point for API teams: keeping specs and gateway behavior in sync. By compiling the spec into the runtime artifact, that problem goes away entirely. The Rust and WASM foundation delivers strong performance and safety guarantees on top.

The project is at v0.1.x, so it's best suited for new projects where you control the spec lifecycle. If your team already works OpenAPI-first with CI/CD automation, Barbacane fits naturally into that workflow.

The goal: your API contract *is* your production configuration. Security policies validated before deployment. Edge gateways starting in milliseconds with zero configuration drift. That's the direction we're heading.

---

*Barbacane is open source (Apache 2.0) and available at [github.com/barbacane-dev/barbacane](https://github.com/barbacane-dev/barbacane). As of February 2026, it remains an early-stage project—evaluate thoroughly before production use.*
