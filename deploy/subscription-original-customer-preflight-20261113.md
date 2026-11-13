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

Source qualification is not yet run. The finite plan is full Node22 types,
changed-file lint and existing affected proof/authority/internal/audit controls;
then the unchanged preserved-history oracle on a NEW workclone, the original
four buyer recovery controls, and real queued-task legacy positive/replay,
wrong-caller/namespace, missing-hash and later-hold controls under separate
explicit database leases. The updated existing test callers use the task's
actual original UUID, rather than arbitrary UUIDs.

Missing original payload recovery is still debt. This preflight is not a
provider caller-stop receipt and does not close a hold arriving after admission,
paid inventory reconciliation, legacy remote subscription stopping, new schedule
creation, commercial amendments or full C12.38 acceptance.
