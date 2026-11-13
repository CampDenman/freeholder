<!-- Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0 -->
# Original cash inspection reader and admission fence — 2026-11-13

C12.38/C1.08/C11.10. SOURCE ONLY / UNQUALIFIED. Based directly on root
a7b84404c6ec406d8416db19c99dc8b5b21e6a48. No compiler, lint, build,
installation, test, PG/native/migration or provider-account I/O ran here.
Seven pure caller controls and three real shared-service/Stripe HTTP native
controls are PREPARED/UNRUN. The four existing current cash regression oracles
and their fixture source remain unchanged. No feature, acceptance or stable
gate closes; MASTER §43 remains the status authority.

The current gap is an actual admitted merchant_cash_return_inspections row
whose process never reaches its first callback. Existing history joined primary
and return observations but omitted the bare admission and its finish. Such a
read could disappear from creator closure merely because it had no callback.
The history now inventories every exact original namespace inspection and
matching finish before callbacks exist. A foreign process finish, orphan or
later successful read does not release the original caller. Both returned and
genuinely thrown wrappers close their callers, while only a returned wrapper
can supply complete current bank evidence. Missing completion remains debt.

NEW ordinary modules:

- merchant-cash-inspection-evidence.ts exports cashInspectionSource,
  cashInspectionCallersClosed and cashInspectionEvidence(tx,inspectionId).
  The latter retains all primary/state/refund facts under one combined5000,
  verifies primary/state digests and contiguous original state sequence.
- merchant-cash-inspection-current.ts exports
  currentOriginalCashInspection(realServiceContext,{inspectionId,observationId?}).
  It checks exact original source/namespace/amount/currency, actual matching
  returned finish, every admitted reader, latest complete original charge/
  refund/dispute state and unchanged original source revision. A supplied older
  observation refuses. A later negative refund/dispute snapshot stays visible;
  no older clean snapshot substitutes. Every own refund callback must occur in
  the final actual bank inventory; contradictory late occurrences remain debt.
  The return includes original inspection/source/cash/own evidence/observation/
  finish/history/evidence and a digest revision. It is private ordinary evidence,
  with no payment, return, principal, fee-remittance or access authority.

The function uses a real ServiceContext because original cash/history readers
compose real shared services. It does not fabricate one for a Tx signature,
import service collectors, call provider I/O, create a return intent or invoke
finalizeUnappliedCashReturn. Callers hold the existing appropriate cash locks.

The existing final-return wrapper now consumes this neutral reader and STILL
requires its original logical refund closure, fee-debt checks and strict
merchantReturnedCashProof(...).settled before writing a returned disposition.
No unreturned cash becomes a returned receipt. It retains the same resolution
evidence digest shape and ordinary actual bank callbacks commit independently.

Own inspection rows are absent only from the historical pre-admission BASE
source digest, as their own callbacks already were. Their actual admission,
matching finish and raw evidence remain independently mandatory and enter the
returned current revision and physical bound. Every other read admission and
finish is included. Conditional empty inventory keys preserve the existing
empty/current-family digest behavior. This is explicit original causal ancestry,
not an admitted-reader exclusion or a general revision subtraction. Future
full-15 merges must retain Commerce3f's additive controlledRawResolution digest.

A private system-only preflight authenticates the actual original holder and
refuses a finished admission BEFORE any SDK GET. Local in-flight/failed-finish
fences prevent duplicate physical invocation under one claim. The service is
listed in both literal private inventories and audits only inspectionId.
Actual holder callbacks and finishes serialize on the existing exact read
advisory key, and callbacks refuse after the genuine original finish. This
prevents an old held nonce from rewriting a finished state behind a later read.
The actual raw refund-ingress retention path remains independent and unchanged;
new external facts must be reconciled by a fresh genuine inspection.

No schema, SQL tail, migration journal, existing golden, root central financial
file, future six-model producer, Commerce3f integration, public permission or
return approval policy changes. Root's disjoint46856a12 JSON-key ::text fix
must remain in normal assembly. This checkpoint alone does not supply the
future controlled prospective observation/application contexts or source-money
transition fence. Those require genuine actual receipt/bank proof and separate
parent financial authority, with no fake phase or caller-owned override.

REQUIRED continuation: bare inspections have no independent stop receipt in
the existing current schema. An actually lost process therefore remains debt;
this patch cannot claim that capability is recovered or that fail-closed alone
completes it. A genuine original-process stop/review route must follow without
inventing a finish. Earlier V11 evidence concerned legacy subscription readers
and is not acceptance of these bare cash-return inspections. Full current-family
native regression/fault/recovery and independent security acceptance remain open.
