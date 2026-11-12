<!-- Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0 -->
# C5.06 / C11.10: legacy refund caller investigation

Product source is actual protected main commit
`a2e503fe6fed3c6c8bbfc3249b5535f939ad6c24`. The product files are unchanged.
The isolated fixture uses actual invoice/payment/refund shared services and
pauses only the synthetic provider edge. It attempts local cancellation and
a new-key replacement while the first physical refund promise remains live,
then drains both promises before evaluating capacity and positive-result
application.

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
source window. The single native control remains pending.
