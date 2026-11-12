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
