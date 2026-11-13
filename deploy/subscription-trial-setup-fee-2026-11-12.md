<!-- Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0 -->
# C9.13: accepted setup fee after a no-card trial

The actual existing writer on product source `02c7f64a` was exercised with a
manual monthly plan priced at 2000, a 500 setup fee, and a 14-day no-card trial.
`subscriptions.subscribe` raised no trial invoice. At the trial's end,
`subscriptions.renewDue` raised the first actual invoice for 2000, failing the
2500 assertion. This was an assertion reached through the actual shared
services, not a setup or database timeout (4.972 seconds).

The frozen before fixture is
`tests/modules/subscription-trial-setup-fee-before.test.ts`. Node 22 full type
checking and focused lint passed before the run. The native process exited;
the final disposable database active-backend query returned `[]`.

Evidence retained outside the repository:
`/tmp/freeholder-subscription-trial-setup-before.json`,
`/tmp/freeholder-subscription-trial-setup-before.log`, and
`/tmp/freeholder-subscription-trial-setup-before-drain.json`.

The repair must retain the fee accepted at creation, charge it once on an
actual invoice, preserve the original invoice on retry, and preserve unknown
historical fees without copying later plan values. Composed schema, native
after controls and automatic-provider acceptance remain open.

The source repair is isolated from the commercial-terms foundation. New
subscriptions snapshot `accepted_setup_fee_minor`; historical rows retain
NULL. A parent-row lock serializes billing of the obligation. The exact issued
setup component and its original buyer/currency are checked before a
write-once `setup_fee_invoice_id` is committed in the invoice transaction.
That witness keeps the first invoice's retry payload stable after later
renewals. Later plan edits cannot change the accepted fee.

A voided original setup invoice remains an explicit review debt and blocks
further period invoices. A refund does not reset or erase the original
witness and cannot automatically charge the setup fee again. This patch does
not introduce a waiver workflow or assert that an outstanding fee was paid.

The owned `deploy/subscription-setup-fee80.fragment.sql` is unapplied pending
composition into the unpublished schema. Four source-drafted native after
controls cover first-trial billing after a fee edit, same-period replay after
a later renewal, immediate signup billing, historical NULL refusal of
backfill, and voided-invoice debt. Explicit Node 22 full 8GB type checking and
focused lint passed, as did 17 existing scope/cohort source controls. A final
incremental type/lint pass covered the corrected historical fixture dates.
All processes exited zero and no database operation ran in that source
window. Native execution and actual composed-schema qualification remain
pending.

The four unchanged AFTER controls subsequently passed on exact composed
source `f6b5801b600a3c85971cf5f76dd4fd4eab0b9a26` and the fresh normal 0–80
v7 schema (`d060f9a8…`, assembled by the commerce owner). Individual case
times were 5.394, 4.811, 4.964 and 4.839 seconds. The first case proves both
accepted 500 despite a later plan fee of 999 and identical first-invoice
replay after a second period. The other cases cover signup once, historical
NULL with backfill refused, and retained voided setup debt. No product, SQL
or deadline was changed for this run. The runner exited zero; the final
active-backend query returned `[]`.

The isolated AFTER checkout explicitly reused the qualified candidate's
dependency tree after SHA256 equality of manifest, lock and workspace files;
the symlink resolves to the already qualified invoice-release dependencies.
This was native integration acceptance, not a new install or build.
Evidence: `/tmp/freeholder-subscription-setup-fee-v7-after.json`,
`/tmp/freeholder-subscription-setup-fee-v7-after.log`, and
`/tmp/freeholder-subscription-setup-fee-v7-after-drain.json`.
The original unchanged-source BEFORE evidence remains separate. Protected
release, automatic-provider acceptance and the broader accepted-terms
lifecycle remain open.
