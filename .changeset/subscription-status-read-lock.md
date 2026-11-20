---
"freeholder": patch
---

C9.33/C9.38/C12.38: allow the portal's parallel read-only membership status
checks to share the contact identity lock, preventing a spurious conflict on
ordinary pending-membership pages. Mutation and privacy cutover locks remain
exclusive.
