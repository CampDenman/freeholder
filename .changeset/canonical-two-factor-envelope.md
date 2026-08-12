---
"freeholder": patch
---

Reject malformed or non-canonical encrypted two-factor secret envelopes before
decryption, so alternate Base64URL spellings and corrupted lengths fail closed
while existing canonical AES-GCM records remain compatible.
