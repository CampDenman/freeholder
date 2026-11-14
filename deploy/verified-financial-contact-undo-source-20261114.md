<!-- Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0 -->
# Verify financial merge snapshots before undo writes

C1.08/C12.38. SOURCE ONLY from3ec20dde. No compiler, lint, tests, PostgreSQL,
SDK, provider or host execution in this lane. No migration, schema, SQL function,
service registration, permission, public input or payment authority changes.

The root's actual cartless V39 paid-period journey reached merge and then
refused undo at the complete subscription money fingerprint. Its genuine
read-only framework diagnostic found current evidence EXACTLY equal to the
stored merged graph:370/370 ordered entries, no differing index, with all595
public-table hashes,86 journals and sequence unchanged. The original undo then
restored contacts and earlier references BEFORE checking the subscription
snapshot. Its own inverse writes invalidated the fully merged graph it was
trying to verify. That actual failed state remains preserved by root.

`ContactReference` now has optional `lockForUndo` and `prepareUndo` hooks. Undo
resolves every stored reference before writes, invokes each distinct shared
lock-provider function once, then collects every prepared inverse. Only after
all preparations succeed does it restore the contacts and run inverses in the
same original registration order and same genuine transaction. Existing
references without a preparer retain their original restore call. There is no
serialized closure, caller-supplied flag, marker, cached financial authority or
different business service.

Subscription and invoice pointer references move the COMPLETE existing
comparison into their preparer, including every fingerprint, ordered evidence,
overflow, historical-snapshot refusal and original error. Their closure contains
only the same actual moved-ID inverse. Direct `restoreAfterUndo` still acquires
the genuine locks and calls prepare+invoke, so it cannot bypass verification.
No contact/updatedAt/financial row is normalized out. The manifest retains both
entire old restore bodies; source controls reconstruct each from its new
verification and inverse with only indentation/blank-line normalization. The
exact source patch reverses all three original files to their base hashes.

The shared ordinary lock provider reads BOTH contacts' whole reachable actual
FK graph: subscription/event invoices, controlled resources/targets, real
canonical payments/credit notes, original charge receipts/agreement routes,
proration original/debit/credit/principal links and original credit funding,
reservation and application lineage. Pending target reservations require the
actual debit-invoice FK AND exact existing canonical source, not a source label
alone. Receipt/payment aliases use the original full platform/account/PI tuple,
never equal amounts or today's merchant account. Scope nodes, original cash
namespaces and actual inspection IDs share ONE5000 bound. These identities
select locks only; they confer no payment, credit or access authority.

Lock order is actual exclusive contact identity → ALL controlled resource
advisory/row locks → ALL subscription parent row locks → sorted payment keys →
sorted invoice keys → sorted credit-note keys → sorted original cash namespaces.
Discovery is repeated under those locks. Any newly discovered edge, namespace
or inspection is refusal, never a later acquisition of an earlier lock category.

Exact callback fencing:

* Ordinary controlled runtime, original receipt retention, cash inspection
  admission/application and original returned-money finalization use the actual
  shared contact-identity prefix and cannot cross exclusive undo cutover.
* `merchant-cash-inspection-holder.ts:cashInspectionHolder` serializes actual
  state and returned-finish callbacks on `merchant-return-read:<inspectionId>`.
  The lock provider acquires each actual owned inspection key with
  `pg_try_advisory_xact_lock`; busy callbacks cause immediate refusal. It NEVER
  waits cash→read: refund observation capture can already hold read→cash.
* `merchant-refund-observations.ts:recordMerchantRefundObservation` takes the
  same inspection key; the actual SQL `freeholder_refund_capture_lock` in the
  unchanged refund-current-state fragment fences the exact original owning cash
  namespace even for foreign/NULL claimed PI facts.
* Independently committed signed legacy feedback is fenced by the existing
  `freeholder_guard_legacy_bank_feedback` payment/original-cash namespace locks.
  The new provider takes all original receipt, actual merchant observation,
  refund-request and original recovery-owner namespaces. Raw feedback still
  commits before subsequent policy/application; no ingress fact is suppressed.

The original full paid-period native file is byte-identical, including actual
retirement/merge/undo timestamps and row-XID assertions. Four NEW real desired
journeys are prepared: clean undo; actual later fresh financial GET refusal;
actual later external refund plus real returned bank inspection refusal; and
an injected failure AFTER the actual grant inverse, proving every actual public
table rolls back. These construct real cartless catalogue/agreement/accepted
target, provider fixture GETs, retained cash, private writer and independent
paid effect. They do not insert money/proofs, fabricate a context, mock a guard
or change a native oracle. Six focused source controls are also PREPARED/UNRUN.

Scope remains explicit: existing entitlement grant undo stores moved UUIDs and
repoints ownership, preserving all current nonguarded grant fields. This change
does not invent a historical full grant-used snapshot, change quota policy,
freeze false updatedAt values or claim foreign-used-change refusal. No original
cart undo policy, stable/C-item/provider acceptance or proration completion is
closed. Root must qualify source and rerun genuine native controls before any
acceptance claim. The separate proration effect WIP remains preserved.
