// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: AGPL-3.0-only
// Locations and NAP (MASTER.md §4.10).
//
// §4.10 rests on one claim — "the render helper is the only way to output NAP,
// so it *can't* drift" — and a claim like that is only worth what a test can
// hold it to. So the tests here are mostly about consistency between surfaces
// rather than about any surface being right in isolation: the visible address
// and the structured one come from the same call, or the whole rationale for
// the helper existing is gone.
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/core/db";
import { businessLocations, openingHours } from "@/core/locations/schema";
import {
  createLocationService,
  deleteLocation,
  getLocation,
  listLocations,
  primaryLocation,
  setOpeningHours,
  setPrimaryLocation,
  setServiceArea,
  updateLocation,
} from "@/core/locations/service";
import { postalAddress, renderNAP, telHref } from "@/core/locations/nap";
import {
  areaServedJsonLd,
  localBusinessJsonLd,
  openingHoursJsonLd,
  type OpeningHoursRow,
} from "@/core/locations/jsonld";
import { resolveRedirect } from "@/core/seo/service";
import type { LocationRow } from "@/core/locations/nap";
import {
  ANONYMOUS,
  closeDb,
  failure,
  hasDatabase,
  OWNER,
  STAFF,
  truncateSpine,
} from "../helpers/spine";

/** A row as the database would hand one back, for the pure builders. */
function row(overrides: Partial<LocationRow> = {}): LocationRow {
  return {
    id: "00000000-0000-4000-8000-00000000000a",
    name: "Aurora Coast Photography",
    slug: "courtenay",
    isPrimary: true,
    schemaType: null,
    street: "210 Fifth Street",
    unit: "Unit 3",
    city: "Courtenay",
    region: "BC",
    postalCode: "V9N 1A1",
    country: "CA",
    latitude: "49.687000",
    longitude: "-124.993000",
    phone: "+1 (250) 555-0100",
    email: "hello@example.test",
    googleBusinessProfileUrl: null,
    sameAs: [],
    priceRange: null,
    timezone: null,
    status: "visible",
    createdAt: new Date(0),
    updatedAt: new Date(0),
    ...overrides,
  };
}

const CANADIAN = {
  name: "Aurora Coast Photography",
  slug: "courtenay",
  street: "210 Fifth Street",
  city: "Courtenay",
  region: "BC",
  postalCode: "V9N 1A1",
  country: "CA",
};

describe("rendering NAP", () => {
  it("writes a North American address the way North America writes one", () => {
    const nap = renderNAP(row());
    expect(nap.addressLines).toEqual([
      "210 Fifth Street, Unit 3",
      "Courtenay, BC V9N 1A1",
    ]);
  });

  it("puts the postcode before the town where that is the convention", () => {
    // A French address rendered American is a different business as far as a
    // directory comparison is concerned.
    const nap = renderNAP(
      row({
        street: "12 rue de Rivoli",
        unit: null,
        city: "Paris",
        region: null,
        postalCode: "75001",
        country: "FR",
      }),
    );
    expect(nap.addressLines).toEqual(["12 rue de Rivoli", "75001 Paris"]);
  });

  it("gives a UK postcode its own line", () => {
    const nap = renderNAP(
      row({
        street: "221B Baker Street",
        unit: null,
        city: "London",
        region: null,
        postalCode: "NW1 6XE",
        country: "GB",
      }),
    );
    expect(nap.addressLines).toEqual(["221B Baker Street", "London", "NW1 6XE"]);
  });

  it("shows no address at all for a business that travels to you", () => {
    // §4.10: a go-to-customer business shows "no storefront address". Not a
    // partial one — a city with no street is still an invitation to arrive.
    const nap = renderNAP(row(), { hideAddress: true });
    expect(nap.addressLines).toEqual([]);
    expect(nap.addressLine).toBe("");
    // The phone is the point of the block for that business, so it stays.
    expect(nap.phone).toBe("+1 (250) 555-0100");
  });

  it("leaves the phone number exactly as it was typed", () => {
    // The displayed string is what gets compared against a directory listing.
    // Normalising it for tidiness is the drift §4.10 is about.
    const nap = renderNAP(row({ phone: "(250) 555-0100" }));
    expect(nap.phone).toBe("(250) 555-0100");
    expect(nap.phoneHref).toBe("tel:2505550100");
  });

  it("keeps a leading + and drops everything else from a tel: link", () => {
    expect(telHref("+1 250-555-0100")).toBe("tel:+12505550100");
    expect(telHref("250.555.0100")).toBe("tel:2505550100");
    expect(telHref(null)).toBeNull();
    expect(telHref("call us")).toBeNull();
  });

  it("skips an address made of nothing but a country", () => {
    // Emitting `addressCountry: CA` alone tells a crawler this business is
    // somewhere in Canada, which is worse than saying nothing.
    const bare = row({ street: null, unit: null, city: null, region: null, postalCode: null });
    expect(postalAddress(bare)).toBeUndefined();
  });
});

describe("the visible address and the structured one", () => {
  it("are built from the same parts, so they cannot disagree", () => {
    // The whole reason §4.10 insists on one render helper. If this ever fails,
    // the site is telling a visitor and a crawler two different addresses.
    const location = row();
    const nap = renderNAP(location);
    const address = postalAddress(location)!;

    expect(address.streetAddress).toBe(nap.addressLines[0]);
    expect(nap.addressLine).toContain(address.addressLocality!);
    expect(nap.addressLine).toContain(address.addressRegion!);
    expect(nap.addressLine).toContain(address.postalCode!);
    expect(address.addressCountry).toBe(nap.country);
  });

  it("hides the address from both at once", () => {
    const location = row();
    expect(renderNAP(location, { hideAddress: true }).addressLines).toEqual([]);
    expect(postalAddress(location, { hideAddress: true })).toBeUndefined();
  });
});

describe("LocalBusiness structured data", () => {
  const hoursRow = (over: Partial<OpeningHoursRow>): OpeningHoursRow => ({
    id: "00000000-0000-4000-8000-00000000000b",
    locationId: "00000000-0000-4000-8000-00000000000a",
    weekday: 1,
    onDate: null,
    opens: "09:00:00",
    closes: "17:00:00",
    closed: false,
    label: null,
    createdAt: new Date(0),
    updatedAt: new Date(0),
    ...over,
  });

  it("uses the owner's chosen business type, not a generic one", () => {
    // §13 step 2 calls the schema type "identity, not decoration".
    const generic = localBusinessJsonLd({
      location: row(),
      businessSchemaType: "Photographer",
      url: "https://example.test/",
    });
    expect(generic["@type"]).toBe("Photographer");

    const specific = localBusinessJsonLd({
      location: row({ schemaType: "HairSalon" }),
      businessSchemaType: "Photographer",
      url: "https://example.test/",
    });
    expect(specific["@type"]).toBe("HairSalon");
  });

  it("omits what it does not know rather than emitting it empty", () => {
    // Structured data is read as a set of claims, and `telephone: null` is a
    // claim about a phone number.
    const sparse = localBusinessJsonLd({
      location: row({ phone: null, email: null, priceRange: null, latitude: null, longitude: null }),
      businessSchemaType: "LocalBusiness",
      url: "https://example.test/",
    });
    expect(sparse).not.toHaveProperty("telephone");
    expect(sparse).not.toHaveProperty("email");
    expect(sparse).not.toHaveProperty("priceRange");
    expect(sparse).not.toHaveProperty("geo");
    expect(sparse).not.toHaveProperty("openingHoursSpecification");
  });

  it("carries geo, hours, priceRange and sameAs when it has them", () => {
    // The four §4.10 names by hand.
    const full = localBusinessJsonLd({
      location: row({
        priceRange: "$$",
        sameAs: ["https://instagram.example/aurora"],
        googleBusinessProfileUrl: "https://maps.example/aurora",
      }),
      hours: [hoursRow({})],
      businessSchemaType: "Photographer",
      url: "https://example.test/",
    });
    expect(full.geo).toMatchObject({ latitude: 49.687, longitude: -124.993 });
    expect(full.priceRange).toBe("$$");
    // The Google Business Profile leads, being the sameAs that matters most
    // for a local business (§33).
    expect(full.sameAs).toEqual([
      "https://maps.example/aurora",
      "https://instagram.example/aurora",
    ]);
    expect(full.openingHoursSpecification).toHaveLength(1);
  });

  it("says closed rather than staying silent about a closed day", () => {
    // A search result that offers to say whether a shop is open now needs the
    // difference between "closed on Sunday" and "nobody mentioned Sunday".
    const [spec] = openingHoursJsonLd([hoursRow({ weekday: 0, closed: true, opens: null, closes: null })]);
    expect(spec).toMatchObject({
      dayOfWeek: "https://schema.org/Sunday",
      opens: "00:00",
      closes: "00:00",
    });
  });

  it("emits a dated override as a one-day validity, not a weekday", () => {
    const [spec] = openingHoursJsonLd([
      hoursRow({ weekday: null, onDate: "2026-12-25", closed: true, opens: null, closes: null }),
    ]);
    expect(spec).not.toHaveProperty("dayOfWeek");
    expect(spec).toMatchObject({ validFrom: "2026-12-25", validThrough: "2026-12-25" });
  });

  it("trims the seconds Postgres reads a time column back with", () => {
    const [spec] = openingHoursJsonLd([hoursRow({})]);
    expect(spec).toMatchObject({ opens: "09:00", closes: "17:00" });
  });

  it("turns a radius into a GeoCircle in metres", () => {
    // The column is kilometres because that is what an owner types; schema.org
    // wants metres, and getting that backwards understates a service area by
    // a factor of a thousand.
    const circle = areaServedJsonLd({
      id: "x",
      locationId: "y",
      kind: "radius",
      centerLatitude: "49.687000",
      centerLongitude: "-124.993000",
      radiusKm: "75.00",
      regions: [],
      createdAt: new Date(0),
      updatedAt: new Date(0),
    }) as Record<string, unknown>;
    expect(circle["@type"]).toBe("GeoCircle");
    expect(circle.geoRadius).toBe(75_000);
  });
});

describe.runIf(hasDatabase)("keeping locations", () => {
  beforeEach(async () => {
    await truncateSpine();
  });

  afterAll(async () => {
    await closeDb();
  });

  it("makes the first location primary without being asked", async () => {
    // A business with one location and no primary renders no address anywhere
    // and gives its owner nothing to click to fix it.
    const created = await createLocationService.call(CANADIAN, OWNER);
    expect(created.isPrimary).toBe(true);
    await expect(primaryLocation.call({}, ANONYMOUS)).resolves.toMatchObject({
      id: created.id,
    });
  });

  it("does not make the second one primary", async () => {
    await createLocationService.call(CANADIAN, OWNER);
    const second = await createLocationService.call(
      { ...CANADIAN, slug: "cumberland", city: "Cumberland" },
      OWNER,
    );
    expect(second.isPrimary).toBe(false);
  });

  it("moves the flag rather than refusing, when a new location claims it", async () => {
    // An owner marking a location primary means "this one instead", and
    // answering with a unique-constraint error would make them go and unset
    // the old one first.
    const first = await createLocationService.call(CANADIAN, OWNER);
    const second = await createLocationService.call(
      { ...CANADIAN, slug: "cumberland", isPrimary: true },
      OWNER,
    );

    expect(second.isPrimary).toBe(true);
    const [reread] = await db()
      .select()
      .from(businessLocations)
      .where(eq(businessLocations.id, first.id));
    expect(reread?.isPrimary).toBe(false);
  });

  it("only ever has one primary, whatever order things happen in", async () => {
    const a = await createLocationService.call(CANADIAN, OWNER);
    const b = await createLocationService.call({ ...CANADIAN, slug: "b" }, OWNER);
    const c = await createLocationService.call({ ...CANADIAN, slug: "c" }, OWNER);

    await setPrimaryLocation.call({ id: b.id }, OWNER);
    await setPrimaryLocation.call({ id: c.id }, OWNER);
    await setPrimaryLocation.call({ id: a.id }, OWNER);

    const all = await db().select().from(businessLocations);
    expect(all.filter((location) => location.isPrimary)).toHaveLength(1);
  });

  it("refuses to make a hidden location the primary one", async () => {
    const location = await createLocationService.call(
      { ...CANADIAN, status: "hidden", slug: "winter" },
      OWNER,
    );
    const error = await failure(setPrimaryLocation.call({ id: location.id }, OWNER));
    expect(error.code).toBe("validation");
  });

  it("refuses a second location at the same address on the site", async () => {
    await createLocationService.call(CANADIAN, OWNER);
    const error = await failure(createLocationService.call(CANADIAN, OWNER));
    expect(error.code).toBe("conflict");
    expect(error.message).toContain("/locations/courtenay");
  });

  it("leaves a redirect behind when a location moves", async () => {
    // §5: "slugs never silently break". The old address was in somebody's
    // directory listing, and a 404 costs the citation the NAP exists to earn.
    const location = await createLocationService.call(CANADIAN, OWNER);
    await updateLocation.call({ id: location.id, slug: "comox-valley" }, OWNER);

    await expect(
      resolveRedirect.call({ path: "locations/courtenay", locale: "en" }, ANONYMOUS),
    ).resolves.toMatchObject({ toPath: "locations/comox-valley", status: "301" });
  });

  it("hides hidden locations from the public list but not from the admin", async () => {
    await createLocationService.call(CANADIAN, OWNER);
    await createLocationService.call(
      { ...CANADIAN, slug: "winter", status: "hidden" },
      OWNER,
    );
    await expect(listLocations.call({}, ANONYMOUS)).resolves.toHaveLength(1);
    await expect(
      listLocations.call({ includeHidden: true }, OWNER),
    ).resolves.toHaveLength(2);
  });

  it("stops answering with a hidden primary", async () => {
    // Otherwise hiding the only location leaves its address in the footer.
    const location = await createLocationService.call(CANADIAN, OWNER);
    await updateLocation.call({ id: location.id, status: "hidden" }, OWNER);
    await expect(primaryLocation.call({}, ANONYMOUS)).resolves.toBeNull();
  });

  it("refuses to delete the primary while others exist", async () => {
    // Deleting it would leave the site with no address and no obvious reason
    // why. Choosing the replacement is the owner's call.
    const first = await createLocationService.call(CANADIAN, OWNER);
    await createLocationService.call({ ...CANADIAN, slug: "cumberland" }, OWNER);
    const error = await failure(deleteLocation.call({ id: first.id }, OWNER));
    expect(error.code).toBe("conflict");
  });

  it("lets the last location go", async () => {
    const only = await createLocationService.call(CANADIAN, OWNER);
    await expect(deleteLocation.call({ id: only.id }, OWNER)).resolves.toMatchObject({
      slug: "courtenay",
    });
  });

  it("answers null for a business that has no locations", async () => {
    // §4.10: "a purely online creator skips this and no empty local
    // scaffolding appears". The emptiness has to survive to the surfaces.
    await expect(primaryLocation.call({}, ANONYMOUS)).resolves.toBeNull();
    await expect(listLocations.call({}, ANONYMOUS)).resolves.toEqual([]);
  });

  it("is owner-only to write and public to read", async () => {
    const location = await createLocationService.call(CANADIAN, OWNER);
    expect((await failure(createLocationService.call({ ...CANADIAN, slug: "x" }, STAFF))).code).toBe(
      "permission",
    );
    expect((await failure(updateLocation.call({ id: location.id, name: "Nope" }, STAFF))).code).toBe(
      "permission",
    );
    await expect(listLocations.call({}, ANONYMOUS)).resolves.toHaveLength(1);
  });
});

describe.runIf(hasDatabase)("opening hours", () => {
  let locationId: string;

  beforeEach(async () => {
    await truncateSpine();
    locationId = (await createLocationService.call(CANADIAN, OWNER)).id;
  });

  it("replaces the week wholesale", async () => {
    await setOpeningHours.call(
      {
        locationId,
        entries: [
          { weekday: 1, opens: "09:00", closes: "17:00" },
          { weekday: 2, opens: "09:00", closes: "17:00" },
        ],
      },
      OWNER,
    );
    await setOpeningHours.call(
      { locationId, entries: [{ weekday: 1, opens: "10:00", closes: "16:00" }] },
      OWNER,
    );

    const rows = await db()
      .select()
      .from(openingHours)
      .where(eq(openingHours.locationId, locationId));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.opens).toBe("10:00:00");
  });

  it("takes a stated closure as a fact", async () => {
    await setOpeningHours.call(
      { locationId, entries: [{ weekday: 0, closed: true }] },
      OWNER,
    );
    const location = await getLocation.call({ id: locationId }, ANONYMOUS);
    expect(location?.hours[0]).toMatchObject({ weekday: 0, closed: true, opens: null });
  });

  it("refuses two rules for one weekday", async () => {
    const error = await failure(
      setOpeningHours.call(
        {
          locationId,
          entries: [
            { weekday: 1, opens: "09:00", closes: "12:00" },
            { weekday: 1, opens: "13:00", closes: "17:00" },
          ],
        },
        OWNER,
      ),
    );
    expect(error.code).toBe("validation");
  });

  it("refuses a day that closes before it opens", async () => {
    const error = await failure(
      setOpeningHours.call(
        { locationId, entries: [{ weekday: 1, opens: "17:00", closes: "09:00" }] },
        OWNER,
      ),
    );
    expect(error.code).toBe("validation");
  });

  it("refuses an entry that is both a weekday and a date", async () => {
    const error = await failure(
      setOpeningHours.call(
        {
          locationId,
          entries: [{ weekday: 1, onDate: "2026-12-25", opens: "09:00", closes: "17:00" }],
        },
        OWNER,
      ),
    );
    expect(error.code).toBe("validation");
  });

  it("takes hours and the service area away with the location", async () => {
    await setOpeningHours.call(
      { locationId, entries: [{ weekday: 1, opens: "09:00", closes: "17:00" }] },
      OWNER,
    );
    await setServiceArea.call(
      { locationId, area: { kind: "regions", regions: ["Vancouver Island"] } },
      OWNER,
    );
    await deleteLocation.call({ id: locationId }, OWNER);
    expect(await db().select().from(openingHours)).toHaveLength(0);
  });
});

describe.runIf(hasDatabase)("service areas", () => {
  let locationId: string;

  beforeEach(async () => {
    await truncateSpine();
    locationId = (await createLocationService.call(CANADIAN, OWNER)).id;
  });

  it("keeps one answer to where the business travels", async () => {
    await setServiceArea.call(
      { locationId, area: { kind: "regions", regions: ["Comox Valley"] } },
      OWNER,
    );
    await setServiceArea.call(
      {
        locationId,
        area: {
          kind: "radius",
          centerLatitude: 49.687,
          centerLongitude: -124.993,
          radiusKm: 75,
        },
      },
      OWNER,
    );
    const location = await getLocation.call({ id: locationId }, ANONYMOUS);
    expect(location?.serviceArea).toMatchObject({ kind: "radius", radiusKm: "75.00" });
  });

  it("can be cleared by a business that has stopped travelling", async () => {
    await setServiceArea.call(
      { locationId, area: { kind: "regions", regions: ["Comox Valley"] } },
      OWNER,
    );
    await setServiceArea.call({ locationId, area: null }, OWNER);
    const location = await getLocation.call({ id: locationId }, ANONYMOUS);
    expect(location?.serviceArea).toBeNull();
  });

  it("refuses a region list with nothing in it", async () => {
    const error = await failure(
      setServiceArea.call({ locationId, area: { kind: "regions", regions: [] } }, OWNER),
    );
    expect(error.code).toBe("validation");
  });
});
