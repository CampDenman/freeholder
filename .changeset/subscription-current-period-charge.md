---
"freeholder": patch
---

C9.13/C11.05: allow stored-method charges for an invoice in an already-started
subscription period. The billing guard now skips only genuinely future periods or
pending future plan changes instead of confusing the current period's end with a
future start. Pending and failed-charge recovery still require authenticated
provider evidence.
