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
import { ApiKeysCard } from "./ApiKeysCard";
import { listApiKeys, listScopes } from "@/core/apikeys/service";
import { currentBusiness } from "@/core/settings/read";
import type { Actor } from "@/core/service";

export const dynamic = "force-dynamic";


export default async function AdminSettingsPage() {
  const actor = await requireStaffActor();
  const business = await currentBusiness();
  // Reachable only if setup was skipped somehow; the wizard is the way in.
  if (!business) redirect("/setup");

  const [t, locale] = await Promise.all([getT(), getLocale()]);

  // Keys are owner-only while this screen is staff-accessible, so the card is
  // fetched conditionally rather than rendered from a call that would refuse.
  // Asking the actor here rather than catching a permission error keeps the
  // service layer's refusal meaning "something went wrong" everywhere else.
  const keys =
    actor.kind === "user" && actor.role === "owner"
      ? await loadKeys(actor, locale)
      : null;

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

      {keys ? (
        <ApiKeysCard
          areas={keys.areas}
          keys={keys.rows}
          labels={{
            cardTitle: t("apikeys.title"),
            intro: t("apikeys.intro"),
            name: t("apikeys.name"),
            nameHint: t("apikeys.nameHint"),
            expiry: t("apikeys.expiry"),
            expiryHint: t("apikeys.expiryHint"),
            never: t("apikeys.never"),
            access: t("apikeys.access"),
            none: t("apikeys.none"),
            read: t("apikeys.read"),
            full: t("apikeys.full"),
            create: t("apikeys.create"),
            pending: t("common.saving"),
            created: t("apikeys.created"),
            createdHint: t("apikeys.createdHint"),
            existing: t("apikeys.existing"),
            empty: t("apikeys.empty"),
            neverUsed: t("apikeys.neverUsed"),
            lastUsed: t("apikeys.lastUsed"),
            expiresOn: t("apikeys.expiresOn"),
            revoke: t("apikeys.revoke"),
            revokeConfirm: t("apikeys.revokeConfirm"),
            publicOnly: t("apikeys.publicOnly"),
          }}
        />
      ) : null}

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

/**
 * The key list and the scope areas the picker offers.
 *
 * `reads` is derived from each service's declared `kind`, so "read only" means
 * exactly this instance's query services — including any a module added
 * yesterday (§28). Nothing here is a second list to maintain.
 */
async function loadKeys(actor: Actor, locale: string) {
  const [areas, rows] = await Promise.all([
    listScopes.call({}, actor),
    listApiKeys.call({}, actor),
  ]);
  const when = new Intl.DateTimeFormat(locale, { dateStyle: "medium" });
  return {
    areas: areas.map((area) => ({
      area: area.area,
      family: area.family,
      reads: area.services.filter((s) => s.kind === "query").map((s) => s.name),
      total: area.services.length,
    })),
    rows: rows.map((row) => ({
      id: row.id,
      name: row.name,
      prefix: row.prefix,
      scopes: row.scopes,
      lastUsed: row.lastUsedAt ? when.format(row.lastUsedAt) : null,
      expires: row.expiresAt ? when.format(row.expiresAt) : null,
    })),
  };
}
