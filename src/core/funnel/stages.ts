// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// The funnel, as a thing modules contribute to (MASTER.md §4.7, §43 C9.07).
//
// §4.7 states the whole design in one line: "Funnel = `AnalyticsEvent` joined
// through `contact_id` to money tables. Visit → lead → quote → paid, one
// query." The part that needs care is *which* money tables, because the answer
// depends on what this business has switched on: a photographer sells through
// quotes and invoices, a shop through carts and orders, a clinic through
// bookings. A funnel that named them all would break the moment a module was
// toggled off, and one that named none would be a chart of pageviews.
//
// So the bands are core's — the shape of a funnel is a product decision, and a
// module inventing its own stage order would give the business two different
// funnels — and the stages inside them are the modules'. A module that is not
// installed never imports, so its stage simply is not there, and nothing has
// to ask whether it should be.
//
// Every stage carries its own definition in plain English. That is not
// decoration: C9.07 asks for the query definitions to be *inspectable*,
// because a number an owner cannot interrogate is a number they are entitled
// to disbelieve, and "leads" is exactly the sort of word two tools define
// differently and neither says so.
import type { SQL } from "drizzle-orm";

/**
 * The bands, in the order a customer moves through them.
 *
 * `returned` sits at the end but is not a step: a refund is what happens
 * *after* the funnel, and drawing it as a sixth stage would suggest a business
 * wants people to reach it.
 */
export const FUNNEL_BANDS = [
  "visit",
  "lead",
  "interest",
  "committed",
  "paid",
  "returned",
] as const;

export type FunnelBand = (typeof FUNNEL_BANDS)[number];

/** The period a funnel question is asked about. Half-open: `from` ≤ at < `to`. */
export interface FunnelWindow {
  from: Date;
  to: Date;
}

export interface FunnelStage {
  /** Stable, dotted-free identifier: "quote", "cart", "invoice". */
  key: string;
  /** Which module answers for it, so a wrong number has an owner. */
  module: string;
  band: FunnelBand;
  /** Locale key for the stage's name, e.g. `funnel.stage.quote`. */
  labelKey: string;
  /**
   * Locale key for the sentence that says exactly what is counted.
   *
   * Written for the owner, not for the reviewer: "people who were sent a
   * quote", not "rows in quotes where sent_at is not null".
   */
  definitionKey: string;
  /**
   * `select <person key> from …` restricted to the window.
   *
   * A **person key** is `contact_id::text` where the person is known, and
   * `'anon:' || anon_id` where they are not — one namespace, so a visitor who
   * identifies later counts as the same person they always were rather than
   * as two. Duplicates are fine; the funnel counts distinct.
   */
  people: (window: FunnelWindow) => SQL;
}

const stages = new Map<string, FunnelStage>();

/** A module claims a stage at import time; nothing else may. */
export function registerFunnelStage(stage: FunnelStage): void {
  const existing = stages.get(stage.key);
  if (existing && existing.people !== stage.people) {
    throw new Error(
      `two modules both register the funnel stage "${stage.key}"; one of them is wrong`,
    );
  }
  stages.set(stage.key, stage);
}

/** Every registered stage, in funnel order and then alphabetically within a band. */
export function funnelStages(): readonly FunnelStage[] {
  return [...stages.values()].sort(
    (a, b) =>
      FUNNEL_BANDS.indexOf(a.band) - FUNNEL_BANDS.indexOf(b.band) ||
      a.key.localeCompare(b.key),
  );
}

/** The stages in one band, or none if nothing installed answers for it. */
export function funnelBandStages(band: FunnelBand): readonly FunnelStage[] {
  return funnelStages().filter((stage) => stage.band === band);
}

/** Test seam. Production never calls this. */
export function resetFunnelStages(): void {
  stages.clear();
}
