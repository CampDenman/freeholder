---
"freeholder": patch
---

Owner decisions 2026-09-27 (Tony Aly), plan-only (no product code changes).
paradisemodern's Paradise Comms replaces Daily as the de-facto first-party
voice/video provider (MASTER.md §4.14, §36, C3.13); the Daily adapter code
remains in-tree as optional non-first-party code, and C3.13's remaining
acceptance is live acceptance against a real paradisemodern instance.
Recorded honestly: the #364 seam and #394 owner-storage import shipped
against Daily and need the PM adapter re-targeted; transcripts are
unavailable until PM ships them; provider-side erasure of PM recordings
lands with PM's recording-delete API. Print-on-demand is deferred to v2
(MASTER.md §43.18's new second dated subsection, quoting the pre-change
C3.13 clause verbatim); the Printify adapter remains in-tree as working
optional code. The native Freeholder store is the product ("freeholder
should put shopify out of business"): new open item C3.24 proves native
storefront parity against Shopify-core capability with a published mapping,
and the Shopify importer is repositioned as a migration-only bridge
(MASTER.md §36, C3.13, deploy/first-party-plugins.md).
