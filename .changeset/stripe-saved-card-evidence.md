---
"freeholder": patch
---

Signed Stripe card-setup completions now retrieve the actual SetupIntent and saved method on the original account, rather than silently dropping the usual unexpanded event. Customer, account, status, consent usage and membership metadata must agree; incomplete evidence is retried without recording a payment (C12.38/C11.10).
