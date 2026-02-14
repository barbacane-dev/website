---
title: "Authorization at the Gateway: CEL and OPA for Policy-Driven Access Control"
description: "Authentication tells you who someone is. Authorization tells you what they can do. Explore how Barbacane's CEL and OPA plugins bring policy-driven access control to the gateway layer, from inline expressions to centralized policy engines."
publishDate: 2026-02-14
author: "Nicolas Dreno"
tags: ["barbacane", "api-gateway", "authorization", "cel", "opa", "security", "zero-trust"]
---

*Authentication is a solved problem. Authorization is where things get complicated.*

Once you know *who* is making a request, how do you decide *what they're allowed to do*?

At small scale, authorization is simple. An `admin` role gets full access, a `viewer` role gets read-only. You hardcode a few rules and move on. But enterprise APIs don't stay small. Teams multiply, services proliferate, and authorization logic becomes a tangled web of role hierarchies, resource ownership, temporal constraints, and regulatory requirements.

This is where most gateway setups start to crack.

---

### The Authorization Gap

Traditional API gateways handle authentication well. JWT validation, API key checks, OAuth2 introspection: these are table stakes. But once the token is verified, the authorization question is typically punted to the application layer:

```
Gateway: "This is Alice, she has a valid token."
Backend: "Great, but can Alice delete this specific order?"
Gateway: "¯\_(ツ)_/¯"
```

This pushes authorization logic into every backend service. Each team implements its own checks. Rules diverge. Auditing becomes a nightmare. And when a policy change is needed, say, revoking access for a departing employee's role, you're patching multiple services instead of updating one policy.

The alternative is moving authorization decisions to the gateway, where they can be enforced *before* the request reaches your backends. But this requires expressive policy languages, not just role lists.

---

### Two Philosophies, One Gateway

Barbacane now ships two authorization plugins that represent fundamentally different approaches to the same problem:

| | **CEL** | **OPA** |
|---|---|---|
| **Execution** | Inline, in-process | External service (HTTP) |
| **Language** | CEL expressions | Rego policies |
| **Latency** | Microseconds | HTTP round-trip |
| **Policy location** | In the OpenAPI spec | In a policy repository |
| **Best for** | Route-level guards | Centralized policy management |

They're not competing. They're complementary. Most enterprise deployments will use both.

---

### CEL: Inline Policy Expressions

[CEL (Common Expression Language)](https://cel.dev/) is a lightweight expression language designed by Google for evaluating policies. It's the same language behind Kubernetes admission webhooks, Envoy RBAC filters, and Firebase Security Rules. If you've written a CEL expression anywhere in the cloud-native ecosystem, you already know how it works in Barbacane.

The CEL plugin evaluates expressions directly in the gateway process. No sidecar. No HTTP call. No external dependency. You write the rule in your spec, and it runs at request time:

```yaml
paths:
  /admin/users:
    get:
      x-barbacane-middlewares:
        - name: jwt-auth
          config:
            issuer: "https://auth.example.com"
        - name: cel
          config:
            expression: "'admin' in request.claims.roles"
            deny_message: "Admin access required"
```

The expression has access to the full request context: method, path, headers, query parameters, client IP, and (critically) the parsed claims from an upstream auth middleware:

```cel
// Only admins can DELETE
request.method != 'DELETE' || 'admin' in request.claims.roles

// Rate-limit bypass for internal services
request.headers['x-internal-service'] != '' && request.client_ip.startsWith('10.')

// Time-based access (with string comparison on ISO timestamps)
request.method == 'GET' || request.claims.role == 'admin'

// Resource ownership via path params
request.claims.sub == request.path_params.user_id || 'admin' in request.claims.roles
```

Because CEL evaluates in-process, latency overhead is measured in microseconds. There's no network hop, no serialization, no external service to monitor. The expression is compiled once and cached for subsequent requests.

This makes CEL ideal for **route-level guards**: rules that are specific to an endpoint and belong alongside the route definition. When you read the spec, you see exactly what's enforced. The policy *is* the configuration, the same principle that drives everything in Barbacane.

---

### OPA: Centralized Policy Engine

[Open Policy Agent](https://www.openpolicyagent.org/) takes the opposite approach: policies live outside your specs, in a dedicated policy repository, written in Rego (OPA's purpose-built policy language). The gateway sends request context to OPA via its REST API and enforces the boolean decision.

```yaml
paths:
  /orders/{id}:
    delete:
      x-barbacane-middlewares:
        - name: oauth2-auth
          config:
            introspection_endpoint: "https://auth.example.com/introspect"
        - name: opa-authz
          config:
            opa_url: "http://opa:8181/v1/data/api/authz/allow"
            include_claims: true
```

The OPA plugin constructs an input payload from the request and POSTs it to your OPA endpoint:

```json
{
  "input": {
    "method": "DELETE",
    "path": "/orders/ord-42",
    "headers": { "x-auth-consumer": "alice" },
    "client_ip": "10.0.0.1",
    "claims": {
      "sub": "alice",
      "roles": ["order-manager"],
      "department": "fulfillment"
    }
  }
}
```

Your Rego policy evaluates the decision:

```rego
package api.authz

default allow := false

# Order managers can delete orders in their department
allow if {
    input.method == "DELETE"
    startswith(input.path, "/orders/")
    input.claims.roles[_] == "order-manager"
}

# Admins can do anything
allow if {
    input.claims.roles[_] == "admin"
}

# Read-only access for authenticated users
allow if {
    input.method == "GET"
    input.claims.sub != ""
}
```

This model introduces an HTTP round-trip per request, which is a real cost. But what you get in return is significant:

- **Centralized policy management.** All authorization rules live in one repository, versioned and reviewed like code.
- **Decoupled policy evolution.** Update policies without recompiling gateway artifacts or redeploying services.
- **Audit trails.** OPA's decision logs provide a complete record of every authorization decision.
- **Complex logic.** Rego supports data joins, partial evaluation, and recursive rules that go well beyond what inline expressions can express.

For organizations that need to answer "who had access to what, and when?", think compliance-heavy industries, multi-tenant platforms, regulated APIs, OPA is the right tool.

---

### Composing Authorization with Authentication

Both plugins are designed to slot into Barbacane's middleware chain after an authentication middleware. The auth plugin sets standard headers (`x-auth-consumer`, `x-auth-consumer-groups`, `x-auth-claims`) that the authorization plugin reads. This decoupling means you can swap auth methods without touching authorization logic:

```yaml
# Global: authenticate with OIDC
x-barbacane-middlewares:
  - name: oidc-auth
    config:
      issuer_url: "https://accounts.google.com"
      audience: "my-api"

paths:
  /admin/settings:
    put:
      # Route-level: CEL guard for admin-only
      x-barbacane-middlewares:
        - name: cel
          config:
            expression: "'admin' in request.claims.roles"

  /reports/{id}:
    get:
      # Route-level: OPA for complex ownership rules
      x-barbacane-middlewares:
        - name: opa-authz
          config:
            opa_url: "http://opa:8181/v1/data/reports/access"
            include_claims: true
```

Notice what's happening: OIDC authentication is global, but authorization varies per route. Simple admin checks use CEL (no external dependency, microsecond overhead). Complex ownership checks delegate to OPA (centralized policy, full audit trail). The gateway runs the right tool for each endpoint.

This layered approach also composes with Barbacane's existing [ACL middleware](/blog/beyond-configuration-drift/), which handles group-based allow/deny lists. For many routes, ACL is sufficient. CEL and OPA extend the authorization spectrum for cases where group membership alone isn't enough.

---

### Choosing the Right Tool

Here's a practical decision framework:

**Use ACL when:**
- Authorization is based on group/role membership (e.g., "admins can access /admin/*")
- Rules are static allow/deny lists
- You don't need expression logic

**Use CEL when:**
- Rules are specific to a route and benefit from living in the spec
- You need expressions beyond simple group checks (method + path + claims combinations)
- Latency is critical (no external dependency)
- The team maintaining the spec also owns the authorization rules

**Use OPA when:**
- Policies are managed by a dedicated security/platform team
- Rules are complex, cross-cutting, or frequently updated independently of deployments
- You need audit logs of every authorization decision
- Compliance requirements mandate centralized policy governance
- Policies reference external data (user attributes, resource metadata)

**Use CEL + OPA together when:**
- Simple route guards in CEL, complex cross-cutting policies in OPA
- CEL as a fast pre-filter, OPA for the authoritative decision
- Different teams own different parts of the authorization surface

---

### Toward Zero Trust at the Gateway

The traditional enterprise pattern, check roles in a middleware, check permissions in the backend, hope they agree, is fundamentally at odds with zero trust. In a zero trust model, no request is trusted by default. Every call, whether it comes from the public internet or from a service two hops away in your Kubernetes cluster, must be explicitly verified against policy before it reaches its destination.

The API gateway is a natural enforcement point for this. It already sits on the request path. It already knows the caller's identity (via auth middleware). What's been missing is the ability to express and evaluate *policies*, not just check role lists.

That's what CEL and OPA bring to the table. Every request gets evaluated against an explicit policy. Internal traffic doesn't get a free pass. External traffic doesn't get a different code path. The same expressions, the same Rego rules, the same decision framework applies everywhere. And because policies are declared in the spec (CEL) or in a versioned policy repo (OPA), they're auditable. You can answer "what policy was enforced on this endpoint last Tuesday?" without digging through application logs.

This doesn't mean moving *all* authorization to the gateway. Fine-grained object-level checks ("can Alice edit *this specific document*?") still belong in the backend, where you have the data context. But coarse-grained and medium-grained decisions ("can this role call DELETE on this endpoint?", "does this department have access to this API?", "is this consumer allowed to write to production resources?") are gateway concerns. Enforcing them before the request reaches your backend reduces attack surface, simplifies backend code, and provides a single enforcement point that security teams can actually audit.

With CEL and OPA, Barbacane gives you two industry-standard tools for building this layer. CEL for the rules that belong next to the route definition. OPA for the policies that belong in a dedicated repository. Both enforced at the same gateway, both integrated with the same authentication chain, both verifiable before deployment.

---

### Strengths and Tradeoffs

**What works well:**
- CEL expressions are validated at request time, catching typos early
- OPA integration uses the standard Data API, so any OPA deployment works
- Both plugins produce RFC 9457 Problem Details for HTTP APIs, consistent with the rest of the gateway
- Authentication and authorization are cleanly separated via standard headers

**What to keep in mind:**
- CEL expressions live in your spec, so changes require recompilation and redeployment
- OPA adds an HTTP round-trip per request (mitigated by running OPA as a local sidecar)
- The OPA plugin evaluates a single boolean decision; structured deny reasons require custom Rego
- CEL doesn't support external data lookups; if your policy needs database queries, use OPA

These are deliberate design choices. CEL optimizes for speed and spec-locality. OPA optimizes for flexibility and centralized governance. Barbacane gives you both, and the middleware chain lets you compose them per route.

---

### Getting Started

Both plugins are available today. Add them to your spec, compile, and deploy:

```bash
# CEL: no external dependencies
barbacane compile --spec api.yaml -m barbacane.yaml -o api.bca

# OPA: run OPA alongside your gateway
docker run -d -p 8181:8181 openpolicyagent/opa:latest run --server /policies
barbacane compile --spec api.yaml -m barbacane.yaml -o api.bca
```

The [middleware documentation](https://docs.barbacane.dev/guide/middlewares.html) covers configuration details, expression syntax, and OPA input format. The [plugin development guide](https://docs.barbacane.dev/contributing/plugins.html) shows how to build custom authorization plugins if CEL and OPA don't fit your model.

---

*Barbacane is open source (Apache 2.0) and available at [github.com/barbacane-dev/barbacane](https://github.com/barbacane-dev/barbacane). The CEL and OPA authorization plugins ship with v0.1.x. Try them against your specs and let us know what works.*
