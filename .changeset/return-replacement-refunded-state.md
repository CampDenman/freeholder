---
"freeholder": patch
---

Fixes a return that could flip back to "needs attention" after its replacement refund had already settled, leaving a customer and an owner looking at a return marked unpaid when the money had in fact been returned. When a bank refund fails and is replaced, Freeholder reconciles the whole chain in one pass; the failed original was still allowed to reopen the return even though the replacement had succeeded, and whether it did depended on the order the refunds happened to be processed in. A failed refund no longer reopens a return whose credit another refund for the same part has already settled. A genuine failure on a different part still reopens it, as before.
