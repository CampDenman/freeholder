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

Qualification of this source repair is pending. The unchanged actual-service
control will again reserve another seller's refund and require successful
undo, then create this seller's refund and require refusal while preserving
the original immutable financial child. The original failed runner, full
synthetic merge/route/refund ledger and backend-drain evidence are preserved.
