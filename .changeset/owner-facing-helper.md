---
"freeholder": patch
---

The six identical private copies of `ownerFacing()` — the helper that strips machine addressing off service errors before showing them to an owner — are now one shared helper in the admin action layer. Groundwork for catalog keys on service errors: one place to resolve a key instead of six.
