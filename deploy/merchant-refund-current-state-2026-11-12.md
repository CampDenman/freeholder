<!-- Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0 -->
# Original bank refund current-state draft

## Current-source integration, not yet qualified

The owned bank deltas are now composed onto exact885a37f2 in the isolated
`/tmp/freeholder-current-bank80-20261112` worktree. Only additive MASTER/locale
adjacency and the job export array conflicted; every current root section,
locale key and buyer-money finisher job was retained. Current fee/C0/terms/
privacy bodies were preserved rather than replacing older whole files.

The pure owned emitter now appends the bank fragment after accepted terms.
New unpublished80 SQL is
`e7834c9048ecd5eace52ecc391ff392f7b0701b396e02ddcfc364cb8743d82a5`.
The complete prior881a7901 byte prefix, all published0–79 SQL and the journal
are unchanged. The fragment itself is a008e940. No database, compiler, native,
SDK, install or build has run in this new integration. It needs its own source
qualification and a NEW disposable migration database; existingV10/881a and
earlier958/1ac databases/clones must not be changed or reused for bank tests.
Pure-emission evidence is `/tmp/freeholder-bank-current80-current-source-assembly.json`.

## Earlier isolated source qualification

This checkpoint is a **source-qualified draft**, based on isolated CURRENT0fbe.
Full Node22 types, changed-source lint and the finite63 DB-free controls pass.
No migration, actual financial database, provider account or browser acceptance
has run for this draft. The assembled0080 file remains byte-identical SQL958; the
owned `merchant-refund-current-state80.fragment.sql` is unassembled and must
only enter a separately reviewed, freshly migrated unpublished80 candidate.
All existing v9 databases and populated-before clones remain untouched.
C12.38 stays open and the new merchant model stays disabled.

Stripe documents a refund returning from `succeeded` to `requires_action`,
then becoming pending after corrected bank details; it also documents nullable
refund state and failure-balance information. The guide shows a `pyr_` local
payment refund alongside ordinary `re_` references. These documented shapes
do not establish ownership. The implementation still requires the actual
original platform, charge namespace, immutable resource ACK/request-log
binding, amount, currency and request protocol.

Primary references:

- [Refund state transitions and customer instructions](https://docs.stripe.com/refunds#requires-action)
- [Refund object and nullable fields](https://docs.stripe.com/api/refunds/object)
- [Refund references](https://docs.stripe.com/refunds#tracing-refunds)

The draft adds four append-only tables: observation capture occurrences,
original-resource read admissions, physical read finishes and current-state
receipts. Repeated semantic observations remain deduplicated, while a later
authenticated occurrence still invalidates an earlier receipt. A fresh read
freezes the complete bounded original request/resource revision before GET; its own
fact/capture alone is excluded when comparing that earlier revision. Other
concurrent evidence for that resource, truncated restoration or an unfinished original money
creator refuses closure. Actual current-read completion uses a private nonce,
exact process birth and server-held completed promise; elapsed time supplies
no negative proof. Failed finish persistence can retry without a provider POST.

Source review corrected an overbroad first draft before any runner started:
hashing all refunds/fees on the same charge would make sequential GETs for two
different resources invalidate each other forever. Freshness now includes all
original bound resources, their raw captures/aliases and relevant original
creator proofs. Aggregate cash, unrelated refunds, fees and return inventory
remain independently conserved under the original cash lock. An unverified
list/metadata candidate retains `claimedRequestId`; only the exact original
ACK/request-log namespace binding supplies an actual request FK. Historical
claim rows stay unchanged, and actual foreign/secondary money remains visible
to aggregate cash capacity/debt. Multiple physical resources bound to the same
original request or another logical owner's alias refuse current closure;
a fresh GET also cannot erase contradictory immutable amount/currency facts.
Two-resource sequential convergence still needs an actual SQL/native control.

Signed refund events preserve nullable intent/status/protocol and actual
failure-balance facts. Matching uses original resource binding or original cash
namespace, never current contacts or coincidentally equal amounts. Each fact
commits with its occurrence, erasure-repair outbox pointer and original-resource
recovery job before ordinary event application. Unrequested refunds retain
cash evidence without fabricating an invoice/refund request. Exact current-read
captures do not recursively schedule another GET.

A valid current receipt can reproject mutable refund/payment/invoice refunded
totals while preserving every earlier money observation and original paid
amount. Null status proves no negative cash movement and changes no balance.
Inconsistent, over-cap or incomplete projections remain review rather than
clamping actual evidence. A stale receipt never falls back to an old success.
Earlier issued credits and their tax/line values remain unchanged.

RMA reclassification reopens only its exact frozen refund part and keeps its
original issued credit. A later replacement must satisfy the same original
return→credit→allocation→refund lineage; amount equality alone is insufficient.
Seller earnings recheck actual cash and outstanding credit/refund debt. A
failed bank refund of a generic/manual refund remains explicit review debt
until actual causal discharge is established; this draft does not invent an
unrelated replacement or waive the refund promise. That resolution workflow,
legacy C0 bank recovery and full fee/reversal/dispute/provider acceptance remain
unfinished work, not checked acceptance.

Owner and authenticated buyer projections show masked status and an outstanding
refund promise. They expose no provider resource reference, private completion
nonce, bank details or current-read receipt to the buyer. The owner can ask the
same scoped/step-up shared service for another exact-resource read. Stripe
bank-detail instructions remain in its own customer email/provider flow; the
application never fabricates a hosted action URL or asks for bank details.

Source qualification on eba4be21 plus two mechanical corrections passed:

- Twelve tracked dependency manifests match the qualified current-financial-v9
  donor byte-for-byte; only its existing dependency tree is linked, no install.
- The first full Node22 8GB typecheck reported one incorrect app import alias.
  The real relative import correction passed the renewed full/incremental
  typecheck. First log: `/tmp/freeholder-bank-current80-types-v1.log`; passing
  log: `/tmp/freeholder-bank-current80-types-v2.log`.
- Changed-file lint examined46 TS/TSX files. Its only diagnostics were two
  redundant non-null assertions in the new HMAC fixture. Removing them passed
  the affected single-file lint; unchanged clean files were not repeated.
  Logs: `/tmp/freeholder-bank-current80-lint-v1.log` and `-lint-v2.log`.
- Exactly five core files passed63 tests with0 failures/skips: private registry5,
  capacity14, current proof19, actual refund adapter23 and signed bank events2.
  Evidence: `/tmp/freeholder-bank-current80-five-controls-v1.json` and `.log`.
  All runners exited and no database environment/client was used.

These controls cover source authority, current-state decisions, repeated/stale
proof, nullable fields, original scope/money, capacity and actual factory/HMAC
normalization. They do not prove SQL behavior or actual bank recovery. SQL
syntax/model parity, fresh ordinary migration and actual state-transition,
two-resource, caller, stale-read, credit, privacy, legacy and provider acceptance
remain required under separately granted database windows. The changeset has
not been folded into final generated release notes or a current-main union.
