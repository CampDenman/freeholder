---
"freeholder": patch
---

C1.12/C11.08: bind resumable uploads to the selected file's complete part sizes
and checksums before requesting upload links. Selecting a different same-size
file requires a new upload. Direct upload links remain gated while their full
recovery and storage-consumption lifecycle is completed.
