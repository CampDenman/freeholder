// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: AGPL-3.0-only
// One location: its NAP, its hours, and where it travels to (MASTER.md §4.10).
//
// `new` is handled by this same route rather than a separate one, because the
// form is the same form — see saveLocationAction. A location being added and a
// location being edited differ only in whether an id came with it.
import { notFound } from "next/navigation";
import { Trash } from "@phosphor-icons/react/dist/ssr";
import { getLocation } from "@/core/locations/service";
import { currentBusiness } from "@/core/settings/read";
import { getLocale, getT } from "../../../../i18n";
import { requireStaffActor } from "../../guard";
import { LocationForm } from "../LocationForm";
import { HoursForm, type HoursRow } from "../HoursForm";
import { ServiceAreaForm } from "../ServiceAreaForm";
import { DeleteButton } from "../DeleteButton";
import {
  hoursFormLabels,
  locationFormLabels,
  serviceAreaFormLabels,
  weekdayNames,
} from "../labels";

export const dynamic = "force-dynamic";

/** Postgres reads a `time` column back as HH:MM:SS; the input wants HH:MM. */
function forInput(value: string | null): string {
  return value ? value.slice(0, 5) : "";
}

export default async function LocationPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const actor = await requireStaffActor("locations", "manage");
  const { id } = await params;
  const [t, locale, business] = await Promise.all([
    getT(),
    getLocale(),
    currentBusiness(),
  ]);

  const isNew = id === "new";
  const location = isNew ? null : await getLocation.call({ id }, actor);
  if (!isNew && !location) notFound();

  const days = weekdayNames(locale);
  const hourRows: HoursRow[] = days.map((label, weekday) => {
    const stored = location?.hours.find((row) => row.weekday === weekday);
    return {
      weekday,
      label,
      opens: forInput(stored?.opens ?? null),
      closes: forInput(stored?.closes ?? null),
      closed: stored?.closed ?? false,
    };
  });

  const area = location?.serviceArea ?? null;

  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight">
            {location?.name ?? t("locations.new")}
          </h1>
          <p className="mt-1 max-w-prose text-sm text-ink-muted">
            {t("locations.editIntro")}
          </p>
        </div>
        <a href="/admin/locations" className="text-sm text-ink-muted">
          {t("common.back")}
        </a>
      </div>

      <LocationForm
        labels={locationFormLabels(t)}
        values={{
          id: location?.id ?? "",
          name: location?.name ?? business?.name ?? "",
          slug: location?.slug ?? "",
          street: location?.street ?? "",
          unit: location?.unit ?? "",
          city: location?.city ?? "",
          region: location?.region ?? "",
          postalCode: location?.postalCode ?? "",
          // A business's own country is the right guess for its first
          // location, and the wrong one is a click to change.
          country: location?.country ?? business?.country ?? "",
          latitude: location?.latitude ?? "",
          longitude: location?.longitude ?? "",
          phone: location?.phone ?? "",
          email: location?.email ?? "",
          googleBusinessProfileUrl: location?.googleBusinessProfileUrl ?? "",
          priceRange: location?.priceRange ?? "",
          schemaType: location?.schemaType ?? "",
          sameAs: (location?.sameAs ?? []).join(", "),
          status: location?.status ?? "visible",
        }}
      />

      {/* Hours and a service area need a location to belong to, so they only
          appear once one exists. Showing them on the new-location form would
          mean saving three things in an order nobody explained. */}
      {location ? (
        <>
          <HoursForm
            locationId={location.id}
            rows={hourRows}
            labels={hoursFormLabels(t)}
          />
          <ServiceAreaForm
            locationId={location.id}
            labels={serviceAreaFormLabels(t)}
            values={{
              kind: area?.kind ?? "none",
              centerLatitude: area?.centerLatitude ?? "",
              centerLongitude: area?.centerLongitude ?? "",
              radiusKm: area?.radiusKm ?? "",
              regions: (area?.regions ?? []).join(", "),
            }}
          />
          <div className="flex items-center gap-3 pt-2">
            <Trash size={16} className="text-danger" />
            <DeleteButton
              id={location.id}
              label={t("locations.delete")}
              confirm={t("locations.deleteConfirm")}
            />
          </div>
        </>
      ) : null}
    </div>
  );
}
