---
"freeholder": patch
---

Make `MASTER.md` the sole product and delivery source of truth. It now records
the verified baseline, the complete scope of DONE, dependency order, universal
acceptance criteria, and an actionable checklist for every remaining product
workstream. The superseded roadmap and session backlog are removed; their
history remains in Git. CI now enforces unique, contiguous checklist IDs,
rejects dangling work references, and prevents the retired files from returning.
