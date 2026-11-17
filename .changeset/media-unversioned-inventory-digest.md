---
"freeholder": patch
---

C1.12/C11.08: admit valid unversioned S3 inventory evidence during exact original
multipart recovery. The TypeScript resource digest now omits an absent `versionId`
exactly as the PostgreSQL guard does, instead of hashing it as `null`.
