<!-- Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0 -->
# Proration financial history/export correction — 2026-11-13

C1.08/C9.33/C12.38. Finite SOURCE ONLY correction following signed
`60c78f68`, after the source-only foundation/gross/commission/boundary stack.
MASTER §43 remains the only status authority. No compiler, lint, tests, build,
database, migration, native or provider operation ran. Six prepared controls
are UNRUN and supply no passing qualification or stable sign-off.

## Corrected behavior

`prorationMoneyWitnesses(tx, invoiceIds)` previously discovered target-owned
funding only through `invoice_credit_applications`. An accepted reservation
without an application could therefore disappear from the target's inventory.
Discovery now additionally joins the actual requested invoice IDs to the
immutable accepted `subscription_prorations.debit_invoice_id`, requires
`invoices.source_type='subscription'`, and requires both invoice source and
reservation target source to equal that exact accepted subscription/proration
identity. Prefixes, amounts, current contacts and current accounts cannot
adopt ownership. All applications and reservations of the discovered original
funding, including immutable release history, remain selected and hashed.
Combined discovery exceeding5000 refuses before expanding its funding IDs.
No full-row internal PostgreSQL SHA256 or original capacity check is removed.

`exportProrationMoney` retains external principal/refund amounts and original
credit/application lineage. Its buyer projection now excludes merchant fee
obligations and actual commission amounts, matching the separate agreement-fee
buyer's projection policy. Associated fee receipt IDs, payment IDs, original
remittance IDs, directions and recording times remain. Authorized merchant
review and the complete private financial fingerprints remain unchanged.

The `commerce.money` privacy source now applies one5000 bound across actual
exported invoice rows and their lines/taxes/payments/refunds/credit notes,
merchant recovery and its five cash arrays, credit/external-money history,
commission assignments, exemptions and provider credential identities. Each
actual returned family counts; separately bounded helpers cannot jointly
produce an oversized archive. Nested receipt JSON is a row body, not another
invented family. Unsupported family shapes fail closed. The original invoice
ID selection is bounded before loading its bundles. No retained receipt,
actual caller, raw evidence or previous failure is rewritten or deleted.

## Prepared controls and limits

Three pure controls exercise exact5000, a combined overflow when each helper
is independently bounded, and row-body versus family-container counting.
Two synthetic PostgreSQL query-adapter controls exercise actual generated
Drizzle SQL and target-side unapplied reservation/release discovery, plus
overflow refusal. One adapter control exercises both actual witness selection
and the buyer projection SQL, retaining actual principal while refusing
private fee/actor/evidence columns. These use explicit synthetic read rows;
they are not native database, ownership, transaction or provider acceptance.
No fabricated ServiceContext or financial writer is used.

Actual fresh-database source/transport/native/merge/export/concurrency proof
remains required. In particular, the query-adapter controls do not replace an
actual foreign/ambiguous target refusal or a real unapplied-reservation native.
Earlier source/parity/native failures, existing databases and SQL fragments
remain unchanged. The new files do not assemble or install any SQL.

## Root central integration contract

Root still owns `merchant-refund-dependencies.ts`,
`merchant-payment-dependencies.ts` and `merchant-tax-privacy.ts`. This slice
changes none of them. Preserve their exact five cash witness arrays, receipt
aliases and composite namespace+feedback identities, including raw feedback
before an owner/GET. The new helper families still require root composition:

| Helper | Actual parent selector | Children and real identifiers |
| --- | --- | --- |
| `prorationMoneyWitnesses(tx, invoiceIds)` | Actual invoice IDs; source funding FK or exact accepted target/application/reservation graph | Attested payment/refund/fee IDs and funding/reservation/application/release IDs; full-row SHA256; `incomplete` |
| `subscriptionProrationWitnesses(tx, subscriptionIds)` | Actual owned subscription IDs; merchant callers must additionally preserve frozen profile ownership | Accepted proration ID/subscription, principal ID/proration/source payment or application, credit-use ID/proration/note; full-row SHA256; `incomplete` |
| `agreementFeeWitnesses(tx, invoiceIds)` | Actual accepted duty invoice; merchant ownership is `agreement_fee_duties.merchant_profile_id` | Duty invoice, credit application, actual cash payment, eligibility invoice, remittance/original-remittance IDs; full-row SHA256; `incomplete` |
| `subscriptionProrationBoundaryWitnesses(tx, invoiceIds)` | Actual target invoice/proration; real payment/application FKs | Cash payment and credit application confirmations with full-row SHA256; `incomplete` |

Each helper's returned families have a combined5000 bound. Root must reject
any incomplete helper and apply the complete parent/cohort bound across all
new and existing distinct financial children. Internal snapshots retain only
IDs/hashes; customer exports use explicit safe projections. Do not hash a
safe projection as a replacement for the original immutable row.

Invoice fingerprints must include these children before the current
`originalPaymentIds=[]` and no-modern-route exits. Cashless credit/duty targets
cannot require a fictional payment. Profile snapshots/export must discover
actual `subscription_prorations.profile_id`,
`agreement_fee_duties.merchant_profile_id` and
`commercial_payment_attestations.merchant_profile_id`, rather than adopting
every merchant on a mixed invoice. Root's current `merchantProfileCashOwners`
only discovers existing provider routes/receipts; external attestations and
cashless obligations require their own exact original parent selectors.

`subscriptionOriginalEvidence` needs direct accepted proration/principal/
credit-use/boundary fingerprints. Its existing subscription invoice source
prefix already discovers `<subscription>:proration:<id>` debit invoices;
changing that selector is unnecessary. A pure uncharged trial can have an
accepted proration without any debit/payment, so invoice-only composition is
insufficient. Keep parsed undo receipts compatible: use explicit new evidence
kinds with their parser, or fold the complete exact children into an existing
owned fingerprint; never emit unparsed fields or guess historical children.

All17 new stack tables already declare private search/noTTL policy and inherit
real invoice/subscription/profile FKs; no new contact-id column needs repointing.
Buyer and agreement privacy registrations must retain their cross-scope holds.
Merchant commission export still needs its own authorized safe projection;
the buyer projection must not become a merchant-private export by convenience.
