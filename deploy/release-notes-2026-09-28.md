<!--
Copyright (C) 2026 Tony Aly
SPDX-License-Identifier: Apache-2.0
-->

# Release notes — session digest 2026-09-28

Product version remains **0.1.0**, in active development. This is a session
digest, not a release-candidate announcement and not a claim of deployment.
`CHANGELOG.md`, generated from `.changeset/`, is the canonical owner-facing
change list. Plan gate at this snapshot: **298 unique IDs, 279 checked,
19 open**. Refresh GitHub before treating anything below as shipped.

## C11.11 — performance budgets pass on the reference target

The §15.1 performance budgets are now measured on the actual reference
hardware, and every one of them passes:

- **Thirteen for thirteen on the $6 droplet.** The acceptance run targeted the
  provisioned `freeholder-ref` instance (nyc3, `s-1vcpu-1gb`, ubuntu-24-04,
  app image `ghcr.io/campdenman/freeholder:edge` ≈ main `204f4f7`), measured
  through the deployed surface over an SSH tunnel, against the verified medium
  dataset. Public render 203ms p95 (tunnel-adjusted; 274ms on-box), LCP 432ms
  p75, INP 16ms p75, CLS 0.00064, admin list 732ms p95, admin detail 661ms p95,
  search 499ms p95, report 544ms p95, editor first paint 488ms p95,
  keystroke→preview 119.8ms raw p95 at the harness measurement floor, queue
  1,219ms p95, migration chain 49.1s, cold boot 7.81s p95.
- **The evidence is archived, not asserted.** `deploy/perf-reference-run-2026-09-27.log`
  holds the complete run: host configuration, dataset proof, every command,
  every raw sample, computed percentiles and per-budget verdicts. The summary
  in `deploy/performance-measurements.md` records the method adaptation
  (HTTP/browser through the tunnel; queue/migration/boot timed on-droplet) and
  the honest caveats, including the keystroke row's raw 119.8ms versus its
  ≤20ms product contribution, and the 1.1ms margin on the search row.
- **The checklist box stays open, deliberately.** The C11.16
  spec-reconciliation gate orders C11.11 to remain unchecked until that gate
  is updated, and no gate was weakened to flip it early. Checking C11.11 now
  awaits the C11.16 workstream's own reconciliation-table update, with this
  run's evidence standing as the acceptance record.
- **Nothing was tuned to pass.** No swap was added, the droplet was not
  resized, no budget was raised, and no gate was weakened; the one observation
  of the single CPU starving the queue worker under concurrent measurement
  load is preserved in the log as a real behavior of the target.
