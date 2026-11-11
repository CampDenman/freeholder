---
"freeholder": patch
---

Require authenticated refund feedback to identify its original payment as well as its original account, amount and currency, including feedback for an already terminal refund. Preserve actual Stripe cancellation feedback and expanded parent references. Record a provider cancellation as an unsuccessful refund with its explicit cancellation reason, release only its reservation, and never invent refunded money; the immediate provider response keeps the same reason.

Preserve the same PaymentIntent ID in expanded Checkout responses, signed Checkout events and refunds, so strict original-parent validation stays compatible with actual provider object shapes.
