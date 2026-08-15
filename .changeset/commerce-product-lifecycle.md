---
"freeholder": minor
---

Add the shared product lifecycle for physical, digital, service, rental, bundle
and pass products. A translated admin catalog now creates, edits, previews,
activates, archives and restores products through the same audited services
exposed to HTTP and MCP, with tax activation interlocks, visibility projections,
stale-write refusal, redirect-safe address changes and append-only history.

The catalog provides one durable Product identity for every supported kind so
options, variants, pricing, inventory, bookings and orders can build on the same
record. The `/admin/products` workspace includes translated list, filter,
creation, editing, responsive preview and lifecycle-history flows, with
permission checks and optimistic concurrency enforced by the shared service
layer.
