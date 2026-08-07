// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: AGPL-3.0-only
// Copy for the location screens, built server-side from the catalog.
//
// Same shape as setup/businessLabels.ts, and for the same reason: the forms
// are client components, and a client component cannot reach the catalog. So
// the words are resolved on the server and passed down as data — which is also
// what keeps §15.3's i18n lint rule satisfiable, since a literal string in a
// component is exactly what it fails on.
import type { Translate } from "@/core/i18n";
import type { LocationFormLabels } from "./LocationForm";
import type { HoursFormLabels } from "./HoursForm";
import type { ServiceAreaFormLabels } from "./ServiceAreaForm";

export function locationFormLabels(t: Translate): LocationFormLabels {
  return {
    cardTitle: t("locations.form.title"),
    name: t("locations.field.name"),
    nameHint: t("locations.field.nameHint"),
    slug: t("locations.field.slug"),
    slugHint: t("locations.field.slugHint"),
    street: t("locations.field.street"),
    unit: t("locations.field.unit"),
    city: t("locations.field.city"),
    region: t("locations.field.region"),
    postalCode: t("locations.field.postalCode"),
    country: t("locations.field.country"),
    countryHint: t("locations.field.countryHint"),
    latitude: t("locations.field.latitude"),
    longitude: t("locations.field.longitude"),
    geoHint: t("locations.field.geoHint"),
    phone: t("locations.field.phone"),
    phoneHint: t("locations.field.phoneHint"),
    email: t("locations.field.email"),
    gbp: t("locations.field.gbp"),
    gbpHint: t("locations.field.gbpHint"),
    priceRange: t("locations.field.priceRange"),
    priceRangeHint: t("locations.field.priceRangeHint"),
    schemaType: t("locations.field.schemaType"),
    schemaTypeHint: t("locations.field.schemaTypeHint"),
    sameAs: t("locations.field.sameAs"),
    sameAsHint: t("locations.field.sameAsHint"),
    status: t("locations.field.status"),
    visible: t("locations.status.visible"),
    hidden: t("locations.status.hidden"),
    submit: t("common.saveChanges"),
    pending: t("common.saving"),
    saved: t("admin.settings.saved"),
  };
}

export function hoursFormLabels(t: Translate): HoursFormLabels {
  return {
    cardTitle: t("locations.hours.title"),
    intro: t("locations.hours.intro"),
    opens: t("locations.hours.opens"),
    closes: t("locations.hours.closes"),
    closed: t("locations.hours.closed"),
    submit: t("common.saveChanges"),
    pending: t("common.saving"),
    saved: t("admin.settings.saved"),
  };
}

export function serviceAreaFormLabels(t: Translate): ServiceAreaFormLabels {
  return {
    cardTitle: t("locations.area.title"),
    intro: t("locations.area.intro"),
    kind: t("locations.area.kind"),
    none: t("locations.area.none"),
    radius: t("locations.area.radius"),
    regions: t("locations.area.regions"),
    centerLatitude: t("locations.area.centerLatitude"),
    centerLongitude: t("locations.area.centerLongitude"),
    radiusKm: t("locations.area.radiusKm"),
    radiusHint: t("locations.area.radiusHint"),
    regionList: t("locations.area.regionList"),
    regionHint: t("locations.area.regionHint"),
    submit: t("common.saveChanges"),
    pending: t("common.saving"),
    saved: t("admin.settings.saved"),
  };
}

/**
 * The seven weekday names, in the reader's language, starting on Sunday.
 *
 * `Intl` rather than seven catalog keys — the runtime already knows every
 * language's day names, and restating them would mean getting them wrong for
 * the first locale somebody adds without translating. 2024-01-07 was a Sunday,
 * so the offset matches the weekday column (0 = Sunday).
 */
export function weekdayNames(locale: string): string[] {
  const format = new Intl.DateTimeFormat(locale, {
    weekday: "long",
    timeZone: "UTC",
  });
  return Array.from({ length: 7 }, (_, day) =>
    format.format(new Date(Date.UTC(2024, 0, 7 + day))),
  );
}
