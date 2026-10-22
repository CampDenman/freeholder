---
"freeholder": patch
---

Seller payouts through Stripe Connect, PayPal Payouts or Razorpay Route are
safer around refunds and retries. A payout refunded, disputed or paid by hand
before its transfer went out is no longer sent. If the provider pays a seller
after the buyer was refunded, the payout goes to review and a reversal is
requested where the provider supports one. A retry after a timeout reuses the
same provider idempotency key, so it returns the original transfer instead of
paying twice. If a refund arrives while an earlier attempt's outcome is still
unknown, the payout goes to review so the owner can check with the provider.
Provider confirmations that arrive before the transfer is recorded are now
matched by payout id. A confirmation for one of the site's payouts that cannot
be matched is answered with a retryable error instead of being acknowledged.
