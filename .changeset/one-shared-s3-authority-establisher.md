---
"freeholder": patch
---

Fixes a case where Freeholder would write a file to non-Amazon S3-compatible storage and then refuse to clean it up again, reporting that the same endpoint it had just written to could not be trusted. Two separate pieces of code reached the storage layer by different routes, and only one of them checked the provider's behaviour beforehand; they now share a single check, performed once per bucket.
