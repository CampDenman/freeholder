// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Deterministic shipping quotes (MASTER.md §4.11, C5.18).
//
// No carrier calls. A calculated method is skipped until an adapter exists.
// Dimensional weight uses the 5000 divisor on millimetres → grams.

import type { SHIPPING_METHOD_KINDS } from "./contract";

export interface QuoteItem {
  quantity: number;
  weightG: number;
  priceMinor: number;
  lengthMm?: number | null;
  widthMm?: number | null;
  heightMm?: number | null;
  requiresShipping?: boolean;
}

export interface QuoteZone {
  id: string;
  name: string;
  countries: string[];
  regions: string[];
  postalPatterns: string[];
  priority: number;
}

export interface QuoteBand {
  minValue: number;
  maxValue: number | null;
  amountMinor: number;
  perUnitMinor: number;
}

export interface QuoteMethod {
  id: string;
  zoneId: string;
  name: string;
  kind: (typeof SHIPPING_METHOD_KINDS)[number];
  handlingFeeMinor: number;
  amountMinor: number | null;
  thresholdMinor: number | null;
  locationId: string | null;
  minDays: number | null;
  maxDays: number | null;
  bands: QuoteBand[];
}

export interface QuoteBox {
  id: string;
  name: string;
  innerLengthMm: number;
  innerWidthMm: number;
  innerHeightMm: number;
  maxWeightG: number;
  tareWeightG: number;
}

export interface ShippingQuote {
  methodId: string;
  name: string;
  kind: QuoteMethod["kind"];
  amountMinor: number;
  currency: string;
  minDays: number | null;
  maxDays: number | null;
  billableWeightG: number;
  boxId: string | null;
}

function shippable(items: QuoteItem[]): QuoteItem[] {
  return items.filter((item) => item.requiresShipping !== false && item.quantity > 0);
}

export function dimensionalWeightG(item: QuoteItem): number {
  if (!item.lengthMm || !item.widthMm || !item.heightMm) return item.weightG * item.quantity;
  return Math.ceil((item.lengthMm * item.widthMm * item.heightMm) / 5_000) * item.quantity;
}

export function totals(items: QuoteItem[]) {
  const rows = shippable(items);
  return {
    quantity: rows.reduce((sum, item) => sum + item.quantity, 0),
    weightG: rows.reduce((sum, item) => sum + item.weightG * item.quantity, 0),
    volumeWeightG: rows.reduce((sum, item) => sum + dimensionalWeightG(item), 0),
    subtotalMinor: rows.reduce((sum, item) => sum + item.priceMinor * item.quantity, 0),
  };
}

export function selectBox(items: QuoteItem[], boxes: QuoteBox[]): QuoteBox | null {
  const packed = totals(items);
  const volume = shippable(items).reduce((sum, item) => {
    if (!item.lengthMm || !item.widthMm || !item.heightMm) return sum;
    return sum + item.lengthMm * item.widthMm * item.heightMm * item.quantity;
  }, 0);
  const fits = boxes
    .filter((box) => packed.weightG + box.tareWeightG <= box.maxWeightG)
    .filter((box) => {
      const inner = box.innerLengthMm * box.innerWidthMm * box.innerHeightMm;
      return volume === 0 || volume <= inner;
    })
    .sort(
      (a, b) =>
        a.innerLengthMm * a.innerWidthMm * a.innerHeightMm -
        b.innerLengthMm * b.innerWidthMm * b.innerHeightMm,
    );
  return fits[0] ?? null;
}

export function matchZone(
  destination: { country: string; region?: string | null; postal?: string | null },
  zones: QuoteZone[],
): QuoteZone | null {
  const country = destination.country.toUpperCase();
  const region = destination.region?.toUpperCase() ?? "";
  const postal = destination.postal?.replace(/\s+/g, "").toUpperCase() ?? "";
  let best: { zone: QuoteZone; score: number } | null = null;
  for (const zone of zones) {
    const countries = zone.countries.map((value) => value.toUpperCase());
    const regions = zone.regions.map((value) => value.toUpperCase());
    const patterns = zone.postalPatterns;
    const postalHit =
      postal.length > 0 &&
      patterns.some((pattern) => {
        try {
          return new RegExp(pattern, "i").test(postal);
        } catch {
          return postal.startsWith(pattern.replace(/\s+/g, "").toUpperCase());
        }
      });
    const regionHit = region.length > 0 && regions.includes(region);
    const countryHit = countries.includes(country);
    const catchAll = countries.length === 0 && regions.length === 0 && patterns.length === 0;
    let score = -1;
    if (postalHit) score = 300 + zone.priority;
    else if (regionHit) score = 200 + zone.priority;
    else if (countryHit) score = 100 + zone.priority;
    else if (catchAll) score = zone.priority;
    if (score < 0) continue;
    if (!best || score > best.score) best = { zone, score };
  }
  return best?.zone ?? null;
}

function bandAmount(value: number, bands: QuoteBand[]): number | null {
  const band = bands.find((row) => value >= row.minValue && (row.maxValue == null || value <= row.maxValue));
  if (!band) return null;
  return band.amountMinor + band.perUnitMinor * value;
}

export function quoteMethods(input: {
  destination: { country: string; region?: string | null; postal?: string | null };
  currency: string;
  locationId?: string | null;
  items: QuoteItem[];
  zones: QuoteZone[];
  methods: QuoteMethod[];
  boxes: QuoteBox[];
}): { needed: boolean; zoneId: string | null; quotes: ShippingQuote[] } {
  const packed = totals(input.items);
  if (packed.quantity === 0) return { needed: false, zoneId: null, quotes: [] };
  const zone = matchZone(input.destination, input.zones);
  if (!zone) return { needed: true, zoneId: null, quotes: [] };
  const box = selectBox(input.items, input.boxes);
  const billableWeightG = Math.max(packed.weightG, packed.volumeWeightG) + (box?.tareWeightG ?? 0);
  const quotes: ShippingQuote[] = [];
  for (const method of input.methods.filter((row) => row.zoneId === zone.id)) {
    let amount: number | null = null;
    if (method.kind === "pickup") {
      if (!method.locationId || method.locationId !== input.locationId) continue;
      amount = 0;
    } else if (method.kind === "local_delivery") {
      if (!method.locationId || method.locationId !== input.locationId) continue;
      amount = method.amountMinor ?? 0;
    } else if (method.kind === "free") {
      if (method.thresholdMinor == null || packed.subtotalMinor < method.thresholdMinor) continue;
      amount = 0;
    } else if (method.kind === "flat") {
      amount = method.amountMinor ?? 0;
    } else if (method.kind === "weight" || method.kind === "dimensional") {
      amount = bandAmount(billableWeightG, method.bands);
    } else if (method.kind === "price") {
      amount = bandAmount(packed.subtotalMinor, method.bands);
    } else if (method.kind === "item") {
      amount = bandAmount(packed.quantity, method.bands);
    } else {
      continue;
    }
    if (amount == null) continue;
    const total = amount + (method.kind === "free" || method.kind === "pickup" ? 0 : method.handlingFeeMinor);
    quotes.push({
      methodId: method.id,
      name: method.name,
      kind: method.kind,
      amountMinor: total,
      currency: input.currency,
      minDays: method.minDays,
      maxDays: method.maxDays,
      billableWeightG,
      boxId: box?.id ?? null,
    });
  }
  return { needed: true, zoneId: zone.id, quotes };
}
