// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Deterministic built-in tax arithmetic (MASTER.md §4.12, C5.02-C5.03).

import type {
  QuotedTaxLine,
  TaxQuote,
  TaxQuoteItem,
  TaxQuoteRequest,
} from "@/adapters/tax";
import { extendMinor, roundRatio, safeMinor, subtractMinor, sumMinor } from "./money";

export interface TaxRule {
  id: string;
  name: string;
  jurisdiction: string;
  /** Integer parts per million: 99_750 = 9.975%. */
  ratePpm: number;
  compound: boolean;
  priority: number;
  appliesToShipping: boolean;
  /** Null applies to every item category. */
  categoryCode?: string;
  registrationNumber?: string;
}

export interface TaxRuleSet {
  zoneId: string;
  zoneName: string;
  pricesIncludeTax: boolean;
  roundingScope: "line" | "invoice";
  roundingMode: "half_up" | "bankers";
  rules: readonly TaxRule[];
  exemption?: { kind: string; legend: string };
}

interface TaxSubject {
  id?: string;
  kind: "item" | "shipping";
  taxableMinor: number;
  categoryCode?: string;
}

interface ExactTax {
  subject: TaxSubject;
  numerator: bigint;
  denominator: bigint;
}

function exactTax(
  taxableMinor: number,
  ratePpm: number,
  inclusive: boolean,
  inclusiveRateTotalPpm = ratePpm,
): { numerator: bigint; denominator: bigint } {
  const basis = BigInt(taxableMinor);
  const rate = BigInt(ratePpm);
  return inclusive
    ? {
        numerator: basis * rate,
        denominator: 1_000_000n + BigInt(inclusiveRateTotalPpm),
      }
    : { numerator: basis * rate, denominator: 1_000_000n };
}

function allocateInvoiceRounded(
  exact: readonly ExactTax[],
  mode: "half_up" | "bankers",
): number[] {
  if (exact.length === 0) return [];
  // All entries for one rate have the same denominator.
  const denominator = exact[0]!.denominator;
  const totalNumerator = exact.reduce((sum, row) => sum + row.numerator, 0n);
  const target = roundRatio(totalNumerator, denominator, mode);
  const floors = exact.map((row) => row.numerator / row.denominator);
  let remaining = target - floors.reduce((sum, value) => sum + value, 0n);
  const order = exact
    .map((row, index) => ({ index, remainder: row.numerator % row.denominator }))
    .sort((a, b) => {
      if (a.remainder === b.remainder) return a.index - b.index;
      return a.remainder > b.remainder ? -1 : 1;
    });
  for (const row of order) {
    if (remaining === 0n) break;
    floors[row.index] = floors[row.index]! + 1n;
    remaining -= 1n;
  }
  return floors.map((value) => safeMinor(value, "Allocated tax"));
}

function subjects(request: TaxQuoteRequest): TaxSubject[] {
  const itemSubjects = request.items.map((item: TaxQuoteItem) => ({
    id: item.id,
    kind: "item" as const,
    categoryCode: item.category,
    taxableMinor: subtractMinor(
      extendMinor(item.unitAmountMinor, item.quantityMicros),
      item.discountMinor,
      "Taxable line amount",
    ),
  }));
  return request.shippingMinor > 0
    ? [...itemSubjects, { kind: "shipping" as const, taxableMinor: request.shippingMinor }]
    : itemSubjects;
}

export function calculateTaxQuote(
  request: TaxQuoteRequest,
  ruleSet: TaxRuleSet,
): TaxQuote & { includedTaxMinor: number } {
  const taxableSubjects = subjects(request);
  if (ruleSet.exemption) {
    return {
      provider: "built_in",
      currency: request.currency,
      lines: taxableSubjects.map((subject) => ({
        ...(subject.id ? { itemId: subject.id } : {}),
        jurisdiction: ruleSet.zoneName,
        name: ruleSet.exemption!.legend,
        ratePartsPerMillion: 0,
        taxableMinor: subject.taxableMinor,
        taxMinor: 0,
        inclusive: ruleSet.pricesIncludeTax,
        compound: false,
        priority: 0,
      })),
      totalTaxMinor: 0,
      includedTaxMinor: 0,
      explanation: [ruleSet.exemption.legend],
    };
  }

  const accumulated = new Map<string, number>();
  const lines: QuotedTaxLine[] = [];
  const rules = [...ruleSet.rules].sort(
    (a, b) => a.priority - b.priority || a.name.localeCompare(b.name),
  );
  if (ruleSet.pricesIncludeTax && rules.some((rule) => rule.compound)) {
    throw new Error(
      "Compound tax with tax-inclusive source prices needs an explicit jurisdiction adapter; the built-in engine refuses an ambiguous extraction.",
    );
  }
  const applies = (rule: TaxRule, subject: TaxSubject) => {
    if (subject.kind === "shipping") return rule.appliesToShipping;
    if (rule.categoryCode) return rule.categoryCode === subject.categoryCode;
    // A category-specific row with the same named jurisdiction is an override,
    // including a zero-rate row. Do not add it on top of the generic rate.
    return !rules.some(
      (candidate) =>
        candidate.categoryCode === subject.categoryCode &&
        candidate.name === rule.name &&
        candidate.jurisdiction === rule.jurisdiction,
    );
  };
  for (const rule of rules) {
    const applicable = taxableSubjects.filter((subject) => applies(rule, subject));
    const exact = applicable.map((subject) => {
      const prior = accumulated.get(subject.id ?? "shipping") ?? 0;
      const taxableMinor = subject.taxableMinor + (rule.compound ? prior : 0);
      const inclusiveRateTotalPpm = ruleSet.pricesIncludeTax
        ? rules
            .filter((candidate) => applies(candidate, subject))
            .reduce((sum, candidate) => sum + candidate.ratePpm, 0)
        : rule.ratePpm;
      const ratio = exactTax(
        taxableMinor,
        rule.ratePpm,
        ruleSet.pricesIncludeTax,
        inclusiveRateTotalPpm,
      );
      return { subject: { ...subject, taxableMinor }, ...ratio };
    });
    const amounts =
      ruleSet.roundingScope === "invoice"
        ? allocateInvoiceRounded(exact, ruleSet.roundingMode)
        : exact.map((row) =>
            safeMinor(
              roundRatio(row.numerator, row.denominator, ruleSet.roundingMode),
              "Tax amount",
            ),
          );
    exact.forEach((row, index) => {
      const amount = amounts[index]!;
      const key = row.subject.id ?? "shipping";
      accumulated.set(key, sumMinor([accumulated.get(key) ?? 0, amount], "Accumulated tax"));
      lines.push({
        ...(row.subject.id ? { itemId: row.subject.id } : {}),
        jurisdiction: rule.jurisdiction,
        name: rule.name,
        ratePartsPerMillion: rule.ratePpm,
        taxableMinor: row.subject.taxableMinor,
        taxMinor: amount,
        inclusive: ruleSet.pricesIncludeTax,
        compound: rule.compound,
        priority: rule.priority,
      });
    });
  }
  const totalTaxMinor = sumMinor(lines.map((line) => line.taxMinor), "Total tax");
  return {
    provider: "built_in",
    currency: request.currency,
    lines,
    totalTaxMinor,
    includedTaxMinor: ruleSet.pricesIncludeTax ? totalTaxMinor : 0,
    explanation: rules.length
      ? [
          `${ruleSet.zoneName}: ${rules.map((rule) => `${rule.name} ${rule.ratePpm / 10_000}%`).join(", ")}.`,
          `${ruleSet.roundingScope} rounding using ${ruleSet.roundingMode.replace("_", " ")}.`,
          ruleSet.pricesIncludeTax ? "Displayed prices include these taxes." : "Taxes are added to displayed prices.",
        ]
      : [`${ruleSet.zoneName} has no applicable active rates.`],
  };
}
