// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// The buy affordance every product surface shares (C3.25 slice 3): product
// cards on collection and search pages, and the product detail block.
//
// Presentational on purpose — the caller resolves catalog.purchaseOptions and
// this renders forms. Products with one sellable variant get a direct
// add-to-cart button; products with options get a <details> picker whose rows
// are each a plain form, so the choice works without JavaScript and every
// control is real markup a crawler and a screen reader both receive.

import { Button } from "@/ui/primitives";
import type { Translate } from "@/core/i18n";
import { addToCartAction } from "./buy-actions";

/** The chrome's catalog keys, gathered where both shelf pages use them. */
export function addToCartLabels(t: Translate): AddToCartLabels {
  return {
    add: t("store.buy.add"),
    choose: t("store.buy.choose"),
    unavailable: t("store.buy.unavailable"),
    priceUnavailable: t("store.buy.priceUnavailable"),
  };
}

export interface AddToCartLabels {
  add: string;
  choose: string;
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

function AddForm({
  product,
  variant,
  label,
}: {
  product: AddToCartProduct;
  variant: AddToCartVariant;
  label: string;
}) {
  const sellable = variant.available && variant.priceAvailable && variant.priceMinor !== null;
  return (
    <form action={addToCartAction} className="inline-flex items-center gap-2">
      <input type="hidden" name="variantId" value={variant.variantId} />
      <input type="hidden" name="product" value={product.slug} />
      <Button type="submit" disabled={!sellable} variant="quiet" className="px-3 py-1.5 text-xs">
        {label}
      </Button>
    </form>
  );
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
    const sellable = variant.available && variant.priceAvailable && variant.priceMinor !== null;
    return (
      <div className="flex items-center gap-2">
        <AddForm product={product} variant={variant} label={labels.add} />
        {sellable ? null : (
          <span className="text-xs text-ink-muted">
            {variant.available ? labels.priceUnavailable : labels.unavailable}
          </span>
        )}
      </div>
    );
  }

  return (
    <details className="group">
      <summary className="cursor-pointer text-sm font-semibold text-accent underline-offset-2 hover:underline">
        {labels.choose}
      </summary>
      <ul className="mt-2 grid list-none gap-2 p-0">
        {product.variants.map((variant) => {
          const sellable = variant.available && variant.priceAvailable && variant.priceMinor !== null;
          return (
            <li
              key={variant.variantId}
              className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-rule bg-paper px-3 py-2"
            >
              <span className="text-sm text-ink">
                {variant.optionLabel ?? variant.variantId.slice(0, 8)}
                <span className="ms-2 text-xs text-ink-muted">
                  {sellable && variant.priceMinor !== null
                    ? formatMinor(variant.priceMinor)
                    : variant.available
                      ? labels.priceUnavailable
                      : labels.unavailable}
                </span>
              </span>
              <AddForm product={product} variant={variant} label={labels.add} />
            </li>
          );
        })}
      </ul>
    </details>
  );
}
