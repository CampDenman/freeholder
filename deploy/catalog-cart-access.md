<!-- Copyright (C) 2026 Tony Aly -->
<!-- SPDX-License-Identifier: Apache-2.0 -->

# Cart and wishlist access

C5.20/C11.10 use the existing catalog service contracts for both human and API
clients. A cart ID or contact ID is an identifier, not a credential.

A guest opens a cart with `catalog.getOrCreateCart`. Keep the returned private
`cart.token`; use it as `token` for `catalog.getCart`, and as `cartToken` for
`addCartItem`, `setCartItemQuantity`, `removeCartItem`, `applyCouponToCart`,
`quoteCartPromotions` and `listCartOffers`. When an ID and token are supplied,
they must identify the same cart. A gallery's `galleries.addToCart` needs both
its gallery session and the cart token; viewing a gallery grants no access to
another person's basket. Closed carts cannot have their lines edited.

Authenticated customers may use their session-linked contact's carts and
wishlists. Saving a named cart or changing a wishlist requires that profile
ownership or the relevant catalog management permission. A token for one
basket does not authorize reading all saved carts or creating profile records.
Public wishlist share links remain a separate, explicitly issued capability.

Staff and API keys may use cart IDs when their exact catalog operation is
authorized. Cart reads/list results return `token: null` for view-only staff
and narrow read keys, so read access does not disclose a write capability.
Scoped mutations also keep their returned tokens redacted unless the caller
already supplied the token, owns the contact, or has full catalog management.
The getOrCreateCart operation deliberately issues a cart capability for a
guest or an authorized contact profile, including an existing open cart. Treat cart tokens as
private credentials and never use them as display identifiers; admin screens
use the cart ID instead.

Existing guest API integrations that sent only cart IDs must now pass the
matching token. Staff interfaces continue using their authenticated role.
The generated SDK includes the optional token inputs and nullable read tokens.

Stock refresh includes the current cart's active holds at the selected location.
Public stock availability continues to reserve those units for that cart and
refuses them to other shoppers. A private system query supplies the exception
only after the normal cart access check; public inputs cannot select somebody
else's hold. Expired/released/consumed holds never count. The cart evaluates all
lines sharing a variant/location together so a reused hold is not counted once
per line. Quantity increases preserve this check before replacing the hold.
`tests/core/cart-owned-reservation.test.ts` reproduced four failures before the
repair, covering complete-stock checkout, valid increases, other-cart separation
and expired/foreign reservation pointers (C5.16/C5.20).

Qualification on 2026-11-11 passed 39 PostgreSQL cases across the new regressions,
existing carts/orders/inventory, cart access and private-service inventory.
All eight live SDK checks passed; private cart availability is absent from the
generated public contract. The final production build and artifact scrub
checked 18,777 files and 226,593,898 bytes with no source or environment leakage.
Six actual Chromium journeys passed: four owner add-all-stock → HTTP availability
→ keyboard checkout flows in English/Spanish/French/Arabic RTL at 320px with
both-theme Axe scans, the read-only cart capability boundary, and the full
guest storefront email-verification/checkout journey. The first browser run
also found an existing unlabeled per-line quantity input; its accessible label
now uses translated quantity text and the product/sku. No real payment provider
transaction or launch acceptance is claimed by these source checks.

The photograph-line follow-up keeps one stock hold per variant/location while
retaining distinct photo lines through editing, merging and named snapshots.
See `deploy/cart-photo-stock-2026-11-11.md` for the reproduced failures,
parent-context boundary and renewed qualification.
