<!-- Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0 -->
# Actual post-payment manifest fixture preparation

C12.38/C9.33/C1.08. This TEST/DOC checkpoint follows root02b44a5c. It changes
no product, protocol, SQL, model, original bank document or service permission.
The source guard in `controlled-provider-collection-cash-manifest.ts` remains
byte-for-byte unchanged.

The original full-application native failed before admission on preserved V26.
Root's independent read-only evidence confirmed retained manifest operations33
and38 had exact manifest/result/canonical-target proof and paid0/total4200.
Actual pay39 was the sole later admitted non-read operation. Operations40–42
performed list/invoice reads; none was a retained post-pay manifest. The strict
application freshness refusal is correct. Evidence remains in
`/tmp/freeholder-current-full86-native-v26-manifest-order-v1-20261113.json`;
root proved all595 table hashes,86 journal entries and sequence unchanged,
with no remaining clients. This source slice never touches that database.

`retainActualControlledManifest84` in
`tests/helpers/actual-controlled-current-manifest84.ts` performs an actual
private read_manifest admission, executes the real HTTP SDK GET and retains
the real returned proof through the shared retention service. It asserts
exactManifest=true and suppliesPaidAuthority=false, unchanged canonical invoice
and payment rows, and no additional bank POST. No proof, payment UUID,
ServiceContext or authority is supplied by the fixture.

The staged application and paid-period fixtures now perform that real read
after public money retention and before independent cash inspection/application.
All original money-only/access, rollback, duplicate/foreign, partial/tiny,
atomic fee and later-effect assertions remain. The anomaly fixture already
performs its own actual current manifest and is unchanged. Producer-only
collection/partial/order fixtures retain their original no-application oracles.

One additional desired native preserves the exact negative: a retained pre-pay
manifest plus genuine pay and cash inspection must refuse without canonical or
core3 changes. It then executes/retains a new actual GET, preserves both old
proofs, performs a fresh cash inspection and applies that same actual receipt
with no second pay POST or bank call in the money transaction.

All new/changed controls are PREPARED/UNRUN in this child. No compiler, lint,
test, parser, SDK, PostgreSQL, provider or host execution occurred here. Root
must renew source gates and run the original native on a fresh ordinary,
strictly verified database. V26 remains a preserved failure. No provider-account
acceptance, paid capability, C-item closure, stable release or announcement
follows from this checkpoint. Atomic-refund cent work remains separately
preserved and unfinished.
