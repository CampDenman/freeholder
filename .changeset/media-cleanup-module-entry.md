---
"freeholder": patch
---

C1.12/C3.22/C11.08: isolate original media deletion routing from the receipt
ledger's module-initialization cycle so archive cleanup and other genuine
storage consumers can load the same guarded deletion path reliably.
