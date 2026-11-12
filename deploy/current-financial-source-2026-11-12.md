<!-- Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0 -->
# Current-main financial source qualification (C5.06/C5.19/C12.38)

Exact checkpoint `73e145af` composes the two qualified fee repairs with the
current financial/retention source and protected main `bad846e4` (merged #694).
All published 0–79 migrations, unpublished 80 SQL958 and its journal are unchanged;
the previously qualified retention-count fix at `46a6ec02` is preserved.

The two fee changes retain an uncertain dispatched operation for exact-resource
recovery, and refuse a stale dispatch before returning a terminal result.
Historical money is never rewritten or automatically charged. Their original
failing controls and populated-before snapshots remain preserved separately;
see the unreadable-success and stale-dispatch evidence documents.

The actual-main merge had five documentation/inventory conflicts and two
product-file conflicts. A separate agent reviewed the latter read-only: original
merchant routes come from retained server-owned scope, their actual request,
caller, resource and terminal-proof guards run before any merchant transition,
and legacy routes retain C0 admission/release/finish enforcement. Both product
files stayed byte-identical to the already source-qualified `5f53daf5` bodies.
The authenticated C0 journal module is byte-identical to actual main. All
qualified evidence paragraphs were retained; no caller input chooses a bypass.

Full Node 22 types, focused fee/test lint, actual 614-note generation, metadata,
playground policy and all 44 source-contract files passed at `5f53daf5` (384
assertions, 26 explicit database skips). After merging actual main and adding the
already qualified historical control, exact `73e145af` passed types, lint of the
six newly merged/added TypeScript files, all 12 affected CI/diagnostic controls,
metadata and workflow-integrity gates. The main merge changed no product body;
the latter checks do not claim another run of the unchanged 384 assertions.

Five unchanged native controls then ran separately and sequentially on the
ordinary 0–80 SQL958 database, each with its original deadline and bail=1:

| Control | Actual duration | Independent financial readback |
|---|---:|---|
| Legacy paused caller | 5.257s | 1,000-cent refund applied; one authenticated admission and finish |
| Merchant paused caller | 6.062s | 500-cent refund applied; one original request/dispatch, returned finish, bound success and physical ACK |
| Installment line fee | 6.967s | Two 50-cent customer refunds; original fee resources 3+7 |
| Unreadable success and stale read | 6.451s | One 100-cent resource/operation/key and one bound observation |
| Stale completed dispatch | 6.355s | One 100-cent resource/operation/key and one bound observation |

Each control passed without skips or retries. Before the next fixture reset, an
independent PostgreSQL program checked the actual balances, topology, financial
observations and absence of remaining client connections. The preserved history
clones were never used for these resettable cases. The final fixture retained
its 5,400-cent original payment, 1,200-cent customer refund/credit, canonical
retained fee target 400 and one 100-cent fee return. The 81-entry journal stayed
unchanged. Reports and per-case ledgers are `/tmp/freeholder-current73-*`.

This is targeted current-source qualification, not complete financial acceptance.
The seller-merchant collection model stays disabled. Complete bank-state/fee/
recipient recovery, accepted commercial terms, subscription/provider integration,
whole-candidate browser and provider acceptance, recovery and independent review
remain required. C12.38 and stable sign-off stay open.
