---
"freeholder": patch
---

Split CI into isolated, time-bounded gates and promote only the exact image
digest produced by a successful main-branch run, with lockfile-bound dependency
evidence, event-bounded pull-request and merge-queue secret scans, build
provenance, signing, and SBOM attestation. Balance test shards by estimated
runtime rather than hashed file count so the CI deadline remains meaningful.
