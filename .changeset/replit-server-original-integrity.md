---
"freeholder": patch
---

Preserve original Replit storage when an upload fails integrity verification. Reject emulator routing, prevent the provider SDK from deleting objects during checksum cleanup, and verify every uploaded byte independently. Retain positive upload acknowledgments even when later verification fails so privacy recovery keeps the original storage evidence.
