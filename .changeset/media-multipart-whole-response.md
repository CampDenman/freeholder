---
"freeholder": patch
---

C1.12/C11.08: parse and retain complete bounded original multipart responses
before accepting session or completion results. Embedded200 errors, duplicate
identities and redirects require recovery. An absent upload ID is distinguished
from an actual abort acknowledgement; full multipart availability stays gated.
