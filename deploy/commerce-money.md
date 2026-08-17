# Commerce money and tax foundation

Freeholder's `invoicing` module is the single accounting spine for invoices,
payments, refunds, credit notes, customer balances, payment plans, provider
payouts, and the tax evidence attached to them. Catalog, checkout, booking,
tips, subscriptions, and future plugins must call these
services instead of creating parallel money records.

This checkpoint does not claim a complete public storefront. It establishes
the transaction-safe money path those surfaces use.

## Money rules

- Every amount is an integer in the currency's minor unit. Fractional quantities
  use millionths (`quantityMicros`); extension and tax rounding use integer/
  bigint arithmetic and reject unsafe JavaScript numbers.
- Creation calls carry an idempotency key and a canonical request hash. Reusing
  a key with the same request returns the original row; reusing it with changed
  contents is a conflict.
- Invoice and credit-note numbers are allocated inside the issuing transaction.
  A failed transaction does not consume the number.
- Invoice, payment, refund, and credit-note lifecycle changes append immutable
  `money_state_events`, emit module events, and add contact timeline evidence
  where the customer should see the consequence.
- Payment settlement locks both payment and invoice, so competing successful
  attempts cannot overpay. Refund creation reserves the refundable balance, and
  settlement updates refund, payment, and invoice atomically.
- Issued invoices are not edited. Adjustments use a numbered credit note;
  returned money uses a refund tied to the successful payment.

The current transitions are:

```text
invoice:     draft -> sent -> viewed/overdue/partially_paid -> paid -> refunded
                    \-> void (only while unpaid)
payment:     created -> processing -> succeeded
                     \-> failed/cancelled
refund:      created -> processing -> succeeded
                     \-> failed/cancelled
credit note: draft -> issued -> void
payment plan: active <-> defaulted -> completed/cancelled
payout:      pending -> in_transit -> paid
                    \-> failed/cancelled
```

## Advanced terms and voluntary money

- `invoicing.createDepositAndBalance` creates two normal invoices and links the
  balance to its deposit. Each retains its own due date, tax evidence, number,
  payments, and immutable issued total.
- `invoicing.createPaymentPlan` requires installments to add up exactly to the
  invoice's current outstanding balance. Successful partial payments allocate
  oldest-due-first and may span installments. Refreshing a plan derives due and
  default state from an explicit time; cancelling terms retains every prior
  allocation.
- `invoicing.createFlexiblePayment` validates a chosen amount against snapshotted
  minimum/maximum terms, then creates a normal tip or pay-what-you-want invoice.
  An attached invoice must have the same contact and currency.
- `invoicing.assessLateFee` waits until the due date plus grace period, applies
  fixed or integer-PPM percentage terms to the outstanding principal, honors a
  cap, and creates a linked fee invoice. It never edits the overdue invoice.
- Customer credit is held per contact and currency in an append-only balance
  journal. Applying credit creates provider `balance` money in the normal
  `Payment` table; refunding it uses the normal `Refund` table and restores the
  credit atomically. The internal provider is not selectable as an external
  checkout adapter.
- Contact merge combines same-currency credit without losing entries, and exact
  undo restores both accounts if neither changed after the merge. Privacy export
  includes advanced terms and movements; erasure redacts free text while
  retaining required accounting amounts and links.

## Operator workspace

`/admin/invoices` lists, filters and reconciles invoices. `/admin/invoices/new`
creates a draft through `invoicing.createDraft`. The invoice detail issues,
voids, credits and shows immutable tax lines, payments and receipts. Tax
configuration lives at `/admin/invoices/tax`: dated starters, categories,
zones, rates, registrations (collection stays off until the starter limitation
is acknowledged), exemptions and threshold progress. Contact records with
invoicing access show that contact's invoices. These screens call the same
services as HTTP and MCP.

## Tax setup

1. Call `invoicing.listTaxTemplates` and show the source, verification date, and
   activation limitation to the owner. The tax studio at `/admin/invoices/tax`
   does this.
2. Call `invoicing.installTaxTemplate`. Installation is idempotent and creates
   its zone, rates, and registration in `monitoring`; it never starts collecting
   tax.
3. Add or adjust `TaxCategory` and category-specific `TaxRate` rows for what the
   business actually sells. An exact category row replaces the same generic
   named jurisdiction rate, so a zero-rate category does not stack with it.
4. Configure the registration number, collection date, and any monetary
   threshold. A non-zero threshold must state its currency.
5. Review the template limitation and activate with
   `acknowledgeTemplateLimitations: true`. That acknowledgement is included in
   the normal mutation audit record.
6. Quote with origin and destination. Matching is country first, then postal/
   region specificity, explicit priority, and stable name order. No locale or
   translated URL participates in tax location.

The catalog contains 13 Canadian province/territory starters, 27 EU member
standard-VAT starters, UK VAT, Australian GST, New Zealand GST, and 51 US state/
DC base-rate starters. Definitions are versioned and source-attributed in
`src/modules/invoicing/tax-templates.ts`.

All starters deliberately interlock activation because a standard rate is not
the same as a complete tax decision. Reduced/exempt categories, place of
supply, shipping, thresholds, and business facts still require review. US rows
are especially limited: state base rates do not include county/city rates or
address-level taxability. Add explicit local zones for the handful of places a
business sells into, or use a later tax adapter before enabling broad US sales.

## Calculation and evidence

- Rates use integer parts per million, not basis points. This represents rates
  such as Quebec's 9.975% exactly as `99_750`.
- Zones choose line or invoice rounding, half-up or bankers rounding, and
  inclusive or exclusive source prices.
- Sequential compound rates operate on prior tax. Inclusive compound regimes
  are refused by the built-in engine because reverse extraction is ambiguous
  without jurisdiction-specific rules.
- Shipping is a separate taxable subject. Each rate states whether it applies.
- A validated, unexpired exemption produces explicit zero `TaxLine` rows and a
  required invoice legend; reverse-charge wording is retained.
- Every calculated draft snapshots rate name, rate PPM, taxable amount, tax
  amount, jurisdiction, registration number, inclusion/compound flags, order,
  exemption kind, and a plain-language explanation. Later rate edits do not
  change that evidence.
- A matching zone without an active registration returns zero with an explicit
  explanation. The invoice stores that explanation instead of silently
  presenting tax as zero.

`invoicing.taxThresholds` reports issued gross sales, refunds, net sales,
transaction count, remaining amount, and parts-per-million progress for each
registration. It never combines currencies. The configured currency drives the
threshold state, while excluded currency totals remain visible. The report uses
gross issued sales for a conservative signal and presents refunds/counts
separately because legal threshold definitions vary.

`invoicing.receipt` returns a stable receipt number, customer, successful
payment reference, invoice lines, immutable tax lines, and settled refunds.
`invoicing.reconciliation` independently sums successful payments and refunds
against the stored invoice/payment balances and names every discrepancy.
`invoicing.reconcileAdvancedMoney` independently checks customer journal sums,
payment allocations, and reconciled payout nets. Provider operations expose
unsettled checkouts, disputes, unmatched statement lines, payout deposits, and
authenticated webhook receipts together.

## Access and provider boundaries

All services are `scoped` under the `invoicing` module. Owners and administrators
receive manage access; bookkeepers receive invoicing manage access; customers
receive none by default. Generated HTTP API and MCP projections come from the
same service registry. Checkout will call the quote/create services through a
purpose-built public boundary rather than granting anonymous callers arbitrary
tax-exemption or money mutations.

Payment-provider code remains behind `src/adapters/payments`. The disabled
adapter cannot fabricate checkout URLs, provider references, webhooks, or
refunds. Stripe, PayPal, manual/offline orchestration, receipt PDF/archive
rendering, and provider reconciliation remain subsequent C5 checkpoints.

## Migration and verification

The additive migrations are:

- `0043_worried_shaman.sql`: normalized tax and money tables, constraints,
  indexes, and foreign keys.
- `0044_nervous_maelstrom.sql`: tax-zone attribution on invoices and
  currency-safe registration thresholds.
- `0045_peaceful_puck.sql`: database enforcement that a valid exemption has
  validation evidence.
- `0046_right_swordsman.sql`: provider customers, methods, disputes, and
  authenticated event receipts.
- `0047_fantastic_miss_america.sql`: balances, plans/allocations, voluntary
  payment terms, late-fee evidence, and provider payout reconciliation.

After deployment, migrate normally and verify with:

```sh
pnpm exec vitest run tests/core/money-arithmetic.test.ts tests/core/invoicing.test.ts tests/core/advanced-money.test.ts
pnpm typecheck
pnpm lint
```

Rollback is application-first: deploy the prior application while leaving the
additive tables in place. Do not drop money or tax evidence during an incident.
Backup/restore and ownership export discover these tables through the module
manifest.
