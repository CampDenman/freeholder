// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Whether the business actually comes to an address (MASTER.md §4.18, C6.18).
//
// "Areas they named. No invented coverage." The editions say it six different
// ways and they all mean the same thing, so the interesting case here is not
// the yes or the no — it is the third answer.
//
// A radius and a list of named regions describe coverage to a *reader*.
// Neither can answer "do you come to L4C 2K1?" without a geocoder or a
// gazetteer, and this instance has neither. So for those shapes the answer is
// `unconfirmed`, never `true`: the visitor is told the business has not said
// either way and is invited to ask. A postcode list is the one shape that can
// be checked exactly, and it is checked exactly.
//
// The checkable boundary is deliberately exact, and it is worth stating as
// precisely as the code says it: a postal code is covered when, after
// normalisation (upper case, spaces and punctuation removed), it equals a
// code the owner listed — the whole code, nothing less. A code that shares a
// prefix with a listed code but differs in any character is outside. There
// is no prefix matching, no radius, no polygon, no "close enough": a florist
// who listed V9N3A1 did not list V9N3A2, and software that rounds the
// difference up to "probably fine" is answering in the owner's voice without
// being asked. An unlisted area — a radius, a region, a location the owner
// never described, a business that said nothing — never yields `covered`,
// and its silence is never treated as a `no` either: `unconfirmed` is the
// only answer an unnamed area can give, and the only answer that refuses
// nothing.
//
// The failure this avoids is specific and common. A florist configures a
// fifteen-kilometre radius, somebody two towns over orders a wedding, and the
// van does not go there — because the software answered a question it had no
// way of answering, on the business's behalf, in the business's voice.
import { z } from "zod";
import { eq } from "drizzle-orm";
import { defineService } from "@/core/service";
import { businessLocations, serviceAreas } from "./schema";

/**
 * Upper case, no spaces or punctuation.
 *
 * "l4c 2k1", "L4C2K1" and "L4C-2K1" are one postcode typed three ways, and an
 * owner who listed it one way meant all three.
 */
export function normalisePostalCode(value: string): string {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export const COVERAGE_ANSWERS = ["covered", "outside", "unconfirmed"] as const;
export type CoverageAnswer = (typeof COVERAGE_ANSWERS)[number];

/** The weekly delivery window attached to a matched area, when the owner named one. */
const deliveryWindow = z.object({
  /** 0 = Sunday, matching opening_hours.weekday and Date#getDay. */
  weekdays: z.array(z.number().int().min(0).max(6)),
  /** HH:MM, stored at second precision and read back at the authored one. */
  opens: z.string(),
  closes: z.string(),
});

export const checkCoverage = defineService({
  name: "locations.checkCoverage",
  summary: "Whether the business has said it covers this postcode.",
  kind: "query",
  permission: "public",
  input: z.object({
    postalCode: z.string().min(1).max(30),
    /** One location, or every location the business has. */
    locationId: z.string().uuid().optional(),
  }),
  output: z.object({
    answer: z.enum(COVERAGE_ANSWERS),
    /**
     * The postcode as it was matched, so a visitor sees what was checked
     * rather than wondering whether their spacing mattered.
     */
    postalCode: z.string(),
    /** Named when covered, so an owner can see which area answered. */
    locationId: z.string().uuid().nullable(),
    locationName: z.string().nullable(),
    /**
     * The matched area's weekly delivery window, when the owner attached one.
     * Null means no window was named — and no window is named silently, never
     * invented.
     */
    delivery: deliveryWindow.nullable(),
  }),
  handler: async (input, ctx) => {
    const postalCode = normalisePostalCode(input.postalCode);
    const rows = await ctx.tx
      .select({
        locationId: serviceAreas.locationId,
        locationName: businessLocations.name,
        kind: serviceAreas.kind,
        postalCodes: serviceAreas.postalCodes,
        deliveryWeekdays: serviceAreas.deliveryWeekdays,
        deliveryOpens: serviceAreas.deliveryOpens,
        deliveryCloses: serviceAreas.deliveryCloses,
      })
      .from(serviceAreas)
      .innerJoin(businessLocations, eq(businessLocations.id, serviceAreas.locationId));

    const relevant = input.locationId
      ? rows.filter((area) => area.locationId === input.locationId)
      : rows;

    const noArea = {
      answer: "unconfirmed" as const,
      postalCode,
      locationId: null,
      locationName: null,
      delivery: null,
    };

    // Nobody has described where they work. Not "outside": unknown.
    if (relevant.length === 0) {
      return noArea;
    }

    for (const area of relevant) {
      if (area.kind !== "postal_codes") continue;
      const listed = area.postalCodes.map(normalisePostalCode);
      // Exact whole-code equality — see the file header for why a shared
      // prefix is not coverage.
      if (listed.includes(postalCode)) {
        return {
          answer: "covered" as const,
          postalCode,
          locationId: area.locationId,
          locationName: area.locationName,
          delivery:
            area.deliveryWeekdays && area.deliveryOpens && area.deliveryCloses
              ? {
                  weekdays: area.deliveryWeekdays,
                  opens: area.deliveryOpens.slice(0, 5),
                  closes: area.deliveryCloses.slice(0, 5),
                }
              : null,
        };
      }
    }

    // Some area is checkable and none of them listed this postcode: that is a
    // real no, and saying so plainly is more useful than hedging.
    const checkable = relevant.some((area) => area.kind === "postal_codes");
    return checkable
      ? { answer: "outside" as const, postalCode, locationId: null, locationName: null, delivery: null }
      : noArea;
  },
});

export default [checkCoverage];
