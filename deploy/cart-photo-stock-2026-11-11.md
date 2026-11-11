<!-- Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0 -->
# Photograph lines and shared stock

MASTER.md §43 (C5.16, C5.20 and C8.08) remains the status authority.

Two photographs ordered as one print variant remain two lines: the lab needs
their distinct asset identities. Inventory instead has one active reservation
per stock item and cart/order holder. A one-print photo and a two-print photo
therefore require one three-unit hold at the same location.

Real-service regressions reproduced duplicate active-holder failures during
both cart addition and checkout. Guest/contact merging also lost the second
photograph, and named snapshots failed their ordinary-line uniqueness check.
The repair aggregates only reservation quantities and preserves photograph
identity through quantity changes, removal, merging, saving and order creation.
UI actions include the selected line ID; HTTP/MCP/SDK callers may supply it too.
A variant alone continues to identify an ordinary single line; when several
photographs share it, an ambiguous change is refused.

The shared stock helper selects reservations by actual cart holder, variant
and location; it never trusts an unchecked reservation pointer. Cart rows,
reservation rows and inventory rows are locked in stable order. Multi-cart
merge/abandon batches prelock their affected stock before processing groups.
Checkout refreshes its basket under the cart lock, releases its own holds once
and reserves each full order group once. Physical stock remains unchanged by
payment and moves only when shipment fulfillment consumes it.

Reducing/removing an expired cart or merging saved demand must not require
stealing another buyer's units. These operations retain requested lines while
holding at most the physical stock currently available; the ordinary cart
projection reports unmet demand. Checkout still requires the complete stock
quantity. Named snapshots preserve photo metadata and hold no stock.

The core contact-reference callback receives an optional fourth argument with
the actual parent ServiceContext. Production supplies it; existing three-arg
callbacks remain compatible. The catalog callback checks its transaction
identity and composes stock services through that context. No fabricated
context, additional API-key scope, extra transaction or SQL migration is used.

113 PostgreSQL cases across ten adjacent suites pass, including ten new
shared-stock controls. Eight regenerated SDK checks, TypeScript, ESLint,
license/plan checks and 368 contracts (one deliberate skip) pass. Production
build and artifact scrub pass (19,389 files, 236,281,477 bytes). Ten actual
Chromium journeys pass: the four new photograph flows, four existing owner
stock flows, cart capability refusal and the guest storefront checkout.
Shopper and owner update the selected photo and preserve both identities into
one complete order reservation. English/Spanish/French/Arabic RTL run at 320px
with keyboard and both-theme WCAG A/AA scans. English light and Arabic dark
screenshots were visually inspected. Protected PR/merge-group checks remain
required.
The new service suite covers add/checkout, exact line selection, guest/contact
merge, contact-only staff authority, expired/foreign holds, concurrency,
checkout replay/cancellation, saved snapshots and separate physical shipments.
These checks supply no real provider transaction or stable-release acceptance.
