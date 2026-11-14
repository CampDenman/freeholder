<!-- Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0 -->
# Genuine cartless paid-period merge precondition

C9.33 / C12.38 / C1.08. SOURCE ONLY from5aaf7ae1. No compiler, lint, tests,
PostgreSQL, SDK, provider or host execution in this lane.

Actual V36 completed real money, independent paid effect, history/idempotency,
overlap and financial exports, and merged the buyer successfully. Undo correctly
refused the fixture's unrelated setup cart. The cart contact reference captures
ANY cart on either contact, regardless of status/kind, and has no safe restore
operation. Abandoning/converting the cart therefore cannot make that merge
undoable. The policy, message and guard are unchanged. There is no raw cart
status/detach/delete, privacy erasure or arbitrary transfer to another owner.

This test-only successor adds three explicit real constructors:

* `seedMerchantCatalogue80`: the existing genuine merchant/business/tax/profile/
  listing/customer services return the actual saved variants directly. It never
  creates a cart or borrows a cart token. The original checkout constructor above
  it remains byte-identical, including its default cart/checkout behavior.
* `seedActualProviderSubscriptionWithoutCart80`: copies the actual existing
  shared customer/method/new-terms/subscribe/fee/product/horizon/provider producer,
  changing ONLY the actual constructor and actual returned-variant selection.
  It supplies no fake cart/context/proof. The original provider constructor is
  unchanged; a literal reverse restores the entire original producer body.
* `actualCartlessControlledPeriod84`: the actual existing original-period
  constructor with the explicit cartless provider seed. It proves the real
  original buyer has no cart before any controlled target work. Its preserved
  try/catch cleans up the real fixture if that precondition fails. The default
  `actualControlledPeriod84` file/behavior is unchanged.

ONLY the full paid-period history/merge/undo scenario opts into the new period
constructor. Before its existing merge, a read-only query proves both the real
original buyer and newly created survivor have ZERO carts of any status/kind.
All existing business/payment/effect/grant/merge/undo/export assertions remain,
including root's actual retirement/merge/undo timestamp and row-XID evidence.
Every other staged/partial/refund and default producer case keeps its original
constructor. One common manifest helper's parameter is narrowed to its actual
used `target`/`remote` fields so both real constructor result types fit without
a cast or a fake checkout fixture.

The adjacent source manifest records complete body/file reversals and unchanged
cart policy/runtime/default constructor hashes. Five source controls are
PREPARED/UNRUN. Root owns source qualification and the fresh unchanged desired
full money→effect→merge→undo native journey with independent journal/table/profile/
drain evidence. The failed V36 remains preserved; this source is not a native
PASS, provider-account/signoff or stable acceptance.
