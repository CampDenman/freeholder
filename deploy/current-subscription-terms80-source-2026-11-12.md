<!-- Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0 -->
# Current subscription commercial source (C9.38/C12.38/C1.08)

This isolated composition starts at current financial checkpoint `425642af`
and replays only the eleven owned commercial, phase, exemption and buyer-cohort
commits through `ddee2f75`. There were no cherry-pick conflicts or older whole-file
replacements. The earlier components have their own separate source evidence;
this new current-source composition is not qualified by transferring those passes.

The accepted-terms table is now registered in the actual subscription module,
with explicit private-search and no-TTL retention decisions. The seller's exact
frozen profile selects bounded accepted-term child fingerprints for contact merge
undo, including when no payment exists. PostgreSQL computes those row digests so
private accepted destinations/notices do not enter a merge witness. The buyer's
original agreement witness already retains the exact accepted-term rows.

The existing profile-version/registration/exemption child subqueries also now
retain their explicit outer table identity. An actual ORM query-generation
probe showed that a bare outer Column in a single-table SELECT renders as the
inner child's unqualified id; Table/identifier SQL chunks preserve the intended
profile correlation. This establishes the rendering behavior, not a native
business before/after proof. Actual original/foreign-profile undo controls remain
required on the new complete schema.

The owned commercial-terms fragment is appended once after unchanged SQL958.
New unpublished80 SHA256 is
`881a7901abf41dc612081df422d6623370e0a68150421f61cc13e96664c43f7d`.
The complete previous SQL958 is an exact byte prefix; all published0–79 SQL and
the81-entry journal are unchanged. Every earlier database is preserved. This
candidate requires a NEW named database; no old fixture/schema is migrated in
place. Initial model/native/source qualification is still pending.

Provider phase admission remains false. Actual amendments, complete paid invoice
and returned-cash inventory, composed money-erasure finishing, browser/SDK/provider
acceptance and full C12.38 remain open. This is not stable or launch sign-off.

## Actual current-source database and buyer erasure qualification

The composed current source at `81e42159` includes the real money-finisher
implementation and the four actual buyer journeys. Full Node22 types and
whole-project lint passed for the terms composition; all44 source-contract files
passed384 assertions with26 declared database skips. The composed finisher
passed fresh types, twelve-file lint, the same384 source assertions and40
focused assertions, plus metadata and actual616-note generation. The added
four-case fixture separately passed types and focused lint.

A NEW `freeholder_collection80_normal_v10_terms_test_20261112` database passed
ordinary0–80 migration in5.753s. Actual Drizzle/SQL parity passed for both
retention models and subscription_commercial_terms: columns, types, defaults,
nullability, PKs, FK delete actions, checks and indexes. Existing financial and
retention tables/guards remained present, with81 journal entries and the exact
SQL881a hash. PostgreSQL retained fsync=on, jit=off and recovery=false.

Four original60-second, bail=1 native cases then ran separately without retries:

| Actual buyer journey | Duration | Result |
|---|---:|---|
| Cancellation caller paused, then original queued jobs converge |6.354s|PASS|
| Current hold before money finisher, then actual release |5.946s|PASS|
| Parseable corrupt original artifact |5.748s|PASS: recovery, no customer I/O/minimization|
| New hold after money completion but before customer DELETE |5.700s|PASS: DELETE refused until release|

These use the actual shared services, real queued getJob payloads/IDs and actual
registered job bodies; the provider factory reaches an intercepted HTTP edge
outside the business transaction. The buyer differs from the seller. Setup
explicitly records a synthetic prior-create journal: it does not prove a new
provider creation, accepted-terms signup or an actual provider account. Each
command selects one case; the other three filtered cases are not extra coverage.

Independent per-case database readbacks show both scopes erased/pending0 and
methods/customers0 after convergence, with the original resource quiesced,
cohort completed and seller profile active. The stored agreement remains active
with local cancellation/access flags; remote stop proof comes from the original
resource, not this local status. Corruption instead leaves both scopes pending1,
credentials/resource intact and the original artifact body/checksum preserved.
Every case kept the81-entry journal and drained all database clients before the
next fixture reset. Reports, per-case ledgers and diagnostic logs are preserved
under `/tmp/freeholder-current-buyer-money-v10-*` and
`/tmp/freeholder-collection80-normal-diagnostic-v10-terms.*`.

Provider admission remains false. Actual terms/profile merge witnesses, mutable
local-mode and missing original-finisher recovery controls, paid/returned cash,
late positive recovery, amendments, browser/SDK and full provider acceptance
remain required. This targeted result leaves C1.08/C12.38 and stable open.

## Two separate recovery controls: genuine failures preserved

Test-only `885a37f2` adds two controls without changing the four earlier
assertions or their deadlines; a shared seed extraction leaves their behavior
unchanged. Full incremental Node22 types and fixture lint passed. Each new case
ran separately with its original60-second deadline and bail=1 on SQL881a/V10.

The changed-local-mode control genuinely failed in5.805s: the declared restored
local billingMode was manual while the retained original create journal and
provider resource stayed active. Real fulfillment incorrectly marked
subscriptions.agreements erased/pending0 and admitted no agreement cohort; local
methods/customers were already0. commerce.money remained pending1 and the whole
request in_progress. No physical DELETE occurred. This is a defect in this
unreleased source candidate, not evidence of an affected actual provider account.

The missing-finisher control genuinely failed in5.875s. It first completed the
actual original queued workflow, then omitted only the original money queue
payload while preserving its claim/hash and all original financial/cancellation
history. An explicitly declared restored-resource uncertainty and actual repair
admission committed. The real repair worker refused the missing payload, but its
recovery transaction rolled back: request status stayed completed with both
scopes erased/pending0 while the original resource was unknown/recovery_pending
and its cohort pending. Original provider DELETE counts remained1/1; no new cash
or provider event was fabricated.

Before any next fixture reset, each actual failure was independently read and
cloned to its own NEW named database:
`freeholder_buyer_localmode80_populated_before_v10_test_20261112` and
`freeholder_buyer_missing80_populated_before_v10_test_20261112`. Thirteen original
privacy/agreement/provider/credential/queue tables retain exact count and SHA256
goldens, with unchanged81-entry journal and SQL881a hash. All database clients
drained. These snapshots must not be reset or migrated in place. Native JSON,
logs, independent ledgers and clone proofs remain under
`/tmp/freeholder-current-buyer-recovery885-*`. No retry or repair pass is claimed
here; the source repairs and unchanged AFTER controls remain required.

## Actual live-registry SDK generation

At `2d948ae7`, actual `sdk:generate` ran the live registry control and all eight
SDK tests passed in3.26s on V10. The generated18-line delta adds the two real
external quote services, `subscriptions.quoteMembership` and
`subscriptions.quoteNewAgreement`, and their accepted-term input/output shapes.
Full incremental Node22 types passed after generation. The repository deliberately
ignores this generated file in ESLint; that command's ignored-file warning is
not an additional lint pass. A fresh non-UPDATE process then passed all eight
SDK tests in3.24s, checking the new exported service/pageable catalogs against
the actual registry and refusing drift. This is not sixteen unique controls.
Both runs independently drained database clients and preserved the81-entry
journal/SQL881a. Logs and drain readbacks are
`/tmp/freeholder-current-terms80-sdk-*20261112.*`. This closes only this SDK
generation seam, not browser, new provider creation or complete financial
acceptance. The two demonstrated recovery findings above remain open.
