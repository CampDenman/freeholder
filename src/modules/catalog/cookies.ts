// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Cookie names for catalog share links (C9.35) and the storefront cart.

export const WISHLIST_SHARE_COOKIE = "fh_wishlist_share";
export const GIFT_CARD_SHARE_COOKIE = "fh_gift_card_share";

/**
 * The guest's own cart capability (C3.25 slice 3). The value is
 * `<cart id>.<cart token>` — the token half is the bearer credential the
 * cart services require, so this cookie is HttpOnly and never read by
 * client script, exactly like a session cookie.
 */
export const SHOPPER_CART_COOKIE = "fh_cart";
