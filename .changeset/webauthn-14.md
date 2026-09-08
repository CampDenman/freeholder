---
"freeholder": patch
---

Security keys keep working on the current WebAuthn library. The browser and
server halves of `@simplewebauthn` are one contract split across a network
boundary, so they now move to version 14 together rather than one at a time.
