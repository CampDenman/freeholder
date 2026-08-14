---
"freeholder": minor
---

Add production payment adapters for Square, Mollie, Razorpay, Paystack, and
Flutterwave behind the existing invoice/payment/refund ledger. Each provider
gets capability discovery, hosted checkout and recheck, refunds, authenticated
webhook convergence, readiness diagnostics, environment documentation, and a
mocked contract suite without introducing a second balance or storing raw
provider payloads.
