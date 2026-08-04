// Copyright (C) 2026 Camp Denman Society
// SPDX-License-Identifier: AGPL-3.0-only
// Editing the business after setup — the other half of §13. The wizard writes
// these once; this is where they live for the rest of the site's life.
import { redirect } from "next/navigation";
import { getLocale, getT } from "../../../i18n";
import { businessFormLabels, businessOptions } from "../../../setup/businessLabels";
import { requireStaffActor } from "../guard";
import { SettingsForm } from "./SettingsForm";
import { PasswordForm } from "./PasswordForm";
import { currentBusiness } from "@/core/settings/read";

export const dynamic = "force-dynamic";


export default async function AdminSettingsPage() {
  await requireStaffActor();
  const business = await currentBusiness();
  // Reachable only if setup was skipped somehow; the wizard is the way in.
  if (!business) redirect("/setup");

  const [t, locale] = await Promise.all([getT(), getLocale()]);

  return (
    <div className="grid gap-6">
      <div>
        <h1 className="text-xl font-bold tracking-tight">
          {t("admin.settings.title")}
        </h1>
        <p className="mt-1 text-sm text-ink-muted">
          {t("admin.settings.intro")}
        </p>
      </div>
      <SettingsForm
        labels={{
          ...businessFormLabels(t),
          cardTitle: t("business.cardTitle"),
          submit: t("common.saveChanges"),
          pending: t("common.saving"),
          saved: t("admin.settings.saved"),
        }}
        options={businessOptions(locale, t, {
          currency: business.baseCurrency,
          timezone: business.timezone,
        })}
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

      <PasswordForm
        labels={{
          cardTitle: t("settings.security"),
          intro: t("settings.securityIntro"),
          current: t("settings.currentPassword"),
          next: t("settings.newPassword"),
          nextHint: t("settings.newPasswordHelp"),
          submit: t("settings.changePassword"),
        }}
      />
    </div>
  );
}
