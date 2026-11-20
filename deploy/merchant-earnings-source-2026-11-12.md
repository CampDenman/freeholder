<!-- Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0 -->
# Original merchant earnings source evidence — 2026-11-12

C12.26/C12.38 remain open in MASTER.md §43. This is local native source
qualification on a disposable PostgreSQL database with a declared synthetic
payment adapter. No real Stripe account, stable release, deployment or
independent review is qualified here.

Normal schema0–80 was applied to the fresh v6 disposable database, with81
journal entries. Migration80 SHA256 is
`ea06fa49df88e7e3ab396c4246a5d9d017682825f0758253024be0dbcf943fd0`.
There is no new DDL in this earnings increment.

The actual checkout/collection fixture first reached a genuine missing-job
failure in5.59s on product-equivalent sourcee4500e3e: payment completion
queued `invoicing.reconcileOriginalMerchantFee`, but invoicing's resident
job array exported only provider-customer erasure. The real defined recovery
job is now exported through the normal module loader; no test registration
or fake enqueue handler was introduced. Initial report:
`/tmp/freeholder-settlement80-before.json`.

With that narrow registration fixed at9b67a4b2, the original earnings
control failed in5.88s at the legacy single-seller payout guard. Read-only
inspection independently confirmed one paid5250CAD-minor invoice, two
succeeded original payments4200/1050, two fully verified original charge
observations, zero payouts and zero active test backends. Report:
`/tmp/freeholder-settlement80-feejob-after-earnings-before.json`.

New collection-version1 earnings now use each original seller allocation,
its exact invoice-line commission, original charge route and durable
payment/settlement/commission/refund/dispute debt. Refund listeners reconcile
seller portions separately. Legacy direct settlement retains its original
path and reference. No transfer is dispatched by these recording services.

The first after-run showed both correct paid earnings already created by
the actual paid-event listener. The fixture incorrectly expected another
explicit recording call to insert two more rows; the actual replay correctly
returned zero. The fixture now requires zero replay inserts while retaining
all original seller, amount, commission, net, reference and row-count checks.
This failure is preserved in `/tmp/freeholder-settlement80-after.json`.

All three final native controls pass in
`/tmp/freeholder-settlement80-after-v2.json`: direct6060ms,
destination5530ms, and missing verified settlement keeps one portion in
review5390ms. Both paid controls prove automatic earnings and idempotent
replay. The refund-listener call cannot override actual financial evidence
with its supplied invoice-wide amount. All processes ended and an explicit
read-only backend check returned no active test sessions.

Final Node22 full TypeScript, whole-tree lint (94.4s), licensing, release
notes, plan and F-matrix checks pass. Initial source gates also exposed five
missing recovery activity mappings and an unclassified private customer
observation phase in playground policy. The mappings now use all four locale
catalogs; playground confirmation phases remain refused. After those separate
repairs, all44 source-contract files pass384 controls with26 explicit skips,
and playground classification and changed-file lint pass. Original failures
and corrected results remain in `/tmp/freeholder-settlement80-source-gates.log`
and `/tmp/freeholder-settlement80-source-contracts-after.log`. These are source
checks, with no database-backed test silently counted as passing.

Full final suite, generated/public contracts, owner-browser flows, populated79→80 and
old79 cold/warm compatibility, original refund/reversal recovery, booking and
agreement settlement, live provider acceptance and human sign-off remain
required. No checkbox is closed by this document.
