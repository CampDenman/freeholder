// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Locations (MASTER.md §4.10).
//
// The list exists mainly to answer one question at a glance — which location's
// address is the site's own — because that is the fact §4.10's whole rule
// rests on and the one an owner with two locations will get wrong.
//
// A business with no locations sees an invitation rather than an empty table.
// §4.10 makes locations optional, so "none" is a legitimate resting state and
// the screen should not read as though something is missing.
import { MapPin, Plus } from "@phosphor-icons/react/dist/ssr";
import { Card, CardBody, CardHeader, Pill } from "@/ui/primitives";
import { listLocations } from "@/core/locations/service";
import { renderNAP } from "@/core/locations/nap";
import { getT } from "../../../i18n";
import { requireStaffActor } from "../guard";
import { PrimaryButton } from "./PrimaryButton";
import { hasModuleAccess } from "@/core/service";

export const dynamic = "force-dynamic";

export default async function LocationsPage() {
  const actor = await requireStaffActor("locations");
  const [t, locations] = await Promise.all([
    getT(),
    listLocations.call({ includeHidden: true }, actor),
  ]);
  const canManage = hasModuleAccess(actor, "locations", "manage");

  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight">
            {t("admin.locations.title")}
          </h1>
          <p className="mt-1 max-w-prose text-sm text-ink-muted">
            {t("admin.locations.intro")}
          </p>
        </div>
        {canManage ? (
          <a
            href="/admin/locations/new"
            className="inline-flex items-center gap-2 rounded-md bg-accent px-3 py-2 text-sm font-semibold text-on-accent"
          >
            <Plus size={15} weight="bold" />
            {t("admin.locations.add")}
          </a>
        ) : null}
      </div>

      {locations.length === 0 ? (
        <Card>
          <CardBody>
            <div className="grid justify-items-start gap-2 py-4">
              <MapPin size={22} className="text-ink-muted" />
              <p className="max-w-prose text-sm text-ink-muted">
                {t("admin.locations.empty")}
              </p>
            </div>
          </CardBody>
        </Card>
      ) : (
        <div className="grid gap-4">
          {locations.map((location) => {
            const nap = renderNAP(location);
            // Computed rather than written inline: it is an address, not copy,
            // and §15.3's lint rule is right to refuse literal text in JSX.
            const publicPath = `/locations/${location.slug}`;
            return (
              <Card key={location.id}>
                <CardHeader
                  title={location.name}
                  status={
                    <div className="flex items-center gap-2">
                      {location.isPrimary ? (
                        <Pill tone="accent">{t("admin.locations.primary")}</Pill>
                      ) : canManage ? (
                        <PrimaryButton
                          id={location.id}
                          label={t("admin.locations.makePrimary")}
                        />
                      ) : null}
                      {location.status === "hidden" ? (
                        <Pill tone="neutral">{t("admin.locations.hidden")}</Pill>
                      ) : null}
                    </div>
                  }
                />
                <CardBody>
                  <div className="grid gap-2 text-sm">
                    <address className="not-italic text-ink-muted">
                      {nap.addressLine || t("admin.locations.noAddress")}
                    </address>
                    {nap.phone ? (
                      <span className="text-ink-muted">{nap.phone}</span>
                    ) : null}
                    <div className="flex flex-wrap gap-3 pt-1">
                      {canManage ? (
                        <a
                          href={`/admin/locations/${location.id}`}
                          className="text-sm font-semibold text-accent"
                        >
                          {t("common.edit")}
                        </a>
                      ) : null}
                      <a href={publicPath} className="text-sm text-ink-muted">
                        {publicPath}
                      </a>
                    </div>
                  </div>
                </CardBody>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
