// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Revenue, cut by what the money was for (MASTER.md §4.7, §43 C9.08).
//
// §4.6 calls `Invoice` "the single money object", and that settles most of
// this: revenue is paid invoices, in one table, whatever module caused them.
// What a report adds is the *question* — by service, by product, by location —
// and the answer to that lives in the module that knows what the invoice was
// for. An invoice's `source_type`/`source_id` is the join, and the module that
// owns that source is the only thing that can turn it into a name a person
// recognises.
//
// So core names the dimensions, because "revenue by service" must mean one
// thing, and modules register sources for them. A dimension nothing answers
// for simply is not offered — better than a screen with an empty chart on it.
//
// **Basis is part of the answer, not an implementation detail.** Some invoices
// belong entirely to one bucket: a booking is for one service, at one place.
// Others are a list: an order has many products on one invoice. Reporting the
// second as though it were the first would mean splitting a total across
// products by proportion, inventing a rounding decision the business never
// made — so a source declares which kind it is, every source in a dimension
// must agree, and the screen says which was used.
import type { SQL } from "drizzle-orm";

/** The questions a business asks of its revenue. */
export const REVENUE_DIMENSIONS = ["service", "product", "location"] as const;

export type RevenueDimension = (typeof REVENUE_DIMENSIONS)[number];

/**
 * How a bucket's money is arrived at.
 *
 * `invoice` — this invoice belongs wholly to one bucket, so the figure is what
 * was actually paid, less anything refunded. The truest number available.
 *
 * `lines` — the invoice covers several buckets, so the figure is the value of
 * the lines themselves. Discounts, shipping and tax sit on the invoice rather
 * than on any one line, so they are not spread across them; the total of a
 * `lines` report will not match the total of a revenue report, and saying so
 * is better than quietly making them agree.
 */
export type RevenueBasis = "invoice" | "lines";

export interface RevenueWindow {
  from: Date;
  to: Date;
}

export interface RevenueSource {
  dimension: RevenueDimension;
  /** Which module answers for it, so a wrong number has an owner. */
  module: string;
  basis: RevenueBasis;
  /** Locale key for the sentence saying exactly what this covers. */
  definitionKey: string;
  /**
   * `select invoice_id, bucket, amount_minor from …`, over invoices paid in
   * the window.
   *
   * `amount_minor` is ignored for an `invoice` basis — the invoice's own net
   * paid figure is used instead — and is the line value for `lines`.
   */
  rows: (window: RevenueWindow) => SQL;
}

const sources: RevenueSource[] = [];

/** A module answers for a dimension at import time; nothing else may. */
export function registerRevenueSource(source: RevenueSource): void {
  const already = sources.find(
    (each) => each.dimension === source.dimension && each.module === source.module,
  );
  if (already) {
    if (already.rows === source.rows) return;
    throw new Error(
      `module "${source.module}" registers the revenue dimension "${source.dimension}" twice`,
    );
  }
  const disagrees = sources.find(
    (each) => each.dimension === source.dimension && each.basis !== source.basis,
  );
  if (disagrees) {
    throw new Error(
      `"${source.module}" reports ${source.dimension} revenue by ${source.basis} but ` +
        `"${disagrees.module}" reports it by ${disagrees.basis}; one column cannot mean both`,
    );
  }
  sources.push(source);
}

/** Everything registered, in a stable order. */
export function revenueSources(): readonly RevenueSource[] {
  return [...sources].sort(
    (a, b) =>
      REVENUE_DIMENSIONS.indexOf(a.dimension) - REVENUE_DIMENSIONS.indexOf(b.dimension) ||
      a.module.localeCompare(b.module),
  );
}

/** The sources answering one question, or none if nothing installed does. */
export function revenueSourcesFor(dimension: RevenueDimension): readonly RevenueSource[] {
  return revenueSources().filter((each) => each.dimension === dimension);
}

/** The dimensions this instance can actually answer. */
export function availableRevenueDimensions(): readonly RevenueDimension[] {
  return REVENUE_DIMENSIONS.filter((each) => revenueSourcesFor(each).length > 0);
}

/** Test seam. Production never calls this. */
export function resetRevenueSources(): void {
  sources.length = 0;
}
