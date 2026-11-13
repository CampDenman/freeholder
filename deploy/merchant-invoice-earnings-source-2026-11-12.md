<!-- Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0 -->
# Original invoice earnings source evidence — 2026-11-12

C12.25/C12.38 source increment; the full C12.38 checkbox remains open.
These are disposable PostgreSQL controls with actual public booking, invoice,
collection, observation and event services, and an explicitly synthetic
payment provider. No provider account or stable release acceptance is supplied.

Actual source4474dd7e (qualified mixed-order earnings plus a new booking
fixture) failed its direct-booking before-control in5.72s. Independent SQL
confirmed a paid8400CAD-minor booking invoice, one succeeded payment, the
retained single-invoice scope/payment route, one fully verified observation,
zero payouts and no active test backends. Report:
`/tmp/freeholder-invoice-settlement80-before.json`.

The private settlement query now selects the original booking or agreement
route rather than a legacy direct-payment row. It validates the original
supplier, platform, charge/recipient/settlement namespace, captured total and
commission, and reads the shared durable recovery debt. Partial returns or
missing original evidence stay in review. Existing legacy direct routing
remains on its own path. Recording uses the frozen invoice commission rather
than recalculating it from today's settings. No provider I/O or extra payout
is introduced by these services.

The first after-batch selected an existing subscription test before the new
booking controls. That old fixture actually calls the NEW subscription API
without a declared tax destination/profile, so the current required guard
correctly refused it in4.92s. No booking control executed in that bailed batch,
and no pre80 compatibility is claimed. Original report:
`/tmp/freeholder-invoice-settlement80-after.json`.

The separate finite booking batch passes2/2 with no filtered cases: direct
5788ms and destination5212ms, in
`/tmp/freeholder-invoice-settlement80-after-v2.json`. Both use the actual
signed-in customer booking flow and actual hosted payment orchestration;
the paid event records the original seller's earnings and replay inserts
nothing. An explicit backend check returned no active test sessions.

Full Node22 TypeScript and changed-file lint pass. All15 focused service-
composition, internal-boundary and SDK-schema controls pass in
`/tmp/freeholder-invoice-settlement80-source-boundaries.json`.
Migration80 is unchanged:
SHA256 `ea06fa49df88e7e3ab396c4246a5d9d017682825f0758253024be0dbcf943fd0`,
actual fresh normal0–80 v6 journal81/max1793310000060. No SQL is added here.
The new agreement routing branch has not received native qualification;
actual old-software/populated upgrade, final source/browser/suite and live
provider qualification remain required. No checkbox is closed here.
