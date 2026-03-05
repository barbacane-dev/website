---
title: "Compliance by design, part 2: the compliance controls"
description: "From schema validation and secrets management to FIPS 140-3 cryptography and GitOps workflows — the specific controls Barbacane provides for SOC 2, PCI DSS, HIPAA, FedRAMP, and beyond."
publishDate: 2026-03-05
author: "Baptiste Bettelu"
tags: ["barbacane", "api-gateway", "compliance", "security", "audit", "fips", "soc2", "pci-dss", "policy-as-code"]
---

*In [Part 1](/blog/compliance-by-construction-part-1/), we covered how Barbacane's compilation model turns your API spec into a verifiable compliance artifact — with artifact provenance, drift detection, inline access controls, and OPA decision logs. This post covers the remaining controls: schema validation, secrets, cryptography, change management, and how they map to specific framework requirements.*

---

### Schema validation as data control evidence

Regulations like GDPR and HIPAA impose obligations around data handling: you should only receive, process, and store data you're authorized to handle. Request validation at the gateway layer is a practical enforcement point for this.

Barbacane compiles your OpenAPI JSON schemas into validators that run on every request. A request with unexpected fields, an oversized payload, or a malformed type is rejected at the gateway before it reaches your backend:

```yaml
paths:
  /users:
    post:
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              required: [email, name]
              additionalProperties: false  # reject unexpected fields
              properties:
                email:
                  type: string
                  format: email
                name:
                  type: string
                  maxLength: 100
```

`additionalProperties: false` is significant here. It means that a client cannot inject fields beyond what your schema explicitly permits. Unexpected data is rejected with a 400 before it ever reaches your service. For data protection purposes, this is a documented, enforced boundary on what information your API accepts.

The validation rules are in the spec. The spec is compiled into the artifact. The artifact is what runs. The evidence chain is complete.

---

### Secrets never touch the artifact

One of the more common audit findings in API security reviews is secrets exposure: API keys in config files, credentials baked into container images, tokens in environment variables that end up in logs. Barbacane addresses this at the architecture level.

Specifications reference secrets by identifier only:

```yaml
x-barbacane-dispatcher:
  name: http-upstream
  config:
    url: "https://backend.internal"
    headers:
      Authorization: "Bearer {{ vault://prod/gateway/backend-service-token }}"
```

The `vault://` reference is resolved at data plane startup. The actual secret value is fetched from your secrets manager, loaded into memory, and never persisted to disk or included in the compiled artifact. You can distribute the `.bca` file freely without exposing credentials.

For PCI DSS (Requirement 3, protecting stored data) and SOC 2 (availability and confidentiality controls), being able to demonstrate that credentials are never at rest in configuration artifacts or build artifacts is meaningful evidence.

---

### FIPS 140-3 cryptography

For organizations in government, defense, finance, or healthcare, FIPS 140-3 compliance isn't optional — it's a procurement requirement. Many enterprise security teams won't evaluate a product that can't demonstrate FIPS-validated cryptography.

Barbacane uses [rustls](https://github.com/rustls/rustls) with the [aws-lc-rs](https://github.com/aws/aws-lc-rs) cryptographic backend — no OpenSSL dependency. AWS-LC has received [FIPS 140-3 Level 1 certification](https://aws.amazon.com/blogs/security/aws-lc-is-now-fips-140-3-certified/) from NIST. Enabling FIPS mode is a single build-time feature flag:

```bash
cargo build -p barbacane --release --features fips
```

When FIPS mode is enabled:

- Only FIPS-approved cipher suites are available (AES-GCM with ECDHE key exchange; no ChaCha20)
- TLS Extended Master Secret (EMS) is required for TLS 1.2 connections
- The cryptographic module performs a power-on self-test at startup to verify integrity
- All TLS connections — both ingress and egress — use the validated module

This matters for compliance because the cryptographic boundary is verifiable. You can point to the specific NIST certificate, show the build flag that activates it, and demonstrate that the runtime enforces it. There's no ambiguity about whether "the right crypto library" was linked or whether a configuration option silently fell back to a non-validated path.

For FedRAMP, CMMC, and any framework that requires FIPS 140 cryptography, the evidence chain is: build flag → certified module → enforced cipher suites. You can verify the active crypto provider at runtime via `GET /provenance` on the admin port.

---

### GitOps as change management

Compliance frameworks require demonstrating that changes to security controls go through a review and approval process. In Barbacane's workflow, this happens naturally via Git:

1. A developer modifies a middleware configuration in the spec
2. A pull request is opened, triggering CI compilation
3. The CI pipeline runs `barbacane compile` to verify the combined specs produce a valid artifact
4. Reviewers can see the exact diff: which endpoints changed, which middleware was added or removed, which authorization expressions were modified
5. The PR is approved and merged; the compiled artifact is produced and deployed

The pull request is the change management record. The CI compilation step is the automated control verification. The artifact version is the evidence that a specific approved state was deployed.

For organizations running structured change management (SOC 2 Change Management, ISO 27001 A.12.1.2), the audit trail is the Git history plus the artifact registry. There is no separate ITSM ticket describing what was supposed to change and then a separate verification of whether it did. The merged PR *is* the deployment record.

---

### What Barbacane doesn't replace

Being clear about scope matters, especially in compliance contexts where overstating controls creates its own risk.

Barbacane provides enforcement and evidence at the **gateway layer**. It does not replace:

- **Application-level authorization.** Fine-grained checks ("can Alice edit *this specific document*?") require data context that only the backend has. The gateway handles the coarse and medium-grained decisions; fine-grained ownership checks remain in the application.
- **Network security controls.** mTLS between services, network segmentation, firewall rules: these belong at the infrastructure layer.
- **Data encryption at rest.** Schema validation prevents unexpected data from entering your system; it doesn't encrypt what you store.
- **Identity Provider auditing.** OPA logs record what claims were presented; your Identity Provider logs record how those tokens were issued. Both chains of evidence are needed for a complete picture.
- **Backend logging.** The gateway logs the access decision; the backend logs what was done with the request. Compliance requires both.

Barbacane strengthens the API gateway layer specifically: authentication, coarse-grained authorization, schema enforcement, and configuration integrity. These are meaningful controls for most compliance frameworks, and the compile-time model makes them easier to evidence than traditional gateway setups. But they're part of a broader control stack, not a replacement for it.

---

### Mapping to compliance frameworks

Here's a practical mapping of Barbacane's mechanisms to common framework requirements, combining controls from both [Part 1](/blog/compliance-by-construction-part-1/) and this post:

| Framework | Requirement | Barbacane Mechanism |
|---|---|---|
| SOC 2 CC6.1 | Logical access controls | CEL/OPA/ACL middleware, JWT/OIDC authentication |
| SOC 2 CC6.3 | Removal/restriction of access | OPA policy changes via PR, CEL expressions per route |
| SOC 2 CC7.2 | Monitoring of security events | OPA decision logs, gateway access logs, heartbeat drift detection |
| SOC 2 CC8.1 | Change management | Git PR = change record; CI compilation = automated gate; artifact provenance |
| PCI DSS Req. 3 | Protect stored data | Secrets by reference only (`vault://`); never at rest in artifacts |
| PCI DSS Req. 7 | Restrict access by need | ACL, CEL, OPA per-route authorization |
| PCI DSS Req. 10 | Audit trails | OPA decision logs, artifact versioning |
| HIPAA §164.312(a) | Access control | JWT/OIDC + CEL/OPA authorization middleware |
| HIPAA §164.312(b) | Audit controls | OPA decision logs |
| GDPR Art. 25 | Data minimization | Schema validation with `additionalProperties: false` |
| ISO 27001 A.9.4 | Application access control | Per-route middleware chain with auditable spec |
| FedRAMP SC-13 | Cryptographic protection | FIPS 140-3 validated TLS via aws-lc-rs `fips` feature |
| CMMC L3 SC.3.177 | FIPS-validated cryptography | aws-lc-rs with NIST FIPS 140-3 Level 1 certificate |

This is not a compliance checklist. Frameworks have many more requirements, and meeting any of them requires organizational processes beyond technical controls. But for the API gateway layer specifically, these are the specific controls Barbacane provides, and the spec-driven model makes each of them auditable in a way that traditional gateway configuration cannot match.

---

### The audit that doesn't take a week

The practical benefit of Barbacane's approach surfaces most clearly when you're in an audit room, or preparing for one.

When an auditor asks "show me the access controls on your payment APIs," the traditional response involves gathering five documents, explaining the relationships between them, and acknowledging that a manual review would be needed to verify they're consistent. The Barbacane response is: here's the spec for the payment service, the `x-barbacane-middlewares` section on each route is what's enforced, here's the artifact hash deployed to production, here's the PR where those controls were reviewed and approved.

One document. One artifact. One history.

Conformity requirements are ultimately about demonstrating that your controls work as designed. When the design and the implementation are the same artifact, that demonstration becomes significantly less painful.

---

*Barbacane is open source (Apache 2.0) and available at [github.com/barbacane-dev/barbacane](https://github.com/barbacane-dev/barbacane). Questions about compliance use cases? Reach us at [contact@barbacane.dev](mailto:contact@barbacane.dev).*
