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
import { t } from "@/core/i18n";
import { businessLocations, serviceAreas } from "@/core/locations/schema";
import { checkCoverage, normalisePostalCode } from "@/core/locations/coverage";
import { getLocation, setServiceArea } from "@/core/locations/service";
import { violates } from "@/core/db/errors";
import {
  ANONYMOUS,
  closeDb,
  failure,
  hasDatabase,
  OWNER,
  truncateSpine,
} from "../helpers/spine";

describe("postcode normalising", () => {
  it("treats one postcode typed three ways as one postcode", () => {
    expect(normalisePostalCode("l4c 2k1")).toBe("L4C2K1");
    expect(normalisePostalCode("L4C-2K1")).toBe("L4C2K1");
    expect(normalisePostalCode("L4C2K1")).toBe("L4C2K1");
  });
});

/**
 * The visitor-facing refusal and the delivery-window line are catalog text,
 * rendered by the coverage block through `t`. Rendering them in every shipped
 * locale here is what proves the refusal is localized rather than merely
 * translatable — the i18n gate proves the keys exist; this proves they read.
 */
describe("localized coverage answers", () => {
  it("renders the refusal wording in every shipped locale", () => {
    const english = t("en", "cms.coverage.outside", { postcode: "V9N3A2" });
    for (const locale of ["en", "fr", "es", "ar"]) {
      const rendered = t(locale, "cms.coverage.outside", { postcode: "V9N3A2" });
      // The visitor's own postcode is interpolated, never swallowed by ICU.
      expect(rendered).toContain("V9N3A2");
      if (locale !== "en") expect(rendered).not.toBe(english);
    }
  });

  it("renders the delivery-window line in every shipped locale", () => {
    for (const locale of ["en", "fr", "es", "ar"]) {
      const rendered = t(locale, "cms.coverage.delivery", {
        window: "Tuesdays and Thursdays, 09:00–17:00",
      });
      expect(rendered).toContain("Tuesdays and Thursdays, 09:00–17:00");
    }
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

  /**
   * The boundary is exact whole-code equality (see coverage.ts). A code that
   * shares a prefix — even every character but the last — with a listed code
   * is outside. "Close enough" is the invented coverage §4.18 forbids.
   */
  it("treats a code one character off a listed code as outside, not as covered", async () => {
    const shop = await location();
    await db().insert(serviceAreas).values({
      locationId: shop.id,
      kind: "postal_codes",
      postalCodes: ["V9N3A1"],
    });

    // Same forward sortation area (V9N), different last digit: not listed.
    const neighbour = await checkCoverage.call({ postalCode: "V9N 3A2" }, ANONYMOUS);
    expect(neighbour.answer).toBe("outside");
    expect(neighbour.locationId).toBeNull();

    // Same last digit, different area: equally not listed.
    const otherSide = await checkCoverage.call({ postalCode: "V9M 3A1" }, ANONYMOUS);
    expect(otherSide.answer).toBe("outside");

    // And the listed code stays covered — the boundary cuts both ways.
    expect((await checkCoverage.call({ postalCode: "V9N3A1" }, ANONYMOUS)).answer).toBe(
      "covered",
    );
  });

  it("carries the area's delivery window in the covered answer", async () => {
    const shop = await location("The van");
    await db().insert(serviceAreas).values({
      locationId: shop.id,
      kind: "postal_codes",
      postalCodes: ["V9N3A1"],
      deliveryWeekdays: [2, 4],
      deliveryOpens: "09:00:00",
      deliveryCloses: "17:00:00",
    });

    const answer = await checkCoverage.call({ postalCode: "v9n 3a1" }, ANONYMOUS);
    expect(answer.answer).toBe("covered");
    expect(answer.delivery).toEqual({ weekdays: [2, 4], opens: "09:00", closes: "17:00" });
  });

  it("answers no delivery window when the owner named none", async () => {
    const shop = await location();
    await db().insert(serviceAreas).values({
      locationId: shop.id,
      kind: "postal_codes",
      postalCodes: ["V9N3A1"],
    });

    const answer = await checkCoverage.call({ postalCode: "V9N3A1" }, ANONYMOUS);
    expect(answer.answer).toBe("covered");
    expect(answer.delivery).toBeNull();
  });

  it("saves and clears a delivery window through setServiceArea", async () => {
    const shop = await location();
    await setServiceArea.call(
      {
        locationId: shop.id,
        area: { kind: "postal_codes", postalCodes: ["V9N 3A1"] },
        delivery: { weekdays: [2, 4], opens: "09:00", closes: "17:00" },
      },
      OWNER,
    );

    const withWindow = await getLocation.call({ id: shop.id }, ANONYMOUS);
    expect(withWindow?.serviceArea?.postalCodes).toEqual(["V9N3A1"]);
    expect(withWindow?.serviceArea?.deliveryWeekdays).toEqual([2, 4]);
    expect(withWindow?.serviceArea?.deliveryOpens).toBe("09:00:00");

    const answer = await checkCoverage.call({ postalCode: "V9N3A1" }, ANONYMOUS);
    expect(answer.delivery).toEqual({ weekdays: [2, 4], opens: "09:00", closes: "17:00" });

    // Saving the area again without a delivery clears it — an edited fact
    // replaces the whole fact, it does not linger half-said.
    await setServiceArea.call(
      {
        locationId: shop.id,
        area: { kind: "postal_codes", postalCodes: ["V9N 3A1"] },
      },
      OWNER,
    );
    const withoutWindow = await getLocation.call({ id: shop.id }, ANONYMOUS);
    expect(withoutWindow?.serviceArea?.deliveryWeekdays).toBeNull();
    expect(
      (await checkCoverage.call({ postalCode: "V9N3A1" }, ANONYMOUS)).delivery,
    ).toBeNull();
  });

  it("refuses a delivery window that closes before it opens, or names no day", async () => {
    const shop = await location();
    const closed = await failure(
      setServiceArea.call(
        {
          locationId: shop.id,
          area: { kind: "postal_codes", postalCodes: ["V9N3A1"] },
          delivery: { weekdays: [2], opens: "17:00", closes: "09:00" },
        },
        OWNER,
      ),
    );
    expect(closed.code).toBe("validation");

    const noDays = await failure(
      setServiceArea.call(
        {
          locationId: shop.id,
          area: { kind: "postal_codes", postalCodes: ["V9N3A1"] },
          delivery: { weekdays: [], opens: "09:00", closes: "17:00" },
        },
        OWNER,
      ),
    );
    expect(noDays.code).toBe("validation");

    // Neither refusal wrote anything.
    expect(await getLocation.call({ id: shop.id }, ANONYMOUS)).toMatchObject({
      serviceArea: null,
    });
  });

  /**
   * The database itself refuses a half-stated window, because a rule only the
   * service checks is one a second writer, a retry or a future caller can
   * miss (MASTER.md §2 principle 12's enforcement habit).
   */
  it("the table constraint refuses times without days", async () => {
    const shop = await location();
    const error: unknown = await db()
      .insert(serviceAreas)
      .values({
        locationId: shop.id,
        kind: "postal_codes",
        postalCodes: ["V9N3A1"],
        deliveryOpens: "09:00",
        deliveryCloses: "17:00",
      })
      .then(
        () => null,
        (cause: unknown) => cause,
      );
    expect(error).not.toBeNull();
    expect(violates(error, "service_areas_delivery_window")).toBe(true);
  });
});
