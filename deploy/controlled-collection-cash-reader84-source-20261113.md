<!-- Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0 -->

C12.38/C9.33/C1.08 finite actual bank-reader implementation, SOURCE ONLY.
No compiler/lint/test/native/PG/provider-account I/O ran in this lane. Ten new
reader controls and the prior ten DTO controls remain PREPARED/UNRUN. No money
application/query/SQL producer is activated, and this is not full feature closure.

`readControlledCollectionCashAuthority(real ServiceContext,{collectionId,receiptIds})`
now implements the frozen 26c1 exact batch ABI. It is ordinary/unregistered, uses
actual ctx.tx / shared fee services, verifies the held contact/resource prefix,
and requires the caller's existing resource→parent→canonical lock order. It then
locks ALL exact target original namespaces in sorted order. No ServiceContext is
fabricated, no SDK call occurs, no receipt/financial row is inserted or updated.
The old paid-only prototype was preserved separately in /tmp before replacement.

The implementation reads the actual accepted target, issued canonical invoice,
whole issued original credit promise including zero-applied credit/lines, dated
tax, actual credit funding/reservations/applications and frozen fee duty/assignment
rows. `feeDutyId` is its actual primary key invoiceId, NOT an invented id column.
It preserves merge-stable accepted commercial identity while FULL current parent
PG-row fingerprints continue to bind actual contacts and all mutable projections.
No paidMinor is incremented to represent credit or a planned receipt.

The actual finished `read_manifest` operation/call/result/proof must bind the exact
accepted manifest and canonical target. A later admitted bank-mutating controlled
operation requires another genuine complete manifest. Other finished observation
GETs may coexist; they cannot close an unfinished original caller. Complete actual
invoice/PI/payment inventory must conserve bank paid+remaining==accepted cash due,
with no customer wallet/credit-note funding. Open partially paid invoices remain
open with honest unpaid remainder. Every positive real PI maps to its exact one
canonical receipt and authentic original origin/observation; current zero/pending
or over/under/foreign resources are retained and refused where not representable.
All unapplied positive receipts in this target must be explicit in the batch;
existing canonical receipts require their real immutable payment/route FKs.

For EACH real positive receipt (including already applied originals), the reader:

- Authenticates exact source via readControlledCashObservationSource and all
  original signed controlled admissions/actual finish or independent stop.
- Selects actual latest genuine namespace order with
  latestControlledCashInspectionLineage, authenticating HMACs, original PG admission
  fingerprints and all actual prior caller closure. No timestamp/txid order or
  opaque historical full-parent equality supplies bank eligibility.
- Calls genuine SQL freeholder_controlled_receipt_bank_observation(collection,receipt)
  from Commerce d598 +8bc30fa1 additive selector. Requires its exact selected
  inspection and FULL actual lineage PG entry; missing/unassembled dependency
  mechanically refuses. The SQL tuple retains immutable_bank_fingerprint separately
  from bank_fingerprint of the ENTIRE CURRENT original namespace.
- Cross-checks the neutral actual same-caller RETURNED inspection, contiguous latest
  complete bank state, primary/refund/dispute facts and exact original PI/charge/
  amount/currency using originalCashInspectionBankFacts. No stop is bank evidence.
- Reads and authenticates original-cash owners/facts/feedback and checks actual
  unfinished refund/recovery/inspection protocols. Unknown callers are never
  dropped, superseded by newer reads, converted into a finish, or hidden by a reason.
- Uses genuine SQL freeholder_controlled_bank_unreturned plus Commerce's EXACT
  unchanged frozen controlledCashBankApplicationEvidence policy leaf from cba/3b.
  Customer/merchant/fee/recipient settlement flags derive from actual proved facts;
  neutral primary flags are not coerced. Unknown/refunded/disputed/mismatched funds
  remain independently retained negative evidence and refuse application proof.

Fee plans use existing invoiceCashFeeAllocation against actual canonical prior
cash and its actual original fee allocation, then exact sorted earlier candidate
receipts. Expected obligations, planned allocations and actual bank collection are
separate. Already canonical routes retain original fee epochs. A provider partial
or multi-PI fee disposition differing from that frozen cumulative policy remains
explicit retained/review debt; this checkpoint does NOT invent a collected fee,
waive a source obligation, silently change the policy, or claim all such recovery
implemented. Honest complete representation of those cases remains required.

The reader returns FULL actual PG-row hashes from every bank namespace with
explicit postgres_row domain, rejecting contradictory duplicate rows under ONE
bank-witness5000 bound. Parent must independently compose the WHOLE current
canonical/source/credit/fee/privacy/caller graph under its aggregate5000 bound.
Canonical creditRevision, feeRevision and preApplicationRevision bind actual
current projections and all real bank namespace/origin/fee-plan revisions. Exact
positive occurrence associations cover structured PI/invoice/payment/subscription
read ancestry. Mixed list atoms are NEVER cleared by a fact-ID allowance; all
rawReviewFactIds and noncandidate occurrences remain visible for parent evaluation.

All supplies*Authority flags remain false. The parent private prospective authority
owns current capacity/credit/refund/dispute/privacy/debt eligibility, genuine
prewrite/batch staging and exact actual own-canonical deltas. It must recheck the
source and full current namespace immediately before money mutation with actual
callback-ingress SQL fences. An intermediate created own payment correctly makes
this strict fresh reader refuse; only authenticated exact staged delta semantics
may account for it, never a cached scalar grant or ignored pending row. Payment
application is MONEY ONLY. Terms/period/proration/access effects run after canonical
money commits in a separate genuine shared transaction.

No existing default principal/refund/current reader, parent financial file,
public/private service inventory, old SQL fragment, normal journal or historical
provider DTO is changed. Required remaining implementation includes parent
prospective/staged guards and genuine routing, full positive public period/change
factories and NET/tax/credit/fee/finalize/pay orchestration, genuine paid effects,
terminal alternative collection disposition, durable unapplied manual receipts,
all actual controlled batch/race/rollback/partial/fee native qualification and real
provider/hosting acceptance/independent review. No C-item/stable gate is closed or
deferred by this finite source checkpoint.
