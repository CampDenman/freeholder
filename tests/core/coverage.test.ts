// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C6.18: whether the business actually comes to an address.
//
// The interesting answer is the third one. A radius describes coverage to a
// reader and this instance has no geocoder, so asking whether an address falls
// inside one has no honest answer — and the dishonest answer is the one that
// sends a van two towns over because software said yes on the owner's behalf.
import { beforeAll, afterAll, beforeEach, describe, expect, it } from "vitest";
import { ready } from "@/core/runtime";
import { db } from "@/core/db";
import { businessLocations, serviceAreas } from "@/core/locations/schema";
import { checkCoverage, normalisePostalCode } from "@/core/locations/coverage";
import { ANONYMOUS, closeDb, hasDatabase, truncateSpine } from "../helpers/spine";

describe("postcode normalising", () => {
  it("treats one postcode typed three ways as one postcode", () => {
    expect(normalisePostalCode("l4c 2k1")).toBe("L4C2K1");
    expect(normalisePostalCode("L4C-2K1")).toBe("L4C2K1");
    expect(normalisePostalCode("L4C2K1")).toBe("L4C2K1");
  });
});

describe.runIf(hasDatabase)("service-area coverage", () => {
  beforeAll(async () => {
    await ready();
  }, 120_000);
  beforeEach(async () => {
    await truncateSpine();
  });
  afterAll(async () => {
    await closeDb();
  });

  async function location(name = "The shop") {
    const [row] = await db()
      .insert(businessLocations)
      .values({
        name,
        slug: name.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
        country: "CA",
      })
      .returning();
    return row!;
  }

  it("says yes only to a postcode the owner actually listed", async () => {
    const shop = await location();
    await db().insert(serviceAreas).values({
      locationId: shop.id,
      kind: "postal_codes",
      postalCodes: ["V9N3A1", "V9M1B2"],
    });

    const inside = await checkCoverage.call({ postalCode: "v9n 3a1" }, ANONYMOUS);
    expect(inside.answer).toBe("covered");
    expect(inside.locationName).toBe("The shop");

    const outside = await checkCoverage.call({ postalCode: "V8W 1A1" }, ANONYMOUS);
    // A real no, said plainly, because something checkable was configured.
    expect(outside.answer).toBe("outside");
  });

  it("will not guess whether an address falls inside a radius", async () => {
    const shop = await location();
    await db().insert(serviceAreas).values({
      locationId: shop.id,
      kind: "radius",
      centerLatitude: "49.687000",
      centerLongitude: "-124.996000",
      radiusKm: "15.00",
    });

    const answer = await checkCoverage.call({ postalCode: "V9N 3A1" }, ANONYMOUS);
    // Not "covered" and not "outside": the business described where it works,
    // and nothing here can turn that description into an answer about this
    // address. Saying so is the whole point.
    expect(answer.answer).toBe("unconfirmed");
  });

  it("will not guess from a named region either", async () => {
    const shop = await location();
    await db().insert(serviceAreas).values({
      locationId: shop.id,
      kind: "regions",
      regions: ["Comox Valley"],
    });
    expect((await checkCoverage.call({ postalCode: "V9N 3A1" }, ANONYMOUS)).answer).toBe(
      "unconfirmed",
    );
  });

  it("treats saying nothing as unknown, never as no", async () => {
    await location();
    const answer = await checkCoverage.call({ postalCode: "V9N 3A1" }, ANONYMOUS);
    expect(answer.answer).toBe("unconfirmed");
  });

  it("answers for one location when asked about one", async () => {
    const first = await location("Courtenay");
    const second = await location("Nanaimo");
    await db().insert(serviceAreas).values({
      locationId: first.id,
      kind: "postal_codes",
      postalCodes: ["V9N3A1"],
    });
    await db().insert(serviceAreas).values({
      locationId: second.id,
      kind: "postal_codes",
      postalCodes: ["V9R1A1"],
    });

    const anywhere = await checkCoverage.call({ postalCode: "V9R 1A1" }, ANONYMOUS);
    expect(anywhere.answer).toBe("covered");
    expect(anywhere.locationName).toBe("Nanaimo");

    const justCourtenay = await checkCoverage.call(
      { postalCode: "V9R 1A1", locationId: first.id },
      ANONYMOUS,
    );
    expect(justCourtenay.answer).toBe("outside");
  });
});
