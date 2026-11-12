<!-- Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0 -->
# Original allocation merge evidence (C12.38/C1.08)

The actual mixed-invoice control failed on frozen `f6b5801b` with normal-v7
SQL `d060f9a8`: reserving a refund for the other seller caused the first
seller's contact-merge undo to fail at `collectionSnapshot`. The original
collection snapshot reused the buyer's whole-invoice financial fingerprint.
The failure occurred before the control could test a new refund belonging
to the first seller; that assertion has not passed.

The source repair derives payment IDs from the selected original allocation
routes. The existing dependency projection has an optional internal original
payment scope; its default buyer path and whole-invoice fingerprint remain
unchanged. A scoped seller fingerprint includes its own payment, caller,
refund, fee and dispute evidence, plus the immutable invoice/source/currency
locator. Whole-invoice paid/refunded totals and buyer fields cannot become
another seller's financial history. Overflow still blocks undo.

No public filtering parameter, identity repoint, SQL or provider behavior is
added. Historical fingerprints may conservatively refuse undo when their
older broader evidence cannot be proved. Stored artifacts are not rewritten.

Full Node22 types and focused lint pass. The unchanged actual-service control
passes6.63s on the same normal-v7 SQL: another seller's refund permits undo,
then this seller's new refund child blocks undo while retaining the current
owner and immutable child. Independent SQL confirms two merge operations
with exactly the first undone, two refunds and two original request children;
the runner and all database backends drained. The original failed runner,
full synthetic merge/route/refund ledger and before/after drain evidence are
preserved. This is local combined-source evidence, not protected main,
provider acceptance or complete financial lifecycle qualification.
