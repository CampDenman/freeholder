// Copyright (C) 2026 Camp Denman Society
// SPDX-License-Identifier: AGPL-3.0-only
// Editing the business after setup — the other half of §13. The wizard writes
// these once; this is where they live for the rest of the site's life.
import { redirect } from "next/navigation";
import { getBusiness } from "@/core/settings/service";
import { requireStaffActor } from "../guard";
import { SettingsForm } from "./SettingsForm";

export const dynamic = "force-dynamic";

const ANONYMOUS = { kind: "anonymous" } as const;

export default async function AdminSettingsPage() {
  await requireStaffActor();
  const business = await getBusiness.call({}, ANONYMOUS);
  // Reachable only if setup was skipped somehow; the wizard is the way in.
  if (!business) redirect("/setup");

  return (
    <div className="grid gap-6">
      <div>
        <h1 className="text-xl font-bold tracking-tight">Settings</h1>
        <p className="mt-1 text-sm text-ink-muted">
          Who this business is, and the conventions the whole site follows.
        </p>
      </div>
      <SettingsForm
        values={{
          name: business.name,
          tagline: business.tagline ?? "",
          schemaType: business.schemaType,
          country: business.country,
          baseCurrency: business.baseCurrency,
          timezone: business.timezone,
          enabledLocales: business.enabledLocales,
          units: business.units,
          firstDayOfWeek: business.firstDayOfWeek,
        }}
      />
    </div>
  );
}
