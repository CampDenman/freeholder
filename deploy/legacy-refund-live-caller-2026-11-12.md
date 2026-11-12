<!-- Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0 -->
# C5.06 / C11.10: legacy refund caller investigation

Product source is actual protected main commit
`a2e503fe6fed3c6c8bbfc3249b5535f939ad6c24`. The product files are unchanged.
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

The source seam is a hypothesis until this fixture reaches its assertions.
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

The repair and ten targeted native controls are source drafts awaiting their
own exact type/lint/private/audit checks and native acceptance. No AFTER
result or protected release is claimed here.

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
The ten broader controls, full protected checks and provider acceptance
remain open. This is a coding-agent proof, not an independent human security
sign-off.
