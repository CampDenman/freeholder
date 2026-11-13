<!-- Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0 -->
# Original customer-task preflight — candidate evidence

C1.08/C12.38 remain subject to the full current acceptance requirements. This
is a source repair for a demonstrated unpublished candidate defect, not a main
production or actual provider acceptance claim.

The unchanged opt-in preserved-history probe at root source f49128aa ran on a
NEW workclone of the immutable V10 local-mode before database, with normal
0–80 journal hash 881a7901. The actual retained untagged customer job used the
real Stripe adapter factory with an injected synthetic fetch. Its 426.29 ms
assertion genuinely failed: DELETE count was 1 rather than 0. The request
became completed while its original resource remained active. There was no
external provider call. The original thirteen golden table hashes, full
journal and public/drizzle column and constraint definitions stayed identical;
both database client inventories were empty after the runner exited.

Preserved evidence is `/tmp/freeholder-buyer-history-legacy-before-f491.json`,
`-tests.json` and `.log`; the golden and mutated workclone remain available.
No reset or migration was part of the probe.

The repair requires every customer task to pass the original job UUID, exact
raw retained queue payload and existing admission hash, canonical current
privacy receipt membership, current holds and schedule/cash proof before
provider I/O. Tagged tasks retain their exact original money-finisher
inventory. An untagged task cannot infer a new-mode child list from current
rows: nonempty original agreement/payment history or a missing claim stays
explicit in-progress recovery debt. No replacement finisher or child IDs are
manufactured. A safe completed receipt admits a duplicate with zero I/O.

Source qualification at 99f566b9 passed full Node22 types, three changed-file
lint and 41 affected proof/authority/internal/audit assertions. Eighteen
DB-backed cases were explicitly skipped, not reported as native passes.
The existing customer-job test callers now use their actual original UUIDs.
The separate subscription-billing alignment is c75f75e0.

The unchanged f8822fadc07147eed554d113194586499beff661 oracle passed in
375.55 ms on current root356306b7, whose two product files exactly match99.
A NEW workclone matched the immutable golden's thirteen hashes, full journal
and public/drizzle column/constraint definitions before execution. The original
request remained in-progress with fulfilledAt null and its resource active;
provider calls and DELETEs were both zero. The golden remained unchanged and
both databases had no clients. Evidence is
`/tmp/freeholder-buyer-history-legacy-after-356{.json,-tests.json,.log}`.

Three separate real queued-task controls then passed on disposable normal V10,
never a golden/review clone: original UUID/namespace refusal plus valid original
customer deletion and zero-I/O replay (7.029 s), missing original claim retained
as explicit recovery with zero provider calls (7.112 s), and a later same-contact
money hold refusing the worker before any provider call (7.162 s). Independent
readbacks selected each exact original request/task/claim; all retained the
81-entry881a journal and had no clients before the next reset.

The first readback wrongly expected one global retained queue row rather than
the exact current request's task. Its failure log is preserved; corrected
read-only filtering passed without repeating native execution. The first
late-hold fixture correctly hit the existing applied-request hold refusal
before reaching the worker (6.992 s). Fixture-only2afd8354 uses a second
eligible erasure request for the same contact, matching the existing passing
buyer-recovery pattern. Its incremental types/single-file lint passed, then
the unchanged worker assertions passed on rootf0416c52 with the same99 product.
Logs and exact task-scoped ledgers use prefixes
`/tmp/freeholder-customer-preflight356-{positive,hash}` and
`/tmp/freeholder-customer-preflightf041-hold`; earlier failed logs remain.

The complete affected18-case native suite and repeated original four recovery
controls have not yet run against this product delta. Accepted-terms/profile
witness cases remain a separate unexecuted fixture. These facts are not full
subscription, actual provider or privacy completion acceptance.

Missing original payload recovery is still debt. This preflight is not a
provider caller-stop receipt and does not close a hold arriving after admission,
paid inventory reconciliation, legacy remote subscription stopping, new schedule
creation, commercial amendments or full C12.38 acceptance.
