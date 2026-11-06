---
"freeholder": patch
---
Stripe can now deliver its webhooks to a private preview. Signed deliveries to the Stripe Connect payouts route and the Stripe payments route pass the preview gate, and each route still checks Stripe's signature. Everything else on a preview, including unsigned requests to those routes, still needs the preview link.
