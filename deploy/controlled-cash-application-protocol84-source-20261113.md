<!-- Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0 -->
# Controlled cash application admission source checkpoint

C12.38/C1.08/C9.33/C9.38. SOURCE ONLY. No parser, model import, compiler,
lint, test, migration, native journey, provider or database was executed here.
All prepared controls are UNRUN. This checkpoint supplies no payment/access
capability, registration, activation, stable completion or provider sign-off.

The branch normally carries the genuine frozen bank reader `b3c48ca6` and its
immutable/current PG hash contract. Existing bank/order/route/settlement guards,
current journals, published SQL and the root four financial readers are unchanged.

Three new immutable financial models retain one exact parent/bank preimage,
individual real receipt admissions and lifetime receipt-to-actual-payment links.
The NEW UNAPPLIED `controlled-cash-application-protocol84.fragment.sql` adds:

- Actual FK closure through the subscription/invoice/source-credit/payment/
  receipt/refund/fee/controlled/proration/card/privacy graph, with complete
  PostgreSQL row SHA and a single running5000 bound. It does not adopt a current
  account, equal amount, email or shared profile. Quote subscription identity
  comes from its actual resource FK; no nonexistent quote subscription column.
- Independent full PG preimage comparison before first mutation. Only the exact
  newborn batch/receipt admission rows are removed for this comparison. New
  raw callbacks, source credit changes, caller admissions, stops and lineage
  remain current evidence and invalidate a changed preimage.
- Exact complete bank invoice/payment/PI/cash identity and conservation. Every
  positive is either a genuine existing canonical route or an explicitly pending
  receipt UUID. Partial bank cash preserves the unpaid canonical remainder;
  unknown, under-proved or excess amounts are retained review, never clipped.
- Actual held contact/resource lock-prefix checks, same original transaction
  binding, complete accepted collection/invoice identity, immutable before-row
  SHA, exact original credit/fee cumulative targets and deterministic residuals.
  Transaction IDs bind own writes only; the frozen admission lineage orders bank
  observations, never transaction timestamps or UUID order.
- Per-receipt actual origin operation/call/fact, all original observation UUIDs,
  actual returned inspection/state/finish and independent immutable-bank/current-
  namespace SHA. The settlement date is the genuine bank observation date using
  the existing shared JavaScript Date millisecond precision; original before-row
  timestamps are retained as full PostgreSQL strings for exact reconstruction.
- A real payments AFTER INSERT boundary captures the generated payment UUID and
  full initial PG row SHA. Receipt and payment lifetime uniqueness cannot be
  replaced by a supplied UUID, session flag or equal-value historical payment.
- Real invoice and created-to-processing-to-settled payment normalization checks
  preserve every other live row field and exact original full-row hash.

The pure admission consistency helper consumes the frozen strict bank DTO and
full actual PG snapshot. It preserves every unresolved raw association and
caller, checks fee prefix/cash/credit conservation, and returns authority flags
false. It does not authenticate a caller, clear debt or sign a permission grant.

## Exact integration contract

`controlledCashApplicationWitnesses(tx,{subscriptionIds?,invoiceIds?,receiptIds?,profileId?})`
returns `version:1,entries,incomplete:false`. Each entry has its actual table,
UUID, PostgreSQL full-row SHA and actual batch/collection/quote/subscription/
invoice/profile-version/receipt/payment parents. Profile is a restriction of
already exact parents; a profile-only selector refuses. Current invoice/seller
subgraphs must be derived through real original ownership before calling it.
The helper verifies retained HMAC envelopes and refuses corrupt or incomplete
owned rows instead of dropping them through joins.

Root composition must fold the three families into its existing full financial
history/fingerprints before no-payment/no-route exits and the combined5000 budget:

| Table | Actual evidence identity | Parent selection |
| --- | --- | --- |
| controlled_cash_application_batches | id | exact subscription/invoice, or its real receipt admission |
| controlled_cash_application_receipts | id | batch_id and actual receipt_id |
| controlled_cash_application_links | receipt_id | exact batch/receipt proof and actual unique payment_id |

All three have explicit private search/noTTL metadata. No contact pointer is
introduced. `exportControlledCashApplicationHistory(tx,scope,{merchant,existingRows})`
uses the same exact selection, combined count and explicit safe whitelists.
Merchant mode includes actual admitted commission; buyer mode omits commission.
Neither mode emits beforeEntries, raw bindings, bank bodies, signatures/nonces,
process/hosting/queue data or transaction markers. Full internal SHA remains.

## Required continuation, actively incomplete

This is a finite first-write admission foundation. It deliberately refuses a
subsequent receipt birth until the actual earlier canonical delta is completely
proved. The existing closed application/route/period guards are not replaced.
There is no service registration or first-payment activation.

The next required implementation is full CURRENT parent normalization across
actual routes, observations, original fee assignments, plans/allocations and
state events; immutable prewrite context with exact per-stage current checks;
deferred whole-batch conservation; actual alternate writer route/settlement
branches preserving every old predicate; and real same-transaction batch writer
consumption. Nothing may compare an old whole namespace digest after its own
canonical mutation or silently erase a new external raw occurrence. Paid effects
remain a separate transaction after actual committed canonical money.

The genuine producer is now present, but the full parent prospective money/
privacy/debt/current-caller evaluator and typed retained-unapplied occurrence
context remain required before any application authority can register. Current
strict no-context principal/recovery paths stay unchanged; an unapplied receipt
never becomes principalSafe or a fake canonical payment.

Sixteen new pure policy cases and five source-integrity controls are prepared
and UNRUN. Required actual native controls include before-first-write callback
invalidation, actual receipt/payment lifetime duplicate refusal, late receipt
rollback, complete batch/fee/credit/plan conservation, multiple genuine partial
PIs without paid effects, overage retention and unchanged old default paths.
They need the complete genuine producer/parent/staged writer fixture; no fake
ServiceContext, hand-inserted money or invented returned bank proof is supplied.

Source review follow-up: the PLpgSQL cumulative-prefix loop record is named
`receipt_record`, distinct from each SQL `receipt_proof` table alias. Only that
local name changed; predicates, models and all original source evidence remain.
The extra source regression is prepared/UNRUN. No parser/database was executed.
