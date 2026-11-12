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
