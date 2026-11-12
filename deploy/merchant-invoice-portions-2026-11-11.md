<!-- Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0 -->
# One invoice, original merchant portions — C12.26/C12.38

This is an unpublished source checkpoint, not stable or live acceptance.
Initial rehearsals applied official0–74 plus explicit77 SQL, before the real
75/76 predecessors were composed. Final source integration now includes a
normal contiguous journal0–77; its additional evidence is recorded below.

New member-order invoices freeze each original seller/site portion in
`invoice_merchant_allocations` and exact invoice-line ownership in
`invoice_merchant_allocation_lines`. Capture uses system-only shared services
inside the issuing transaction and performs no provider I/O. There is still
one buyer invoice. Revenue and per-line fees use discounted merchandise;
shipping and shipping tax follow physical lines by discounted value, or by
quantity when every physical line is fully discounted. Largest remainder
with original line-ID ties preserves every cent. BigInt arithmetic avoids
floating-point multiplication and refuses inconsistent original money.

Original business identity, account, model, fee basis and hold terms remain
on the existing private parent market policy. Portions retain only financial
amounts and original seller/contact pointers, never profile names or copied
support/address fields. They participate in bounded merge/undo, private export
and explicit search/retention classifications. Original financial facts are
retained through personal identity erasure and named holds.

The migration deliberately does not reconstruct existing portions. Prior
policies are version 0; new policies default to version 1. New order policies
must have complete matching portions/line ownership before issue. SQL guards
reject historical backfill, money/routing/version edits, missing or cross-
invoice bindings and missing contact merge witnesses. Stop old writers before
upgrade; restore the pre-upgrade database/objects for rollback.

The actual prior `b50282e5` product failed the unchanged original-seller
regression: editing a listing reassigned an existing order's seller and
shipping requirement. The corrected source passed all four existing payout
controls, including that regression, on the explicit77 rehearsal. Four new
shared-service controls passed: two sellers plus site on one discounted
invoice and repeat checkout; immutable money/route/line guards; unified
contact merge/undo; and human/agent denial plus older-writer issue refusal.
Six pure amount controls also pass, including MAX_SAFE_INTEGER arithmetic,
fully discounted freight and per-line fee rounding. An initial four-control
run failed because its new site-product fixture omitted the mandatory tax
category; supplying it preserved every original assertion and all four pass.

A real populated prior77 runtime (`ae71cb7d`) also completed checkout and bank
settlement on official 74. Its drained database was cloned, preserving the
original, then upgraded with the earlier 77 SQL. All nine original financial
table counts and SHA256 digests matched before/after (invoices, lines,
policies, payments, refunds, orders, order items, payouts and transfers).
Existing policies are version 0 and no historical allocation was guessed.
Live SDK generation passed 8/8 against that populated upgraded clone. Local
report: `/tmp/freeholder-allocation77-populated-upgrade.json`.

All 14 discounted-order/payout controls pass (160.71s), including prior frozen
fees, confirmed/unknown original provider results, fully discounted orders
and zero-transfer refusal. Their prior-policy fixtures explicitly restore the
pre77 row shape (no portions, version 0) inside one privileged disposable-test
transaction, temporarily disabling only the three named new mutation guards
and restoring them before commit. A rollback restores those DDL changes too.
No production guard was relaxed, no assertion was removed, and this fixture
construction is distinct from the actual populated upgrade proof above.

The composed source also passed the two original member erasure controls plus
four portion controls. Two reset hooks initially hit PostgreSQL57014 before
their test bodies ran; after the unrelated build/copy stage drained, those
exact two controls passed in 19.98s with unchanged deadlines and durability.

A declared pre77 merge-history fixture then exposed a gap in this unpublished
source: undo succeeded after a new seller portion had acquired its current
contact owner (before: 8.87s). The updated 77 SQL disables that historical undo
without inventing old reference hashes, and fences an old writer's direct
undo marker too. The exact after control passes, ordinary fully witnessed
merge/undo still passes in 8.77s, and the updated schema applied to a fresh
official 74 database. A shared physical checkout also proves actual shipping,
item tax, shipping-tax cent rounding and fees across two sellers plus the
site: the one CAD 45.90 invoice has original portions CAD 24.12, 6.03 and 15.75,
and total site fees CAD 2.50. Those two new controls passed together in 14.68s. These are declared
synthetic tax settings for the site's collection model, not live tax or
seller-as-merchant acceptance.

A second populated upgrade rehearsal uses the exact updated historical-undo
fence. The unchanged committed prior runtime `bed937ac` creates and settles an
order on fresh official74 using its existing frozen-fee control (1 passed,
22.23s). Its drained database is cloned before applying the current explicit77
SQL. All nine financial table counts and canonical row hashes remain identical;
the prior policy stays version0 and no historical portions are invented. Local
report: `/tmp/freeholder-allocation77-final-populated-upgrade.json`. This closes
the exact-SQL preservation gap, while leaving the complete contiguous75/76/77
upgrade requirement open.

Final integration starts on the corrected media75 candidate based on actual
main `eea40ee2`, replays only the qualified carrier76 changes, then the original
77 allocation changes. The sole private-service inventory conflict preserves
both media phases and the catalog's original-line-owner phase. Normal journal
0–77 applies all78 entries to a fresh disposable database. All six allocation
controls and all eight SDK controls pass together (14/14,53.64s); both original
member privacy/export controls pass (2/2,25.18s), and both native contact-FK
retention/search inventories pass (2/2,29.61s).

The actual unchanged prior-runtime paid-order database is also cloned and
upgraded normally from74 through75/76/77. All nine financial table counts and
canonical row hashes match; the original policy remains version0 and no old
merchant portion is invented. Report:
`/tmp/freeholder-invoice-release-populated-upgrade.json`.

Remaining work includes seller-as-merchant tax integration,
concurrent capture, final merged-chain SDK/browser/full-suite qualification,
original-account direct/destination portions, payment/refund/dispute recovery,
human flows and actual provider acceptance. Original recorded provider money
must survive disagreement about a later allocation. Do not enable direct
seller collection or close C12.38 from this source checkpoint.
