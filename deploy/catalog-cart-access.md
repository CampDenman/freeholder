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
