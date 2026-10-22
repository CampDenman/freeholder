---
"freeholder": patch
---

Card payments, refunds and card-reader takes started from your admin or API
are now recorded before Freeholder contacts the payment provider. If the
connection drops, the reader is busy, or the server restarts mid-request, the
attempt stays on the invoice instead of disappearing. Trying again with the
same request within 23 hours finishes the original payment or refund instead
of charging or refunding twice. After that, the attempt waits for you to check
it with the provider. A payment or refund that already failed is never resent.
A refund the provider definitely rejects is marked failed, which frees the
amount. A card-reader refund that is still settling now appears in in-person
reconciliation. An API key allowed to use one of these payment actions no
longer needs extra permissions to complete it.
