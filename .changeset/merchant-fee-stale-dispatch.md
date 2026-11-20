---
"freeholder": patch
---

Refuse an original merchant fee dispatch once its reservation has already left the reserved state, including when another caller has completed it. A paused caller cannot reuse a completed operation as permission to send another refund after the provider forgets its idempotency key.
