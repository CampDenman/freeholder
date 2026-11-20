---
"freeholder": patch
---

Use Next's shared-chunk production compiler and keep runtime storage-path canonicalization out of dependency tracing, preventing route-specific bundle duplication from exceeding standalone artifact budgets (C11.08/C11.17).
