<!-- Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0 -->
# One invoice, original merchant portions — C12.26/C12.38

This is an unpublished source checkpoint, not stable or live acceptance.
Migration77 remains outside the journal until the real75/76 predecessors are
composed. The local rehearsal applied the official0–74 chain and the exact77
SQL in a fresh disposable database; it does not prove a contiguous77 upgrade.

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
policies are version0; new policies default to version1. New order policies
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

Remaining work includes complete historical populated-before upgrade proof,
legacy financial fixture qualification, physical shipping/tax integration,
concurrent capture, final merged-chain SDK/browser/full-suite qualification,
original-account direct/destination portions, payment/refund/dispute recovery,
human flows and actual provider acceptance. Original recorded provider money
must survive disagreement about a later allocation. Do not enable direct
seller collection or close C12.38 from this source checkpoint.
