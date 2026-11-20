<!-- Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0 -->
# C5.06 / C11.10: legacy refund caller investigation

The BEFORE product source was actual protected main commit
`a2e503fe6fed3c6c8bbfc3249b5535f939ad6c24`, with unchanged product files.
The isolated fixture uses actual invoice/payment/refund shared services and
pauses only the synthetic provider edge. It attempts local cancellation and
a new-key replacement while the first physical refund promise remains live,
then drains both promises before evaluating capacity and positive-result
application.

The synthetic edge enforces original provider capacity: the first refund is
accepted before its client acknowledgement is paused. Any later request
exceeding the original charge receives `charge_already_refunded`; the fixture
never invents a provider that accepts two full refunds of one charge. The
potential loss is the first true positive after local cancellation, alongside
an unnecessary replacement request.

The initial source hypothesis was qualified by the BEFORE result below.
`submitProviderRefund` commits a created reservation before its provider
await; `cancelRefund` permits created/processing reservations to be cancelled;
new reservations exclude cancelled refunds; `settleRefund` rejects a later
positive answer for a cancelled row. No real provider is contacted.

For this isolated probe only, dependencies explicitly reuse a symlink to
`/tmp/freeholder-invoice-allocations-release-20261111/node_modules` under the
root coordinator's instruction. `package.json`, `pnpm-lock.yaml` and
`pnpm-workspace.yaml` were compared byte-for-byte by SHA256 and all match.
This is not a production build or a new dependency installation. Qualified
runtime acceptance requires the normal 0–79 disposable schema; source 79
refusal against schema 80 is not this refund test.

Explicit Node 22 full 8GB type checking and a final incremental type check
passed. Focused lint passed after annotating a test-only rejection value as
`unknown`. All processes exited zero; no database operation ran in that
source window.

The single native BEFORE then reached its real assertion and failed in
4.785 seconds on the normal79 disposable database. The original caller was
locally cancelled while its positive ACK was paused. A replacement request
reached the provider, which correctly refused it as already refunded. The
first positive could not settle the cancelled original row. The final
synthetic ledger retained:

| Row | State | Money / provider fact |
| --- | --- | --- |
| Original refund | cancelled | 1000; provider reference NULL |
| Replacement refund | failed | 1000; `provider_already_refunded` |
| Successful payment | succeeded | paid 1000; refunded 0 |

No provider over-refund was invented: the edge accepted exactly the first
1000, then rejected the excess replacement. Both actual caller promises
were released and awaited before the assertion. The runner exited one and
the final database active-backend query returned `[]`. Product source,
schema, deadlines and PostgreSQL durability settings were unchanged.

The first attempted command was refused by sandbox networking with EPERM
before any test/database operation. Its zero-test report is preserved;
the identical escalated actual run produced the assertion above.

Evidence remains in `/tmp/freeholder-legacy-refund-caller-before-native-actual.json`,
`/tmp/freeholder-legacy-refund-caller-before-native-actual.log`,
`/tmp/freeholder-legacy-refund-caller-before-ledger.json`, and
`/tmp/freeholder-legacy-refund-caller-before-drain.json`.
The narrow protected repair and its AFTER acceptance remain open.

The isolated repair source uses the existing financial state-event journal,
with no new schema. Current creation writes a server-generated marker bound
to the refund ID and request hash. Every hosted or POS provider call first
consumes that authority in an atomic processing claim. Old unmarked rows
remain unknown; current prepared return reservations keep their evidence.

Actual promise completion is captured before an independent result phase;
only then is the ledger projection attempted. Unknown throws retain their
reservation, including already-refunded and in-use errors. A retained known
answer can replay logical application without another provider POST. Pending
resources retain their original reference. A later authenticated exact
terminal failure can release a finished pending caller; it cannot stand in
for a still-live caller. Previously succeeded refunds that later fail at a
bank remain a separate unresolved reconciliation capability.

The journal is not claimed to be database append-only. Purpose-derived HMAC
authentication uses existing configured `CREDENTIAL_KEY`,
`CREDENTIAL_KEY_PREVIOUS` and the already-required `SESSION_SECRET` fallback;
there is no new launch secret, generated/default key or unkeyed historical
fallback. Authentication proves the server receipt, not provider quiescence.
Missing or altered authority stays review debt. Actual completed positive
facts are retained with their captured original capability even if a journal
row is corrupt; altered refund/payment bindings cannot receive application.
The signed original scope contains financial IDs, money and digests, not a
second copy of the buyer's contact or refund reason. Ordinary erasure clears
personal invoice/payment/refund fields without deleting this journal.

The initial repair had ten drafted controls; its subsequent source and native
qualification is recorded below. No protected release is claimed here.

On source `4c369f9ef4c64d95725fd3bc0815a2ab7c0f5237`, explicit Node 22 full
8GB type checking and final incremental type checking passed. Changed-file
lint passed after one POS observation-schema import was made type-only;
private/audit controls passed 12/12. Source review confirmed invoice bundles
and customer money exports exclude state-event journal rows; audit output
stores filtered inputs and never the private phase's returned capability.

The ORIGINAL unchanged live-caller fixture then passed in 4.799 seconds on
the disposable normal79 schema. Its assertions prove cancellation/replacement
refusal and one actual POST. Independent read-only ledger evidence shows one
original refund succeeded for 1000 CAD at `re_OriginalLive`, the payment's
refunded amount is 1000, no replacement refund row exists, and exactly one
admission plus one finished actual success observation was retained. Runner
exit was zero and final active database backends were `[]`.
Evidence: `/tmp/freeholder-legacy-refund-c0-original-after.json`,
`/tmp/freeholder-legacy-refund-c0-original-after.log`, and
`/tmp/freeholder-legacy-refund-c0-original-after-ledger.json`.
At that checkpoint, the ten broader controls, full protected checks and provider
acceptance remained open. This is a coding-agent proof, not an independent human security
sign-off.

A separate source refinement additionally pins the original parent payment
amount and request hash, chooses only `CREDENTIAL_KEY ?? SESSION_SECRET` for
new signatures (the previous key is verification-only), and allows a private
retry to persist the completed server-held answer after its independent
transaction fails. That retry cannot start another POST or accept different
original request arguments. Process loss still leaves the durable admission
as unknown debt and requires genuine original-provider recovery; the memory
holder is never used as a negative absence witness.

The expanded fourteen drafted native controls include the original ten plus
two parent-field corruption cases, independent persistence failure/retry,
and verification-only previous-key behavior. On exact refinement `8dc54922`,
Node 22 full 8GB types, focused lint and private/audit controls (12/12) passed.
The ORIGINAL unchanged caller also passed in 4.863 seconds. Its independent
ledger retained one admitted/finished actual success, pinned parent amount
1000 and matching original payment hash, refund success 1000 and payment
refunded 1000, no replacement row, and active backends `[]`. The fixture
asserted one POST. Source and schema were unchanged for the run.
Evidence: `/tmp/freeholder-legacy-refund-c0-refined-original-after.json`,
`/tmp/freeholder-legacy-refund-c0-refined-original-after.log`, and
`/tmp/freeholder-legacy-refund-c0-refined-original-after-ledger.json`.
The original 4c proof remains separate; neither result extends acceptance to
the fourteen new fault controls before their later runs below.

A further isolated hardening binds the full immutable refund tuple into the
server-created marker and checks the original input against the stored row
before dispatch. No reason or contact copy is included in that marker. Old
candidate markers lacking these facts are not backfilled or converted. Two
additional drafted controls alter an unsubmitted amount/currency and require
zero provider POSTs plus retained review debt. The expanded sixteen controls
and this hardening's source gates were then pending; prior 4c/8dc proofs are not
extended to the new source.

The final unsubmitted guard accepts only the single authenticated creation
event. Any later history keeps the birth marker consumed, even if a partial
restore reset the row to created and lost its admission event. This does not
change birth validation used to recover a completed result. One additional
drafted control retains an actual positive observation and applied 1000 while
refusing a second POST after that controlled restore fault. The seventeen
controls and this final guard were then frozen for the qualification below.

## Frozen repair qualification

Exact product/test source `878a6e4b64509cb35ff7ebb8a3072ce2ff6cc40e` passed
Node 22 incremental types, focused lint and all 12 private/audit controls.
Full Node 22 types also passed on its parent `6f4f5882`; the only later product
change tightens unsubmitted authority to the single authenticated creation
event. No schema or dependency changed. The original unchanged live-caller
fixture passed again in 4.817 seconds, with one POST, one admitted/finished
original success and 1000 CAD applied. Its actual read-only ledger and final
active-backend check are retained in
`/tmp/freeholder-legacy-refund-c0-birth-original-after-ledger.json`.

All seventeen unique fault controls then passed in three disjoint bounded
groups, with unchanged test deadlines, source and normal79 disposable schema:

| Group | Passed | Actual boundaries |
| --- | --- | --- |
| 1 | 4 | Live/duplicate/human/forged-phase refusal; current prepared reservation; altered unsubmitted amount and currency |
| 2 | 6 | Historical unmarked debt; transport/already-refunded/in-use throws; positive-before-projection replay; independent persistence failure and server-held retry |
| 3 | 7 | Restored-created positive history; corrupt admission; altered parent amount/hash; previous-key verification-only; configured key rotation; authenticated terminal failure after a pending caller finished |

Evidence is `/tmp/freeholder-legacy-refund-c0-group{1,2,3}.json`, corresponding
`.log` files and `-ledger.json` snapshots. Each runner exited zero and each
final active-backend query returned `[]`. Group 2 independently retained one
original succeeded 1000 CAD refund and exactly one created/admitted/finished
receipt before successful projection. Group 3 retained the original pending
resource's signed terminal-failure fact before a new request returned 1000;
the payment's refunded amount was exactly 1000. Skipped controls in one group
are supplied by the other groups, not counted as additional passes.

On test/documentation checkpoint `b2b43feb`, the product remained exactly
`878a6e4b`. Sixteen existing adjacent native controls passed in disjoint groups
of 5/7/4: signed expanded-checkout and original-account refund feedback,
provider cancellation, offline money, cash/Terminal refunds, pending recovery,
prepared mixed returns, unknown returned-item response and scheduled original
seller refunds. All runners exited zero and final active-backend checks were
`[]`. Evidence is `/tmp/freeholder-legacy-refund-c0-adjacent-provider5.json`,
`-adjacent7.json` and `-adjacent-unknown4.json`, with matching logs and ledger
snapshots. Unknown responses retain the original reservation and never cause
a second POST; actual signed terminal evidence can release a finished pending
resource.

For qualification beyond the isolated probe, the verified dependency symlink
was replaced with an own frozen offline installation, scripts disabled.
Package/lock/workspace hashes remained unchanged. Full Node 22 types and whole
lint passed. License, release-note and plan gates passed, as did the playground
policy and all 384 required static assertions (26 declared skips). The first
sandboxed run retained ten subprocess/loopback failures and a missing generated
changelog entry. After generating that entry, only the eight affected files
were retried under escalation: all 63 passed. Successful checks were not
miscounted twice. Logs: `/tmp/freeholder-legacy-refund-c0-full-source-gates.log`,
`-metadata-escalated.log` and `-contract8-escalated.{json,log}`. Normal protected
PR checks remain required; local proofs do not replace that pipeline.

Historical failed/cancelled rows may hide older accepted money; this repair
does not invent negative evidence or reconcile that history automatically.
Later bank failure/return and recipient/fee reconciliation remain separate
unfinished capabilities. A process restart loses only the private completed
answer cache and leaves durable unknown admission debt; full restart recovery
still requires actual original-provider evidence. No real provider acceptance,
deployment, independent security sign-off or stable release is supplied here.

## Composition with unpublished merchant collection 80

The isolated composition retains the existing merchant refund request, physical
caller finish and resource ACK guards. Shared failure/cancellation runs those
guards first; their positive result identifies a handled merchant request. Only
the historical provider route uses the separate authenticated caller journal.
The hosted orchestrator still delegates original merchant routes before legacy
admission, and shared result application preserves the merchant state-machine
checks. No caller input selects or bypasses either authority.

The migration remains byte-identical to qualified v8 (`1ac4652c6e4234cdf07848b244368eca30108b00b3eb54f1eeacfe0f83d4e2c8`).
Base79 caller evidence does not qualify this composition. Source checks, both
unchanged legacy and merchant caller controls, and the affected state-machine
regressions must pass before it is treated as a qualified combined candidate.
No provider acceptance, historical terminal recovery or stable sign-off follows.

### Exact combined-source qualification

Frozen `309a5574` passed full Node22 TypeScript, focused lint and twenty
private/audit/schema/changelog controls (one explicit database skip). On exact
normal v8 SQL `1ac4652c6e4234cdf07848b244368eca30108b00b3eb54f1eeacfe0f83d4e2c8`,
the unchanged legacy caller control passed in 5.298s and the unchanged merchant
caller control in 6.505s. Independent readback asserted the legacy 1000 CAD-cent
refund and payment application with one admission/finish, and the merchant
500 CAD-cent refund/payment application with one original request, ordinal-one
dispatch, returned finish, verified success and physical ACK. Both runners
exited zero and database backends drained. Logs/JSON are preserved at
`/tmp/freeholder-combined-refund-caller80-{legacy,merchant}-native.*`,
`-legacy-ledger-drain.json` and `-merchant-ledger.json`.

This qualifies that frozen composition only. Its common ancestor with protected
main is `eea40ee2`; the current protected REST/ZIP/reader/storage increments
still require full composition before a final candidate claim. The immutable
migration and all earlier candidate artifacts remain preserved.

## Browser qualification diagnosis

At protected PR #694 head `5dff3f92`, all 32 native shards passed. Browser
shard 3 failed the unchanged five-second first group-message assertion twice,
then reached the unchanged thirty-minute job limit with 26 of 62 cases
started. Its duplicated production build consumed fourteen minutes; the
Application gates job had already built and checked the same source in its
own successful ten-minute-fifty-two-second job. The failed runner retained no
downloadable browser diagnostic artifact. The cause of that message failure
remains unknown.

A separate exact-`5dff3f92` production build passed its artifact scrub, then
the original message setup and five-second assertion passed locally: message
visibility/navigation took 873 ms. The probe stopped before any SFU step,
retained only sanitized status/timing/error fields, and drained its browser,
server and all database backends. This local pass does not classify the CI
failure as flaky or close browser qualification. Evidence remains in
`/tmp/freeholder-ci694-group-message-{build.log,probe.json,allowlisted.json,probe-drain.json}`.

The follow-up test/workflow change preserves the original setup, assertion,
case deadline, three complete shards and job deadline. It adds a failure-only
allowlisted JSON report and reuses the same-run Application gates build,
transporting only checked standalone/static/BUILD_ID paths in a checksummed
archive with pinned actions and a second standalone gate after extraction.
Public assets (including checked OpenMLS WASM) and migrations still come from
the same checkout through the existing browser launcher. No `NEXT_PUBLIC`
configuration or `next.config.ts` environment substitution exists in this
source; browser database/LiveKit settings are runtime settings.

Node 22 full types and the focused changed-file lint passed after correcting
an unsafe untyped YAML parse in the new test stanza; its original 38 lint
diagnostics are preserved. The initial two-file run passed all 12 assertions;
the corrected stanza then passed incremental types, its targeted lint and
exactly the five new sanitizer/workflow assertions (seven unchanged assertions
were excluded from that retry). The existing workflow integrity gate passed.
A bounded synthetic archive roundtrip preserved dependency symlinks/native
bytes, excluded environment/source/cache paths and refused a changed checksum.
A read-only audit of the preserved exact-`5dff3f92` standalone found 60 links,
all contained and non-dangling, plus four native runtime files. This does not
claim that the new remote artifact transport or the complete browser shard has
passed. Evidence is `/tmp/freeholder-ci694-followup-{source-test-report.json,source5-retry.json,artifact-transport.json}`
and the corresponding types/lint/workflow logs. The protected pipeline remains
pending; no CI failure has been classified as resolved by the local pass.

The new protected run `43311908611` at PR head `47599dcb` completed all
three archive handoffs and browser shards within their existing budgets.
Browser shards 1 and 2 passed; shard 3 ran all 62 cases in 6.3 minutes,
including a passing original encrypted group/SFU case. Its sole four failing
cases are the four locales of the historical provider-return fixture. That
fixture directly seeds processing refunds and synthetic provider references
without signed caller receipts, then expects a successful submit while they
remain processing. The containment guard instead returns its explicit
already-admitted/reconcile error. All 32 native shards passed again.

The narrow fixture correction requires that exact review error and an open
return/draft credit while any historical installment remains processing.
Only after both original synthetic confirmations may the original final
1000/issued-credit reconciliation assertion pass. It changes no guard, money
expectation or deadline and fabricates no historical caller authority. That
fixture correction passed focused lint and all four production-browser
locales on normal79: EN 7.396s, ES 6.084s, FR 6.756s and AR 6.731s, with zero
skips, retries or unexpected outcomes. Product/public/config/dependency inputs
were verified identical between `5dff3f92` and `47599dcb` before reusing the
preserved `5dff3f92` runtime. Only the corrected fixture was copied outside
`.next`; BUILD_ID and standalone server SHA remained unchanged. The runner
exited zero, port 3176 closed and an actual read-only PostgreSQL query found
no remaining target backends. The missing `psql` command was not a test
failure; the installed postgres-js client completed that same drain query.
Evidence is `/tmp/freeholder-ci694-return-fixture-provenance.json` and
`/tmp/freeholder-ci694-return4-{browser.json,drain.json}`. A fresh normal
protected run remains required; the earlier message failure's cause remains
unknown. Synthetic original-state confirmations do not supply live-provider
acceptance.
