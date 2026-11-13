<!-- Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0 -->
# Original bank refund current-state draft

This checkpoint is **unqualified source**, based on isolated CURRENT0fbe.
No compiler, test, migration, provider account or browser acceptance has run
for this draft. The assembled0080 file remains byte-identical SQL958; the
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
freezes the complete bounded original financial revision before GET; its own
fact/capture alone is excluded when comparing that earlier revision. Other
concurrent evidence, truncated restoration or an unfinished original money
creator refuses closure. Actual current-read completion uses a private nonce,
exact process birth and server-held completed promise; elapsed time supplies
no negative proof. Failed finish persistence can retry without a provider POST.

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

Draft controls cover current-state transitions, semantic-repeat invalidation,
stale/unfinished proof, nullable fields, foreign original scope/money, capacity
projection and actual factory/HMAC normalization. They have **not run**. The
next finite request is Node22 types, changed-source lint and these affected
DB-free controls. SQL syntax/model parity, fresh ordinary migration and actual
state-transition/caller/stale-read/credit/privacy/native tests follow only after
source qualification and separately granted database windows.
