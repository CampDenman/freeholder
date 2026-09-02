// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Which ad fills the hole (MASTER.md §4.16, C9.18).
//
// `targeting.ts` (C9.17) answers "may this line item run here, now, for this
// visitor". This answers the question after it: several may, so which one
// does, and with which creative — and, when none may, whether the owner's own
// promotion fills the space rather than leaving a hole.
//
// Pure, for the same reason targeting is. Choosing between two advertisers is
// the part an advertiser disputes, and "the higher-priority campaign won"
// needs to be a sentence somebody can check against a test rather than a
// query somebody has to reason about. The randomness is passed in, so even
// the rotation is reproducible here.
import {
  matchesTargeting,
  withinDaypart,
  withinFlight,
  type Dayparting,
  type ServeContext,
  type Targeting,
} from "./targeting";
import { withinFrequency, withinPace, type Pacing } from "./pacing";

export type Breakpoint = "desktop" | "tablet" | "mobile";

/** One shape a slot has declared for one breakpoint. */
export interface DeclaredSize {
  width: number;
  height: number;
}

export interface CandidateCreative {
  id: string;
  kind: "image" | "native" | "html_tag" | "provider";
  assetId: string | null;
  width: number;
  height: number;
  clickUrl: string;
  altText: string | null;
  headline: string | null;
  body: string | null;
  ctaLabel: string | null;
  tagHtml?: string | null;
  provider?: unknown;
}

/** A line item, its campaign's terms, and the artwork it may run. */
export interface Candidate {
  lineItemId: string;
  campaignId: string;
  /** House inventory is the owner's own, and fills only what nobody bought. */
  house: boolean;
  priority: number;
  weight: number;
  startsAt: Date | null;
  endsAt: Date | null;
  targeting: Targeting;
  dayparting: Dayparting;
  creatives: CandidateCreative[];
  pacing?: Pacing;
  goalImpressions?: number | null;
  deliveredImpressions?: number;
  budgetCents?: number | null;
  spentCents?: number;
  frequencyCap?: number | null;
  visitorImpressions?: number;
}

export interface Fill {
  candidate: Candidate;
  creative: CandidateCreative;
}

/**
 * The slot's clock, in the business's timezone.
 *
 * §4.16's dayparting is the owner's trading hours, not UTC's: a sponsor who
 * bought weekday mornings bought them where the business is. `Intl` rather
 * than arithmetic on an offset, because an offset is wrong twice a year.
 */
export function zonedClock(
  now: Date,
  timezone: string,
): { minuteOfDay: number; dayOfWeek: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hourCycle: "h23",
    hour: "2-digit",
    minute: "2-digit",
    weekday: "short",
  }).formatToParts(now);
  const value = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const dayOfWeek = days.indexOf(value("weekday"));
  return {
    minuteOfDay: Number(value("hour")) * 60 + Number(value("minute")),
    // An unrecognised weekday would silently exclude every daypart, so fall
    // back to UTC's rather than to -1.
    dayOfWeek: dayOfWeek >= 0 ? dayOfWeek : now.getUTCDay(),
  };
}

/** Every creative whose size the slot declared for this breakpoint. */
export function creativesThatFit(
  candidate: Candidate,
  sizes: DeclaredSize[],
): CandidateCreative[] {
  return candidate.creatives.filter((creative) =>
    sizes.some((size) => size.width === creative.width && size.height === creative.height),
  );
}

/**
 * Eligible means every C9.17 rule holds *and* there is artwork that fits.
 *
 * The second half matters more than it looks. A line item with only a 728×90
 * cannot fill a phone's 320×50, and treating it as eligible anyway would give
 * the visitor an empty box while the owner's house promotion — which does have
 * a 320×50 — sat unused. So "cannot fit" removes the candidate rather than
 * ending the auction.
 */
function eligible(
  candidate: Candidate,
  sizes: DeclaredSize[],
  ctx: ServeContext,
  now: Date,
): Fill[] {
  if (!withinFlight(candidate.startsAt, candidate.endsAt, now)) return [];
  if (!matchesTargeting(candidate.targeting, ctx)) return [];
  if (!withinDaypart(candidate.dayparting, ctx)) return [];
  if (
    !withinPace({
      pacing: candidate.pacing ?? "asap",
      startsAt: candidate.startsAt,
      endsAt: candidate.endsAt,
      now,
      goal: candidate.goalImpressions ?? null,
      delivered: candidate.deliveredImpressions ?? 0,
      budgetCents: candidate.budgetCents ?? null,
      spentCents: candidate.spentCents ?? 0,
    })
  ) {
    return [];
  }
  if (!withinFrequency(candidate.frequencyCap ?? null, candidate.visitorImpressions ?? 0)) {
    return [];
  }
  return creativesThatFit(candidate, sizes).map((creative) => ({ candidate, creative }));
}

/**
 * Weighted choice among equals.
 *
 * `roll` is a number in [0, 1) supplied by the caller. §4.16 gives a line item
 * a "relative share among equal-priority line items", and a share is only
 * honest if it is actually proportional — two line items at weights 3 and 1
 * must run three times as often, not alternate.
 */
function weighted(options: Fill[], roll: number): Fill | null {
  if (options.length === 0) return null;
  const total = options.reduce((sum, option) => sum + Math.max(1, option.candidate.weight), 0);
  let cursor = Math.min(Math.max(roll, 0), 0.999999) * total;
  for (const option of options) {
    cursor -= Math.max(1, option.candidate.weight);
    if (cursor < 0) return option;
  }
  return options[options.length - 1]!;
}

/** Only the best-priority tier competes; the rest are not in this auction. */
function topTier(options: Fill[]): Fill[] {
  if (options.length === 0) return [];
  const best = Math.max(...options.map((option) => option.candidate.priority));
  return options.filter((option) => option.candidate.priority === best);
}

/**
 * What runs in this slot, at this breakpoint, right now.
 *
 * Sold inventory first, always. §4.16's `allow_house_fill` "means unsold
 * inventory shows the owner's own campaign rather than a hole" — *unsold*,
 * which makes house the fallback and never the competitor. A house promotion
 * that outbid a paying advertiser because somebody typed a high priority on it
 * would be the owner quietly not delivering a campaign they invoiced.
 */
export function chooseFill(
  candidates: Candidate[],
  sizes: DeclaredSize[],
  ctx: ServeContext,
  options: { now: Date; allowHouseFill: boolean; roll: number; creativeRoll: number },
): Fill | null {
  const runnable = candidates.flatMap((candidate) =>
    eligible(candidate, sizes, ctx, options.now),
  );

  const sold = runnable.filter((option) => !option.candidate.house);
  const chosen =
    pickOne(sold, options) ??
    (options.allowHouseFill
      ? pickOne(
          runnable.filter((option) => option.candidate.house),
          options,
        )
      : null);
  return chosen;
}

/**
 * One line item, then one of its creatives.
 *
 * Two rolls rather than one flat draw over every (line item, creative) pair,
 * because a pair-wise draw would give a line item with four creatives four
 * times the delivery of one with a single creative — which is not what an
 * advertiser bought when they supplied more artwork.
 */
function pickOne(
  options: Fill[],
  { roll, creativeRoll }: { roll: number; creativeRoll: number },
): Fill | null {
  const byLineItem = new Map<string, Fill[]>();
  for (const option of options) {
    byLineItem.set(option.candidate.lineItemId, [
      ...(byLineItem.get(option.candidate.lineItemId) ?? []),
      option,
    ]);
  }
  const oneEach = [...byLineItem.values()].map((group) => group[0]!);
  const winner = weighted(topTier(oneEach), roll);
  if (!winner) return null;

  const artwork = byLineItem.get(winner.candidate.lineItemId)!;
  const index = Math.min(Math.floor(creativeRoll * artwork.length), artwork.length - 1);
  return artwork[index] ?? winner;
}
