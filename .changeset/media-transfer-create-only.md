---
"freeholder": patch
---

C11.08: create transferred objects only if their target name is still unused
when the provider applies the write. S3 transfers use conditional PUT; Replit
transfers use the official Google Storage client's generation precondition
through the same Replit credential broker. A concurrent target writer or an
unsupported precondition stops the transfer without an overwrite fallback.
Existing identical objects still skip safely on a later run.
