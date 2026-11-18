---
title: "Less under the gateway: three ways to own a container base, measured"
description: "A scanner stopped our release over a library Barbacane never loads. So we set out to own the base of our images, and tried three: a static binary on scratch, Debian's glibc on scratch, and Wolfi packages built with apko. Here is what each one cost, measured in CI."
publishDate: 2026-11-18
author: "Nicolas Dreno"
tags: ["barbacane", "security", "containers", "supply-chain", "engineering"]
draft: false
---

*A container image is a list of things you trust. Keep the list short, and know where every line comes from.*

When we tagged Barbacane 1.0.0-rc.1, the release stopped at its last gate. Everything had built and been signed when the vulnerability scan failed it: a finding in OpenSSL, inside the Debian-based image the gateway ran on. The finding was real. It was also irrelevant: Barbacane does not use OpenSSL. TLS is rustls, linked into the binary.

That is the everyday problem with base images. Your scanner reports what is in the image, not what your program uses, and your security team has to answer for every line of the report. The fix for the release was quick: we moved the gateway onto Chainguard's `glibc-dynamic` image, which holds glibc, libgcc and CA certificates and little else, and the scan came back clean.

It left us with a question, though. Chainguard's free tier publishes `latest` and nothing else. We pinned the image by digest and bumped it by hand, which works, but it meant the floor under our gateway was a vendor's free offer, with no version we could name. And the control plane still ran on Debian slim, with a shell and a package manager it never uses.

So we asked: can we own the base of our images, as bare as it can be, with the same visibility for scanners? We tried three ways. This post is what each one cost.

---

### How we measured

Every variant went through the same gauntlet, in CI, before we drew any conclusion:

- **Function.** The full integration suite against the image's gateway binary, the security suite, and the control-plane CLI and connected-mode tests against a real PostgreSQL. Then the gateway, running in the container, proxied a call to `localhost` (the image's name resolution) and one to a public HTTPS host (DNS and CA certificates).
- **What a scanner sees.** Syft lists the packages and crates in the image; Grype runs twice, once as our release gate (high or critical with a fix available) and once with default settings, which is what most users' scanners do.
- **Load.** The same gateway build, run as a container on the same CI runner, against today's image: three alternating rounds of 20 seconds under wrk, 64 connections, on a mock route and on a route proxied to an upstream, with CORS and correlation-id middlewares on every request.

Shared CI runners are noisy, so we compare medians, alternate the images round by round, and re-run when a round is disturbed for both.

---

### Attempt one: a static binary on scratch

The barest image there is: `scratch`, one statically linked binary, CA certificates and a passwd file. No libc in the image at all, because musl is compiled into the binary. The gateway image came to 15.0 MB, and every functional test passed.

Then the load test:

| | glibc build | static musl build |
|---|---|---|
| mock route, requests per second | 1,893 | 442 |
| proxied route, requests per second | 1,243 | 404 |
| peak memory | 97 MiB | 428 MiB |

About four times slower, with four times the memory, and that is with mimalloc as the allocator, since musl's own is known to struggle under threads. We have not pinned down the cause yet: the allocator on a static musl binary, musl's memory routines, or the WebAssembly runtime under musl are the candidates, and [barbacane#409](https://github.com/barbacane-dev/barbacane/issues/409) tracks it. It matters beyond images, because our release also ships musl tarballs.

There was a second problem, quieter. With musl inside the binary and no package database, a scanner sees no operating-system packages at all. That is not the same as nothing to worry about: it means a musl advisory would be invisible to every scanner pointed at the image.

---

### Attempt two: Debian's glibc on scratch

Next, keep glibc and take only what the binary links: Debian's `libc6` and `libgcc-s1`, copied onto `scratch` with their records in the dpkg database and Debian's `os-release`, so a scanner knows exactly which versions are inside. A short script built the file tree and refused to finish unless the binary started on those files alone.

It worked: every test passed, and the image was 19.7 MB. Two things held it back.

**The scanner report.** A default Grype scan listed 33 CVEs against `libc6` and `libgcc-s1` on Debian 12, one of them critical and six high. Debian 13 brought it to 31, five high. Most of them are marked "won't fix": Debian's security team judges each one, and many are minor or not worth a change to a stable release. The release gate passed, since none had a fix to apply. But a user's scanner cannot read that judgment, and neither can the auditor reading its report.

**The load test.** The gateway served 6 to 10% fewer proxied requests per second than on today's image, with about 10 MiB more peak memory, run after run. To find out whether that came from our build or from the libraries, we swapped binaries between the two images. The gap followed the runtime libraries: our build was not the cause, Debian's libraries were.

---

### What the vendor image was really giving us

That swap was the turning point. Today's image scanned clean and ran fast, and neither came from the image as such. They came from two things underneath it: Wolfi's glibc, which ran our workload faster than Debian's, and Wolfi's security feed, which scanners read to know which versions carry which fixes.

Both are open. Wolfi is an open-source distribution with a public package repository, and apko, the tool that assembles images from Wolfi packages, is open source too. Both are Chainguard's work, and this post is in part a thank-you. Nothing about them requires the free tier of a registry.

---

### Attempt three: Wolfi packages, our lock

So we wrote our own base. One file lists five packages from the public Wolfi repository: the base file layout, the CA bundle, glibc and its loader, and libgcc, plus a non-root user, uid 65532. glibc pulls in one more, its POSIX locale, for six packages in all. A lockfile pins each one by version and checksum, and the Dockerfiles run apko to build the base from that lock on every build. The same lock gives the same files, on a laptop or in our release pipeline, and no registry tier is involved.

The image holds the gateway binary and those six packages. The only other programs in it are glibc's `ldconfig` and its loader. No shell, no package manager.

| | static musl on scratch | Debian's glibc on scratch | Wolfi packages via apko |
|---|---|---|---|
| proxied requests per second, against today's glibc build | 0.33x | 0.90 to 0.94x | 1.00x |
| peak memory, against today's glibc build | 4.4x | 1.11 to 1.13x | 1.01x |
| CVEs a default scan lists in the OS layer | none visible | 31 to 33 | 0 |
| gateway image, compressed | 15.0 MB | 19.7 MB | 18.0 MB |

Same throughput and latency as today, on both routes. Same memory. A default scan with nothing to report in the operating-system layer. And an image 1.3 MB smaller than the one it replaces.

The control plane moves onto the same base, off Debian slim. It loses its shell, so its container health check could no longer be a shell one-liner: `barbacane-control health` now calls the `/health` endpoint, and the image's health check runs it.

---

### Keeping the floor current

A pinned base is only as good as the way you move it. Every night, a workflow builds the base from the committed lock and scans it, scans the images of the latest release for anything published since, and resolves the packages again. When Wolfi has shipped something newer, a glibc fix or a CA bundle update, the new lock lands on a branch, and we open it as a pull request that CI builds, tests and scans like any other. Nothing moves under the gateway without going through review.

---

### Two things we found on the way

Measuring things carefully tends to find things you were not looking for.

**Scanners could not see our dependencies.** A Rust binary is opaque to an image scanner: it sees one file, not the 400 crates compiled into it. We now build the binaries with `cargo auditable`, which embeds the dependency list in the binary itself, where scanners read it. On its first run, Grype matched two advisories in that list that our existing check had never reported, because they had an entry in GitHub's advisory database and none in the RustSec database that `cargo deny` reads. We updated both crates the same day ([barbacane#410](https://github.com/barbacane-dev/barbacane/pull/410)); the changelog explains how far each one reached into Barbacane.

**A bug under load.** The load test showed that about 2 to 3% of proxied requests failed in our benchmark setup, on today's image too. It has nothing to do with base images, and we would not have seen it without running every variant at full tilt. [barbacane#408](https://github.com/barbacane-dev/barbacane/issues/408) tracks it.

---

### What changes for you

Starting with the next release:

- **`barbacane`** runs on the new base. Its contract does not change: uid 65532, no shell, the same entrypoint.
- **`barbacane-control`** runs on the same base, as uid 65532 with its home in `/home/nonroot`, and without a shell. If your Compose file checks its health with a shell command, use `["CMD", "/usr/local/bin/barbacane-control", "health"]`, and make sure any volume it writes to is writable by uid 65532.
- **`barbacane-standalone`**, the image that bundles every official plugin, is unchanged.

You do not have to take our word for any of this. Point your own scanner at the image, `grype ghcr.io/barbacane-dev/barbacane:<version>` or any other, and read what it finds. Release images are still signed with Sigstore and carry a CycloneDX SBOM attestation; the [documentation](https://docs.barbacane.dev/reference/configuration.html#verifying-release-container-images) shows how to verify both.

---

### Less, and known

We started with a smaller question than we ended with. The smallest image, a static binary on scratch, turned out to be the slowest, and the one a scanner could see least into. Owning the base did not mean building it from nothing. It meant choosing a short list of packages from an open distribution, pinning every one of them, and making each change to that list a reviewed, tested, scanned pull request.

Less under the gateway, and every line of it known. That is the same idea as the rest of Barbacane: trust nothing you have not checked, including the floor you run on.
