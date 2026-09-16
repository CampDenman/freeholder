---
"freeholder": minor
---

Memberships can now bill themselves. A plan chooses **manual** (you send the
invoice), **platform** (Freeholder charges a stored card when the period ends),
or **provider** (Stripe or PayPal own the calendar, and Freeholder follows
their webhooks). A mid-cycle plan change follows the proration rule you set on
the plan: charge the unused fraction now, or wait until this period ends.

Automatic modes need a stored payment method on the contact. Customers can
change plan from the portal the same way they already cancel.
