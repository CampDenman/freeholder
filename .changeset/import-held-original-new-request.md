---
"freeholder": patch
---

Allow a new verified erasure request for the same retained contact to finish cleanup after an original import hold is released and its raw bytes have already been retired. Reuse only the intact original receipt and immutable upload, graph and chunk identity; preserve that receipt, refuse conflicting ownership or physical evidence, and minimize the original private index through the existing durable cleanup task.
