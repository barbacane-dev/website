---
title: "Compliance by design, part 1: how Barbacane becomes your API audit trail"
description: "Auditors don't just ask whether you have security controls. They ask how you can prove those controls were actually enforced. Explore how Barbacane's compiled approach turns your API gateway into a verifiable compliance artifact."
publishDate: 2026-02-18
author: "Baptiste Betelu"
tags: ["barbacane", "api-gateway", "compliance", "security", "audit", "soc2", "pci-dss", "policy-as-code"]
---

*Auditors don't ask whether you have access controls. They ask how you can prove those controls were enforced, consistently, on every request, across every environment.*

The gap between those two questions is where most API teams suffer during audits.

You can point to your OpenAPI spec. You can point to your gateway configuration. You can point to your authorization policies. But if those three artifacts live in three different places and are maintained by three different teams, the auditor's next question is: "How do you know they all say the same thing?" And the honest answer is: you hope they do.

Barbacane changes this. Not through a compliance dashboard or a report generator, but through its architecture. When your spec *is* your gateway, the gap between documentation and enforcement disappears. And when there's no gap, proving conformity becomes straightforward.

---

### The evidence problem

Compliance frameworks, whether SOC 2 Type II, PCI DSS, HIPAA, or ISO 27001, share a common requirement: you must demonstrate that your controls were actually applied, not just that you intended them to be.

For API gateways, that typically means gathering evidence from several disconnected places:

- The OpenAPI spec (what the API is *supposed* to do)
- The gateway configuration (how the gateway is actually configured)
- Code review history (what was approved)
- Runtime logs (what actually happened)
- Policy documents (what the rules are supposed to be)

The problem is that none of these sources are authoritative for the others. Your spec might say `GET /records` requires a JWT with a `records:read` scope. Your gateway might have been configured with that plugin, then reconfigured during a late-night hotfix. Your logs might show the endpoint responding successfully to requests that lacked the required scope. And nobody connects these dots until an auditor sits down with all three documents at once.

This is the configuration drift problem, and it turns every compliance audit into an investigation.

---

### Proof by Artifact

Barbacane's compilation model flips this. When you run:

```bash
barbacane compile \
  -s api.yaml \
  -m barbacane.yaml \
  -o api.bca
```

The output is not just a gateway binary. It's a compliance artifact. Everything that the gateway will enforce, every route, every middleware, every authentication requirement, every authorization rule, is locked into that `.bca` file at compile time. The spec you review in a pull request is compiled into the artifact that runs in production. There is no separate configuration layer that could diverge from what was approved.

What this means for evidence gathering:

| Question | Traditional Answer | Barbacane Answer |
|---|---|---|
| What auth is enforced on this endpoint? | Read the gateway config (if you can find it) | Read the spec: the `x-barbacane-middlewares` entry is what ran |
| Was this endpoint protected last quarter? | Dig through config history | Check the artifact version deployed that quarter |
| Who approved the current access controls? | Find the ticket, find the review | The spec PR that changed the middleware config |
| What was actually running in production? | Hope it matches the config that matches the spec | The compiled artifact. That's it. |

The artifact is the single source of truth. You can hash it, version it, store it in artifact registries, and attach it to change tickets. When an auditor asks "what was enforced on the `/payments` endpoint on November 3rd?", you pull the artifact that was deployed that day and read the spec it was compiled from.

Barbacane reinforces this with **artifact fingerprinting and build provenance**. Every compiled artifact contains a SHA-256 `artifact_hash` — a combined hash of all inputs (specs, plugins, configuration). You can also embed the Git commit SHA and build source directly into the artifact:

```bash
barbacane compile \
  -s api.yaml \
  -m barbacane.yaml \
  -o api.bca \
  --provenance-commit $(git rev-parse HEAD) \
  --provenance-source ci/github-actions
```

This provenance metadata is embedded in the artifact manifest. At runtime, you can query it via the dedicated admin API (a separate listener on port 8081, isolated from user traffic):

```
GET /provenance
```

The response includes `artifact_hash`, `compiled_at`, `compiler_version`, the source specs, bundled plugins, and whether drift has been detected. The admin port also serves health checks and Prometheus metrics, all separated from production traffic. This is the kind of structured, machine-readable evidence that auditors and compliance tools can consume directly — no spreadsheet required.

The gateway also serves the compiled specs at `/__barbacane/specs` — stripped of internal extensions, clean OpenAPI and AsyncAPI. Developer portals that pull from this endpoint always show the spec that corresponds to the running gateway. There is no publishing step that someone might forget, and the artifact hash links every served spec to a specific build.

#### Continuous drift detection

Even with immutable artifacts, a compliance concern remains: how do you know every data plane is actually running the artifact you deployed? Barbacane's control plane solves this with automatic drift detection. Each data plane reports its `artifact_hash` in WebSocket heartbeats (every 30 seconds). The control plane compares the reported hash against the expected artifact and flags any mismatch — with an amber warning in the Web UI, a `drift_detected` flag on the `/provenance` endpoint, and a warning log on the data plane itself.

For SOC 2 CC7.2 and ISO 27001 A.12.4, this provides evidence that your fleet is running the approved configuration — not just that you deployed it once and hoped for the best. When an auditor asks "how do you know all nodes were running the same policy last Tuesday?", the answer is a heartbeat log showing hash verification every 30 seconds.

---

### Access Controls That Live in the Spec

One of the most common compliance requirements is demonstrating that sensitive endpoints have documented, enforced access controls. The conventional approach is to maintain a spreadsheet mapping endpoints to roles, then separately verify that the gateway configuration matches. This is manual, error-prone, and stale by the time anyone looks at it.

In Barbacane, the access control *is* the specification:

```yaml
paths:
  /patients/{id}/records:
    get:
      summary: Retrieve patient records
      x-barbacane-middlewares:
        - name: jwt-auth
          config:
            issuer: "https://auth.example.com"
            required_claims:
              scope: "records:read"
        - name: cel
          config:
            expression: >
              'clinician' in request.claims.roles ||
              request.claims.sub == request.path_params.id
            deny_message: "Access restricted to treating clinicians and the patient"

    delete:
      summary: Delete patient records
      x-barbacane-middlewares:
        - name: jwt-auth
          config:
            issuer: "https://auth.example.com"
        - name: cel
          config:
            expression: "'records-admin' in request.claims.roles"
            deny_message: "Deletion requires records-admin role"
```

This is not documentation. This is configuration. The CEL expressions compiled from these annotations are what execute on every request. If the spec says `DELETE` requires the `records-admin` role, the gateway enforces that check. There is no step where someone might forget to update the middleware to match the documentation.

For a reviewer, the access control surface is entirely visible in the spec. You can see, in a single pull request, exactly what changed: what endpoint, what role requirement, what expression. The PR *is* the change management record.

---

### Authorization decision logs

For frameworks that require audit trails of access decisions (SOC 2 CC6.3, PCI DSS Requirement 10, HIPAA §164.312(b)), OPA integration provides something that CEL inline expressions alone cannot: a structured log of every authorization decision.

As we covered in our [authorization post](/blog/authorization-at-the-gateway/), when the OPA plugin is used, the gateway sends request context to your OPA deployment and enforces the boolean decision. But OPA also generates decision logs for every evaluation:

```json
{
  "decision_id": "9f73d5d0-91a5-4f62-a6a3-7e3c4b1a2f8d",
  "timestamp": "2026-02-18T14:32:01.023Z",
  "input": {
    "method": "DELETE",
    "path": "/patients/pt-9142/records",
    "client_ip": "10.0.1.42",
    "claims": {
      "sub": "user-alice",
      "roles": ["clinician"],
      "iss": "https://auth.example.com"
    }
  },
  "result": false,
  "policy": "patients.records.delete"
}
```

This log entry answers the exact question auditors ask: *who requested what, when, with what credentials, and was it allowed?* Not inferred from application logs. Not reconstructed from access patterns. Explicitly recorded by the policy engine at the moment of the decision.

For compliance teams, this is the difference between "we believe we denied unauthorized deletions" and "here are 47,000 log entries showing every authorization decision made on this endpoint in Q4, with the specific policy that evaluated each one."

You can ship these logs to Datadog, Splunk, or any SIEM. The OPA decision log format is structured JSON, purpose-built for querying.

---

### What's next

This post covered the architectural foundations: how Barbacane's compilation model, artifact provenance, and drift detection turn the evidence problem into a solved problem. But there's more to the compliance story — schema validation as a data control boundary, secrets management, FIPS 140-3 cryptography, and how GitOps becomes your change management process.

We'll cover all of that in [Part 2: the compliance controls](/blog/compliance-by-construction-part-2/).

---

*Barbacane is open source (Apache 2.0) and available at [github.com/barbacane-dev/barbacane](https://github.com/barbacane-dev/barbacane). Questions about compliance use cases? Reach us at [contact@barbacane.dev](mailto:contact@barbacane.dev).*
