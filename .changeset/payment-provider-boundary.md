---
"freeholder": patch
---

Card payments, refunds and card-reader takes started from your admin or API
are now recorded before Freeholder contacts the payment provider. If the
connection drops or the server restarts mid-request, the attempt stays on the
invoice instead of disappearing, so trying again with the same request
finishes the original payment or refund rather than charging or refunding
twice. A refund the provider rejects is marked failed and frees the amount.
