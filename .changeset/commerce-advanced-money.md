---
"freeholder": minor
---

Add linked deposit/balance invoices, exact payment-plan allocation, customer
credit, tips and pay-what-you-want terms, auditable late-fee invoices, and
gross/fee/net provider payout reconciliation. Stripe and Square payout events
join the shared authenticated webhook ledger, while contact merge, privacy,
admin attention, generated API/MCP services, and database constraints cover
the new money records without creating a parallel settlement path.

Operators can manage payment and refund recovery from the translated,
permission-scoped `/admin/payments` workspace. Deposit, installment, voluntary
payment, credit, late-fee and payout operations all converge through the same
integer-money invoice, Payment and Refund services; no second settlement ledger
or admin-only mutation path is introduced.
