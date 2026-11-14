<!-- Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0 -->

C12.38/C1.08/C9.33 source checkpoint, based on signed `241a096e`. SOURCE ONLY:
no type/lint/test/native/database/provider-account command has run in this lane.
The owned SQL is UNAPPLIED, not a normal migration or a release claim.

One new model `subscription_controlled_cash_inspection_lineages` adds truthful
admission order to actual controlled receipt-owned original cash reads. Existing
inspection IDs, nonce hashes, original sourceHistoryDigest, outcomes, NULL finishes,
independent stop semantics and current owner stop UI are unchanged. There is no
contact column: ownership follows actual inspection → canonical receipt / actual
agreement route → original subscription / frozen merchant profile. Merge retains
those original UUIDs. A missing actual alias in a known controlled namespace
refuses; an equal amount never chooses a receipt.

The actual same-TX admission hook uses the existing `subscription-cash:` namespace
lock and private original holder. It reserves one real PostgreSQL sequence value
under that lock, signs the actual original admission/caller, predecessor signed
body digest and complete closed history of ALL prior namespace admissions,
finishes and independently authenticated stops. Prior legacy inspections remain
an unordered actual closed set. There is no backfill. Missing/in-progress/foreign
closure refuses a new lineage. Lineage does not make an inspection RETURNED and
never supplies bank, principal, application or access authority.

SQL inventory in `subscription-controlled-cash-inspection-lineage84.fragment.sql`:

- Sequence `controlled_cash_read_admission_seq`: bigint, min1, max9007199254740991,
  no cycle, owned by the sole child's admission_sequence. Gaps after rollback
  are allowed; ordering never derives from timestamps, transaction age or txid.
- One table, five explicit indexes (global unique sequence, per-namespace unique
  predecessor, unique first root, receipt, resource), restrictive inspection,
  resource, receipt and self-predecessor FKs, four check constraints.
- `freeholder_controlled_cash_read_history`: actual PG-row closure fingerprint,
  exact UUID set, complete bounded closure; no money/observation removal.
- `freeholder_controlled_cash_lineage_writer`: BEFORE INSERT/UPDATE/DELETE,
  insert-only; actual original namespace/source/caller/fingerprint, real sequence,
  predecessor and complete closed history, no existing callback/finish/stop.
  Original row xmin equals current transaction's low32 XID solely to forbid
  retrospective annotation; XID is NEVER used as read order.
- `freeholder_controlled_cash_admission_lineage`: AFTER INSERT on the original
  inspection, DEFERRABLE INITIALLY DEFERRED; every NEW known controlled namespace
  admission requires its genuine same-TX child. Old-runtime omissions refuse.
  Old historical rows are unchanged.
- `freeholder_controlled_cash_read_latest`: mechanical latest actual sequence
  selector; exact complete prior closure set/chain, actual same-caller RETURNED
  finish and no stop. A newer thrown/stopped/live or unsequenced read refuses
  application of older bank evidence. No timestamp sorting/fallback.

Ordinary collector-free ABI in `controlled-cash-inspection-lineage.ts`:

- `retainControlledCashInspectionLineage(realCtx,{inspectionId,completionNonce})`
  runs only at actual birth, before physical GET. Noncontrolled legacy reads keep
  their existing semantics. Known controlled missing ancestry refuses.
- `latestControlledCashInspectionLineage(tx,receiptId)` authenticates HMACs,
  original source and full actual closure graph; returns original admission,
  lineage and full caller closure evidence with authority flags false.
- `controlledCashInspectionLineageWitness(tx,{paymentIds?,receiptIds?,resourceIds?})`
  returns exact child rows/admissions and entries
  `{table,id,inspectionId,receiptId,resourceId,fingerprint}` with FULL PostgreSQL
  to_jsonb-row SHA. Parents must compose with every other family under ONE5000
  bound, retain all raw/current money/caller facts, and independently prove
  original receipt ancestry. No email/current-account/amount discovery.
- Safe private export exposes inspectionId, receiptId, recordedAt, lineageRetained
  and suppliesPaymentAuthority:false only. No global sequence, private namespace,
  nonce/process identity/hash/signature or predecessor metadata leaks.
- New existing-outbox pointer `controlled_cash_lineage` revalidates signed actual
  child/admission and resolves original merchant profile through the existing
  receipt/payment spine. No external/public service or audit input is added.

Parent owns central composition in merchant-refund-dependencies.ts,
merchant-payment-dependencies.ts, merchant-tax-privacy.ts and subscriptions/service.ts
including exact buyer/merchant exports, retention, merge/undo financial revisions
and total5000. These remain REQUIRED before integration qualification. Commerce
reserved this full-PG family in future parent staging. The actual future e3
controlled observation prepare service must call the same birth retainer before
its physical GET; this current-family leaf cannot import those unqualified six
models. Genuine d598 future bank SQL must use the new selector, authenticate full
bank evidence separately and retain independent FULL CURRENT parent/batch proof.
Other original provider/refund/recovery protocols and their unknown callers/raw
facts stay debt in that proof; this ordering child does not supersede them.

Prepared and UNRUN: twelve signature/order/SQL controls and one actual unchanged
ordinary legacy GET regression. Positive controlled cross-receipt/batch and the
transaction-A-starts-early / admits-after-B race still require actual future
producer integration and genuine model/native qualification; they are not claimed
by these controls. Full NET/gross tax/credit/fee/finalize/pay orchestration,
prospective batch application/SQL/controlled routing, paid effects, terminal
alternative disposition and durable unapplied manual receipts remain required.
No C-item/stable/live provider acceptance is closed.

Witness source correction: the collector-free selector also compares every signed
admissionFingerprint against the actual PostgreSQL to_jsonb admission-row SHA,
just as the latest inventory reader does. Canonical JavaScript admissionDigest
remains separately authenticated; it never substitutes for the PostgreSQL hash
or silently drops timestamp precision. No oracle or qualification claim changes.


Parent integration SOURCE checkpoint (2026-11-14 UTC): owned84 is copied byte
for byte to normal0084_controlled_cash_inspection_lineages.sql, journal index84
at1793310000064. All previous84 journal/file identities remain unchanged. No
database has been migrated or cloned. Central four financial/export readers
now compose an ordinary collector-free wrapper: exact original payment/receipt
and owned controlled resource FKs, independently authenticated child/admission
PG hashes, shared parent admissions counted once and each stop/lineage counted
separately under one5000 bound. Invoice buyer history covers receipt-only
controlled resources BEFORE a payment-route exit, and retains their complete
current refund/callback graph separately from immutable read order; seller
filters never widen to a whole shared invoice. Merchant profile merge inherits
exact child PG entries. Merchant/invoice/buyer exports add only nonempty safe
lineage projections, never sequence, namespace, process, nonce, HMAC or raw
bank callbacks. Subscription ownership is checked against actual owned receipt
UUIDs and its privacy/retention table inventory declares the new child.
Source/model/native qualification remains pending, including future genuine
controlled producer and positive ordering/application native cases.
