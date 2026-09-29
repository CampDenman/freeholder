<!--
Copyright (C) 2026 Tony Aly
SPDX-License-Identifier: Apache-2.0
-->

# Release notes — session digest 2026-09-29

Product version remains **0.1.0**, in active development. This is a session
digest, not a release-candidate announcement and not a claim of deployment.
`CHANGELOG.md`, generated from `.changeset/`, is the canonical owner-facing
change list. Refresh GitHub before treating anything below as shipped.

## C3.24 — native storefront parity mapping published (box stays open)

The 2026-09-27 owner decision ("freeholder should put shopify out of business"
— the native store is the product, the Shopify importer is a migration bridge)
gets its proof instrument: the capability mapping at
`deploy/c324-storefront-parity-2026-09-29.md`.

- **Eleven Shopify-core rows, ground truth over optimism.** Every native claim
  cites the test file that proves it: products/variants, discounts/coupons,
  customer accounts/portal, order management with notifications, first-party
  analytics, SEO/marketing surfaces, shipping/taxes, apps/webhooks and
  design-token theming are native ✓ — several deeper than the benchmark
  (price lists and tiered/volume breaks, append-only inventory ledger with
  procurement, deterministic shipping engine, signed webhook subscriptions).
- **One partial, honestly labelled.** Cart/checkout is native and deep at the
  service layer (persistent carts, one-transaction checkout into an issued
  invoice, idempotent payment) but the public self-serve storefront UI —
  cart page, checkout, order confirmation — does not exist yet; no route
  outside admin calls the cart services.
- **Two gaps, dispositioned.** There is no product collections/categories
  taxonomy (schema-confirmed: only the invoicing tax-category key exists),
  no faceted public browse and no storefront search. Both gaps are fix-now,
  assigned to C3.25 (storefront commerce) and C2.24 (editor blocks); the
  mapping feeds those items' gap lists. Deferred with reasons: live carrier
  labels (documented adapter seam), theme marketplace (§36 anti-roadmap),
  third-party analytics pixels (§36 anti-roadmap).
- **The importer stays a bridge.** The Shopify connection imports paid
  order/refund history only, within Shopify's documented limits (60-day
  history, 500-page stop, orders and refunds as reviewable draft invoices) —
  it does not import the catalog, which is what the native store owns.
- **The checklist box stays open, deliberately.** C3.24's wording requires
  every provable gap closed; closure lands via C3.25/C2.24, and the
  f-criteria-matrix row updates to dated evidence at that closure. No gate
  was weakened to flip it early.

## C2.25 — the page is the canvas, slice B: drag-and-drop repositioning (box stays open)

Slice A made the page's text and images editable where they render; slice B
makes the page's *blocks* movable where they render. Both ride the same
draft-broadcast/autosave pipeline the form panel has always used.

- **Drag a block by its handle, watch exactly where it will land.** Every
  block on the canvas shows a grip on hover and keyboard focus. Dragging
  lifts a translucent, live-sized copy of the block that follows the
  pointer; a line between blocks marks the insertion point, and a container
  highlights its nest zone when a drop would put the block inside it.
  Escape, or dropping outside a valid zone, changes nothing — the canvas
  only ever shows an order the tree actually holds.
- **Keyboard and screen readers are first-class, not an afterthought.** The
  grip is a real button: focus it and the arrow keys reorder, announced by a
  live region in the frame. Editor-side moves (the form panel's buttons,
  Alt+Arrow) announce their new position in the editor itself.
- **Every surface stays in the same order, immediately.** A move — from the
  canvas, the keyboard, or the form panel — is one tree operation; the draft
  broadcast re-sorts the rendered canvas in the same commit, and the
  debounced autosave persists it. No frame reload stands between the gesture
  and the preview agreeing.
- **"Publish changes" lands (audit gap 8).** A published page shows a
  draft/live chip and a single "Publish changes" action that saves and
  publishes in one step — the live site is never unpublished mid-flow, so the
  storefront cannot 404 while edits go out. Unpublish stays a separate,
  deliberately-scary header action.
- **Proof.** `tests/core/editor-canvas-drag.test.ts` (the shipped frame
  script: start/move/cancel/drop → tree intents), `tests/core/editor-reorder.test.ts`
  (canvas ↔ form-panel ↔ autosave sync) and the
  `tests/browser/editor-drag-drop.spec.ts` journey: drag the home page's
  heading below its intro on the canvas, watch "Saved", publish once, and
  read the new order back from the public page — plus the keyboard path.
- **No keystroke regression.** `PERF_MEASURE_EDITOR=1` on this machine:
  100.5ms p95 keystroke→preview against the slice-A baseline's 100.6ms on
  the same box — inside the documented 99–104ms harness floor (90ms typing
  pacing + 100ms poll tick); the product path remains the same-commit draft
  overlay. The re-sort pass is signature-gated so typing never pays for an
  order that did not change.
- **The checklist box stays open, deliberately.** Store-section composition
  (product grids, collection layouts) is the next slice, and the UX audit's
  remaining gaps — in-place structural updates beyond reorder, on-canvas
  media editing beyond swap, undo/redo chrome, the true public-view preview —
  are still on the item's list.
