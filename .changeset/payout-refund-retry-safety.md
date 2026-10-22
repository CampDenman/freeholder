---
"freeholder": patch
---

Seller payouts through Stripe Connect, PayPal Payouts or Razorpay Route are
safer around refunds and retries. A payout refunded, disputed or paid by hand
before its transfer went out is no longer sent. A retry after a timeout reuses
the same provider idempotency key, so it returns the original transfer
instead of paying twice. If the provider might already have paid, for example
after a timeout, or if a PayPal payment is waiting to be claimed, the payout
is never sent again automatically. Instead it goes to review and asks the site
owner to check the provider, then record either "Provider paid" or "Provider
did not pay — send again". If a provider confirms a payment late, the payout
goes to review with a clear note, and a reversal is requested where the
provider supports one. Events for payouts from other services on a shared
provider account are acknowledged and ignored.
