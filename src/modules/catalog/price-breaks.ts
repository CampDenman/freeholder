// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Volume vs tiered unit-price arithmetic (C5.14). Pure so property tests
// do not need a database.

import { ServiceError } from "@/core/service";
import { assertPositiveMinor, safeMinor } from "@/modules/invoicing/money";

export interface PriceBand {
  readonly minQty: number;
  readonly maxQty: number | null;
  readonly unitAmountMinor: number | null;
  readonly percentOffPpm: number | null;
}

export interface BreakResult {
  readonly totalMinor: number;
  readonly breakdown: ReadonlyArray<{ qty: number; unitMinor: number }>;
  readonly explanation: string;
}

function assertQty(value: number): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new ServiceError("validation", "Quantity must be a positive whole number of units.");
  }
  return value;
}

export function unitFromBand(baseUnitMinor: number, band: PriceBand): number {
  if (band.unitAmountMinor !== null) return assertPositiveMinor(band.unitAmountMinor, "Break unit price");
  if (band.percentOffPpm === null) {
    throw new ServiceError("validation", "A price break needs a unit price or a percent off.");
  }
  return safeMinor(
    (BigInt(assertPositiveMinor(baseUnitMinor, "List unit price")) *
      BigInt(1_000_000 - band.percentOffPpm)) /
      1_000_000n,
    "Percent-off unit price",
  );
}

export function sortBands(bands: readonly PriceBand[]): PriceBand[] {
  return [...bands].sort((left, right) => left.minQty - right.minQty || (left.maxQty ?? 1_000_000_000) - (right.maxQty ?? 1_000_000_000));
}

export function assertBands(bands: readonly PriceBand[]): PriceBand[] {
  const sorted = sortBands(bands);
  for (let index = 0; index < sorted.length; index += 1) {
    const band = sorted[index]!;
    if (!Number.isSafeInteger(band.minQty) || band.minQty <= 0) {
      throw new ServiceError("validation", "A price break must start at a positive quantity.");
    }
    if (band.maxQty !== null && band.maxQty < band.minQty) {
      throw new ServiceError("validation", "A price break cannot end before it starts.");
    }
    const previous = sorted[index - 1];
    if (previous && (previous.maxQty === null || previous.maxQty >= band.minQty)) {
      throw new ServiceError("validation", "Price-break quantities cannot overlap.");
    }
  }
  return sorted;
}

function matchingVolumeBand(bands: readonly PriceBand[], quantity: number): PriceBand | undefined {
  return [...assertBands(bands)]
    .reverse()
    .find((band) => quantity >= band.minQty && (band.maxQty === null || quantity <= band.maxQty));
}

export function applyVolumeBreaks(
  baseUnitMinor: number,
  quantity: number,
  bands: readonly PriceBand[],
): BreakResult {
  const qty = assertQty(quantity);
  const band = matchingVolumeBand(bands, qty);
  const unitMinor = band ? unitFromBand(baseUnitMinor, band) : assertPositiveMinor(baseUnitMinor, "List unit price");
  const totalMinor = safeMinor(BigInt(unitMinor) * BigInt(qty), "Volume total");
  return {
    totalMinor,
    breakdown: [{ qty, unitMinor }],
    explanation: band
      ? `Volume pricing charges every unit at the ${band.minQty}+ rate.`
      : "No volume band matches this quantity, so the list unit price applies to every unit.",
  };
}

export function applyTieredBreaks(
  baseUnitMinor: number,
  quantity: number,
  bands: readonly PriceBand[],
): BreakResult {
  const qty = assertQty(quantity);
  const sorted = assertBands(bands);
  if (sorted.length === 0) {
    const unitMinor = assertPositiveMinor(baseUnitMinor, "List unit price");
    return {
      totalMinor: safeMinor(BigInt(unitMinor) * BigInt(qty), "Tiered total"),
      breakdown: [{ qty, unitMinor }],
      explanation: "No tiered bands are configured, so the list unit price applies to every unit.",
    };
  }
  if (sorted[0]!.minQty !== 1) {
    throw new ServiceError("validation", "Tiered pricing must include a band that starts at quantity 1.");
  }
  const breakdown: Array<{ qty: number; unitMinor: number }> = [];
  let remaining = qty;
  let cursor = 1;
  for (const band of sorted) {
    if (remaining <= 0) break;
    if (band.minQty > cursor) {
      throw new ServiceError("validation", "Tiered price breaks cannot leave a quantity gap.");
    }
    const last = band.maxQty ?? qty;
    const take = Math.min(remaining, last - cursor + 1);
    if (take <= 0) continue;
    breakdown.push({ qty: take, unitMinor: unitFromBand(baseUnitMinor, band) });
    remaining -= take;
    cursor += take;
  }
  if (remaining > 0) {
    throw new ServiceError("validation", "Tiered price breaks do not cover this quantity.");
  }
  const totalMinor = safeMinor(
    breakdown.reduce((sum, row) => sum + BigInt(row.unitMinor) * BigInt(row.qty), 0n),
    "Tiered total",
  );
  return {
    totalMinor,
    breakdown,
    explanation: "Tiered pricing charges each quantity band at its own unit rate.",
  };
}

export function applyPriceBreaks(
  mode: "volume" | "tiered",
  baseUnitMinor: number,
  quantity: number,
  bands: readonly PriceBand[],
): BreakResult {
  return mode === "volume"
    ? applyVolumeBreaks(baseUnitMinor, quantity, bands)
    : applyTieredBreaks(baseUnitMinor, quantity, bands);
}
