<!-- Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0 -->
# Original proration money source checkpoint — 2026-11-13

C9.33/C9.38/C12.38/C1.08. This isolated checkpoint follows foundation
`2fe23a880967d5ac48719438c8ff88ed0cde0c8e`, including the separately extractable
legacy net-only paid-access repair `de2dff5518e24f9e049483c14f655db4df5826a7`.
It is source-only and unqualified. No compiler, lint, tests, database,
migration, build, native adapter or provider operation was run. MASTER §43
remains the only status authority; no feature or stable gate closes here.

## Implemented source boundaries

- A real noncash invoice projection: `creditedMinor` is backed by immutable
  original funding, reservation, application and unused-release rows.
  `paidMinor` remains actual cash. Shared due/checkout/POS/reminder/customer
  and subscription activation checks subtract credit without creating a fake
  payment. An application requires the same original buyer, currency,
  merchant, fee contract and tax owner and refuses a competing open payment.
- Original cash cannot fund a credit plus a refund. Root funding reserves
  principal; a later credit-funded invoice retains its exact parent
  application rather than pledging the same root cash again. The whole exact
  RMA note stays reserved for its return even when cash failed or is unknown.
  Reverse ownership refuses adopting an already funded/reserved/applied
  ordinary note as a return note, including retained released history.
- Original external subscription principal uses the existing authorized
  `recordOfflinePayment`/`recordOfflineRefund` actions and their actual shared
  payment/refund rows. Independent immutable attestations retain original
  merchant/profile/version, invoice, currency, reference and evidence hashes.
  The routing marker `recorded_external` deliberately has no Stripe account,
  application-fee transfer, provider observation or independent-bank claim.
  Actual unfinished creators and unapplied positive cash prevent another
  external record. System/agent/plugin access keeps the existing scoped money
  policy; no new human-only approval was added.
- Original fee OWED is separate from actual fee remitted. Partial mixed
  external/provider principal uses each exact original fee owner. Refunds
  preserve the existing nonallocation agreement fee epoch's floor-rounded
  proportional retained-fee rule. Actual fee returns name one original
  remittance and cannot exceed its remaining actual amount. A fully recorded
  customer principal can settle access while unpaid/over-remitted fees remain
  financial/privacy debt. Immutable fee receipts and safe principal state
  survive buyer/merchant privacy minimization.
- Shared review, actual remittance and return services supply HTTP/MCP and
  owner UI with the same authorization, fresh verification, audit and money
  approval policy. Quote notice and UI describe attestations explicitly in
  EN/FR/ES/AR. Private search/retention declarations and customer export are
  included. There are no new contact-id columns.

## Owned unapplied SQL

Frozen reader tail remains exactly
`1da78852ed7ba94a2e77596fe8b41bebc3ce3c174d79dacc7a60c933a98b4d46`.
New owned tails are:

1. `subscription-commercial-attestation80.fragment.sql` —
   `e19780890b5b07bcd624331ea54596fa2dff8757d583df97a32bb4aa75c7b277`.
2. `subscription-proration-credit80.fragment.sql` —
   `cebd65035c3f9c8580a89c37c2bb794e7109e50747bc4cd1dc52319ae9e17f70`.

They are not assembled or applied. The attestation tail narrowly extends the
existing `guard_merchant_payment_binding` with the explicit manual origin;
the prior provider branches remain. Root must reconcile that function with
its exact current assembly before fresh qualification. Earlier frozen SQL,
models, first captures, historical callers and failed evidence are unchanged.

The credit tail intentionally remains **incomplete for assembly**: its
accepted-proration writer guards call the not-yet-installed causal functions
`freeholder_subscription_proration_credit_owner`,
`freeholder_subscription_proration_credit_target` and
`freeholder_subscription_proration_credit_release`. The new subscription
proration models and causal query hooks are drafted but are not yet registered
as a complete accepted quote/commit lifecycle. Do not treat the extension as
admitted business behavior or install it independently as feature completion.

## Root witness integration contract

Root owns `merchant-refund-dependencies.ts`, `merchant-payment-dependencies.ts`
and `merchant-tax-privacy.ts`; this checkpoint changes none of them.
`prorationMoneyWitnesses(tx, invoiceIds)` returns `recordedPayments`,
`recordedRefunds`, `recordedFees`, `funding`, `reservations`, `applications`,
`releases`, and `incomplete`. Each child has its exact id, real parent id where
applicable and full-row PostgreSQL SHA256; combined bound is 5000. Both source
and target invoice lookup finds the credit's actual application lineage. These
children must compose with the root's current invoice/payment/profile/merge
witnesses before acceptance.

`invoicing.creditNoteDisposition({creditNoteId})` is a private typed query,
also available as `creditNoteDisposition(tx, id)`. It acquires no new advisory
locks. RMA notes return `reservedForReturns=true`, `appliedMinor=0`,
`reservedMinor=whole note total`, `availableMinor=0`, `reviewRequired=false`
before reading the new application tables. This is an absolute transfer
refusal, never a substitute for the exact frozen return allocation. Mutations
lock original payments, then invoices, then notes, with ids sorted, and do not
subsequently acquire an order row. Commerce's independent partial-return
source uses this contract.

## Required continuation, not a deferral

Root's implementation decision is gross dated debit plus exact old-tax credit,
locked exclusively to its accepted target in the same transaction. New full
consideration alone switches access. A lower-price change can expose a residual
credit only after the actual switch; unsettled old paid access cannot coexist
with transferable credit. Expired effective instants require fresh reviewed
consent, retaining actual partial cash, fee duties and the whole issued credit
promise. There is no backdated access, automatic refund or gap billing.

The actual mid-cycle quote/accept/invoice writer, exclusive-credit state
binding, trial/manual/card/provider variants, recovery and canonical applied
price/calendar integration remain implementation work. Provider continuation
must implement the authorized zero-only birth-safe bootstrap before actual
`keep_as_draft` readback; only then can separately admitted positive phases be
created. Collection pause is active calendar/draft generation, never true
financial stop, erasure or cancellation proof. Every preview/update/fixed-fee/
finalize/pay physical caller and original GET needs authentic admission,
finish/stop recovery, immutable current revisions and raw cash retained before
auxiliary failure. Frozen future-only DTOs must not be weakened.

Prepared controls: nine named pure original-fee cases and one actual shared
offline-recording native journey (partial payment, old access, exact full
payment, fee debt/remittance, full actual external refund, wrong receipt owner,
actual original fee return, no fake provider routes/observations, immutable
old terms). All are **UNRUN**. Native/provider/SQL, clean-room and independent
acceptance remain required; the source controls supply no passing evidence.
