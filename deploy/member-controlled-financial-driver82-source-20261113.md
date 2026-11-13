<!-- Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0 -->
# Original merchant identity read driver — source correction 2026-11-13

C12.38/C1.08. Test-only isolated descendant of root86e5d410. Root source v6
passed full types and affected21-file lint, then its NoDB contract run stopped
after34 passes/47 explicit DB skips at the first old empty-history control:
the synthetic read driver rejected the real subscription_controlled_resources
selector. The original contracts JSON/log and first failure remain preserved.
No product/schema/permission/financial predicate changes are made here.

Read-only source inspection confirms policy snapshots supply exact immutable
subscription IDs; the real controlled resource SELECT joins its original
terms_id to subscription_commercial_terms.id and projects the frozen accepted
profile/version plus full PostgreSQL row SHA. The correction recognizes only
that exact known resource SELECT, asserts its fields/terms join/subscription
selector/bound/hash and refuses contact/current-profile/account/amount adoption.
An empty resource root mechanically issues no child SELECTs: all nine families
are empty, rather than a blanket empty response for arbitrary controlled tables.
Unknown parent SELECTs still throw; the added control explicitly proves this.

Existing routed order fixtures now state their actual allocationId explicitly.
The driver distinguishes the existing paymentId projection from the newly used
id projection without guessing a route owner by array order or amount. Only the
real bounded four-union controlled ancestry query can return its known empty
agreement-alias set: exact allowed physical parent list, platform/account/PI,
actual event/target FKs and original canonical source identity are asserted.
Unexpected raw/parent tables still fail, with no broad default or catch.

All14 previous empty/cashless/foreign-platform/ancestry/UUID/full-fingerprint/
aggregate-bound assertions remain. Dependency expectations retain exactly the
same invoice/payment/count values and now explicitly require the compatible
fifth argument to be the empty controlled-witness array. Expected SELECT traces
include only the additional exact per-allocation or frozen-subscription reads.
One new control covers all nine empty families, exact resource-only execution,
foreign subscription refusal and unknown parent-table refusal:15 controls on
the corrected source remain PREPARED/UNRUN.

No compiler/lint/test/runtime import/PG/native/provider operation ran in this
worktree. Whitespace was inspected only. Root owns renewal and qualification;
MASTER §43 stays authoritative and no feature/stable/security gate closes.
