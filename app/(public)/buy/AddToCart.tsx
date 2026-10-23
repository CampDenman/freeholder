// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// The buy affordance every product surface shares (C3.25 slice 3): product
// cards on collection and search pages, and the product detail block.
//
// Presentational on purpose — the caller resolves catalog.purchaseOptions and
// this renders forms. Every product shows its price: the one price for a
// single variant, "From …" for a product with options. A product with options
// renders one form whose variants are radio buttons, each with its own price,
// the cheapest sellable one chosen already, and the add button always in
// view. Before 2026-10-23 the prices and the button hid inside a collapsed
// "Choose options" disclosure and a shopper on a listing saw no price at all.
// It works without JavaScript and every control is real markup a crawler and
// a screen reader both receive.

import { Button } from "@/ui/primitives";
import type { Translate } from "@/core/i18n";
import { addToCartAction } from "./buy-actions";

/** The chrome's catalog keys, gathered where every shelf uses them. */
export function addToCartLabels(t: Translate): AddToCartLabels {
  return {
    add: t("store.buy.add"),
    choose: t("store.buy.choose"),
    from: t("store.buy.from", { price: "{price}" }),
    unavailable: t("store.buy.unavailable"),
    priceUnavailable: t("store.buy.priceUnavailable"),
  };
}

export interface AddToCartLabels {
  add: string;
  /** The option picker's legend. */
  choose: string;
  /** "From {price}", with the placeholder left in for the component to fill. */
  from: string;
  unavailable: string;
  priceUnavailable: string;
}

export interface AddToCartVariant {
  variantId: string;
  optionLabel: string | null;
  priceMinor: number | null;
  priceAvailable: boolean;
  available: boolean;
}

export interface AddToCartProduct {
  slug: string;
  variants: AddToCartVariant[];
}

function sellable(variant: AddToCartVariant): boolean {
  return variant.available && variant.priceAvailable && variant.priceMinor !== null;
}

/** Variants cheapest first, unpriced ones last — the order a shopper reads. */
function byPrice(variants: AddToCartVariant[]): AddToCartVariant[] {
  return [...variants].sort((left, right) => {
    if (left.priceMinor === null) return right.priceMinor === null ? 0 : 1;
    if (right.priceMinor === null) return -1;
    return left.priceMinor - right.priceMinor;
  });
}

export function AddToCart({
  product,
  formatMinor,
  labels,
}: {
  product: AddToCartProduct;
  formatMinor: (minor: number) => string;
  labels: AddToCartLabels;
}) {
  if (product.variants.length === 0) return null;

  if (product.variants.length === 1) {
    const variant = product.variants[0]!;
    const ok = sellable(variant);
    return (
      <form action={addToCartAction} className="flex flex-wrap items-center gap-3">
        <input type="hidden" name="variantId" value={variant.variantId} />
        <input type="hidden" name="product" value={product.slug} />
        {ok ? (
          <span className="text-sm font-semibold text-ink" data-price>
            {formatMinor(variant.priceMinor!)}
          </span>
        ) : (
          <span className="text-xs text-ink-muted">
            {variant.available ? labels.priceUnavailable : labels.unavailable}
          </span>
        )}
        <Button type="submit" disabled={!ok} className="px-3 py-1.5 text-xs">
          {labels.add}
        </Button>
      </form>
    );
  }

  const ordered = byPrice(product.variants);
  const chosen = ordered.find(sellable);
  // The lowest price a shopper can actually pay: the cheapest sellable
  // variant, which is also the one chosen already. An unavailable or
  // unpriced variant never sets the "From" price.
  const lowest = chosen?.priceMinor ?? null;
  return (
    <form action={addToCartAction} className="grid gap-2">
      <input type="hidden" name="product" value={product.slug} />
      {lowest !== null ? (
        <span className="text-sm font-semibold text-ink" data-price>
          {labels.from.replace("{price}", formatMinor(lowest))}
        </span>
      ) : null}
      <fieldset className="grid gap-1">
        <legend className="text-xs font-semibold text-ink-muted">{labels.choose}</legend>
        {ordered.map((variant) => {
          const ok = sellable(variant);
          return (
            <label key={variant.variantId} className="flex flex-wrap items-center gap-2 text-sm text-ink">
              <input
                type="radio"
                name="variantId"
                value={variant.variantId}
                disabled={!ok}
                defaultChecked={variant === chosen}
                required
              />
              {variant.optionLabel ?? variant.variantId.slice(0, 8)}
              <span className="text-xs text-ink-muted">
                {ok
                  ? formatMinor(variant.priceMinor!)
                  : variant.available
                    ? labels.priceUnavailable
                    : labels.unavailable}
              </span>
            </label>
          );
        })}
      </fieldset>
      <div>
        <Button type="submit" disabled={!chosen} className="px-3 py-1.5 text-xs">
          {labels.add}
        </Button>
      </div>
    </form>
  );
}
