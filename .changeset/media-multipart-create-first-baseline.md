---
"freeholder": patch
---

C1.12/C11.08: retain the original pre-upload storage checks before creating a
multipart session. Conflicting retained files or sessions require recovery;
a lost upload response cannot silently adopt another session. Full resumable
upload recovery remains gated until its complete lifecycle is verified.
