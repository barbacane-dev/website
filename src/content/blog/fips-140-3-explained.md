---
title: "FIPS 140-3, explained: what it validates and how to actually get it"
description: "FIPS 140-3 shows up as a procurement gate for government, defense, finance, and healthcare, and it is widely misunderstood. What FIPS 140-3 validates (a cryptographic module, not your whole application), how it differs from 140-2, whether it is quantum-safe, and how Barbacane provides it without an OpenSSL FIPS build."
publishDate: 2026-09-07
author: "Nicolas Dreno"
tags: ["barbacane", "api-gateway", "fips", "fips-140-3", "compliance", "security", "tls", "rustls"]
---

*FIPS 140-3 does not certify your product. It certifies a box of math your product is allowed to call. Confusing the two is how procurement conversations go sideways.*

If you sell software into government, defense, finance, or healthcare, FIPS 140-3 eventually appears on a questionnaire, usually phrased as a yes-or-no gate: "Does your product use FIPS 140-3 validated cryptography?" A wrong or hand-wavy answer stalls the deal. The trouble is that the question is more subtle than it looks, and most of the confusion comes from not knowing what FIPS 140-3 actually validates.

This is the plain-language version: what the standard covers, what it does not, how it differs from 140-2, whether it is quantum-safe, and what it takes to answer that questionnaire with a straight "yes."

---

### What FIPS 140-3 validates: a module, not your app

FIPS 140-3 is a US and Canadian government standard (NIST's, superseding FIPS 140-2) for **cryptographic modules**. A cryptographic module is the component that actually performs encryption, hashing, signing, and random number generation. FIPS 140-3 validation is a formal process: an accredited lab tests a specific version of a specific module against the standard, and NIST issues a certificate that names that module and that version.

The key word is **module**. FIPS 140-3 does not validate your application, your gateway, your TLS configuration, or your architecture. It validates the crypto library underneath, and only when that library is running in the exact configuration the certificate describes. Your application "uses FIPS 140-3 cryptography" when two things are true: it calls a validated module, and it calls it in the validated way, using only approved algorithms.

That distinction is the whole game. A product cannot be "FIPS 140-3 certified" as such. It can use a FIPS 140-3 validated module and enforce approved usage, which is what a security reviewer is really asking about.

### The four levels, briefly

FIPS 140-3 defines four security levels, and people often assume higher is strictly required. It usually is not.

- **Level 1** covers the cryptographic correctness of a software module: approved algorithms, correct implementation, self-tests. This is what a software product running on general-purpose hardware needs.
- **Levels 2 to 4** add physical security requirements: tamper evidence, tamper resistance, environmental protections. These matter for hardware security modules and physical appliances, not for a gateway binary running on a server or in a container.

For software, Level 1 is the target, and a Level 1 certificate on the crypto module is the right answer to almost every software procurement question about FIPS.

---

### FIPS 140-3 vs FIPS 140-2

140-3 is the current standard. NIST stopped issuing new 140-2 validations, and existing 140-2 certificates move to a historical status over time, so new work should target 140-3. If a questionnaire still says 140-2, it is usually because it has not been updated; a 140-3 validated module satisfies the intent and then some.

The two standards share the same shape. 140-3 aligns with the international ISO/IEC 19790 standard and tightens some requirements, but the mental model is identical: it validates a module, at a level, against a list of approved algorithms. Everything in this post applies to both.

### Is TLS 1.2 FIPS compliant? Is TLS 1.3?

This is one of the most common confusions, and the answer is: **the TLS version is not what gets validated.** FIPS validates the module and the algorithms. A TLS connection is FIPS-compliant when it is negotiated using only FIPS-approved algorithms (for example AES-GCM for the cipher, ECDHE for key exchange, SHA-2 for hashing) provided by a validated module.

Both TLS 1.2 and TLS 1.3 have FIPS-approved configurations. The work is not choosing a protocol version; it is making sure the connection can only ever use approved cipher suites, so a client cannot negotiate its way down to something non-approved. For TLS 1.2 specifically, FIPS guidance (NIST SP 800-52) also calls for the extended master secret extension, which is why you sometimes see that requirement attached to FIPS discussions.

### Is FIPS 140-3 quantum-safe?

No, and this trips people up. The algorithms FIPS 140-3 approves (AES, SHA-2 and SHA-3, RSA, ECDSA, ECDHE) are classical. They are not post-quantum. Post-quantum cryptography is a separate track: NIST published its first PQC standards (ML-KEM, ML-DSA, and others) as their own FIPS publications, distinct from 140-3. So a FIPS 140-3 validated module gives you classical assurance today; quantum resistance is a different, newer set of standards that a module can additionally implement.

---

### The part nobody enjoys: the OpenSSL FIPS build

Here is why FIPS has a reputation for pain. For most of its history, getting FIPS-validated cryptography in practice meant the OpenSSL FIPS module: a specific, separately built and configured version of OpenSSL, with its own integrity self-tests, its own build procedure, and a long history of version-matching headaches. Teams spent real time getting the FIPS module to build, link, and load correctly, and keeping it that way across upgrades. The cryptography was the easy part; the plumbing was the tax.

That tax is the reason a lot of products answer the FIPS question with "on our roadmap."

### How Barbacane provides it

Barbacane does not depend on OpenSSL at all. Its TLS stack is [rustls](https://github.com/rustls/rustls) with the [aws-lc-rs](https://github.com/aws/aws-lc-rs) cryptographic backend. AWS-LC holds a [FIPS 140-3 Level 1 validation](https://aws.amazon.com/blogs/security/aws-lc-is-now-fips-140-3-certified/) from NIST, so the module underneath is already the validated one.

Turning it on is a single build-time feature flag rather than a separate cryptographic build:

```bash
cargo build -p barbacane --release --features fips
```

With FIPS mode enabled:

- Only FIPS-approved cipher suites are offered, AES-GCM with ECDHE key exchange, with non-approved suites like ChaCha20-Poly1305 removed, so a client cannot negotiate down to something non-approved.
- The crypto path runs entirely through the validated AWS-LC module. No OpenSSL, no second build system.
- You can verify the active cryptographic provider at runtime with `GET /provenance` on the admin API, so the evidence is observable, not just asserted.

The evidence chain a reviewer wants is short and checkable: build flag, validated module, enforced cipher suites, runtime verification. That is the difference between "we use FIPS-approved crypto" as a claim and as something you can demonstrate.

---

### Where FIPS 140-3 fits, and where it does not

FIPS 140-3 is a cryptographic control, not a compliance program. It shows up as a specific requirement inside larger frameworks: FedRAMP names it in SC-13, CMMC in SC.3.177, and it appears in the crypto requirements for PCI DSS, HIPAA, and others. Satisfying it is necessary for those frameworks and nowhere near sufficient on its own. Validated cryptography does nothing about your access control, your audit logging, your secrets handling, or the twenty other controls an auditor will ask about.

That is the honest framing. FIPS 140-3 answers exactly one question well, "is the cryptography the government-approved kind, provided by a validated module, used in an approved way," and it is a hard gate when it applies. The rest of the compliance story lives elsewhere, which is a longer conversation we have written up separately in [Compliance by design](/blog/compliance-by-construction-part-2/).

---

### Narrower than it sounds

FIPS 140-3 is narrower than it sounds and more procedural than it looks. It validates a cryptographic module at a level against a list of approved algorithms; for software, that means a Level 1 validated module and the discipline to only ever use approved cipher suites. It is not a product certification, it is not the same as being FedRAMP-authorized, and it is not post-quantum.

The practical question is whether getting there costs you a second build system and a standing maintenance burden, or a feature flag over a module that is already validated. Barbacane is built for the second answer, because a gateway that terminates TLS for everything behind it is exactly where you do not want a cryptographic side-build you are afraid to upgrade.
