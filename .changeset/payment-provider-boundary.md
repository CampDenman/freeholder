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
amount. When the provider says a charge was already refunded, the refund is
flagged for your review instead.

Payment reconciliation and in-person reconciliation now list refunds that need
checking with the provider. This covers refunds that are still settling or lost
their answer, and refunds the provider reports as already made. The in-person
page shows them with a count. For API and SDK users: in-person reconciliation's
`balanced` value is now also `false` while any refund is listed in the new
`refundsNeedingReview` field, and `reconcilePaymentProviders` returns the same
field. An API key allowed to use one of these payment actions no longer needs
extra permissions to complete it.
