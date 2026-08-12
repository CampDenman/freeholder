// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: AGPL-3.0-only
import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { ShieldCheck } from "@phosphor-icons/react/dist/ssr";
import { SESSION_COOKIE } from "@/core/auth/sessions";
import { actorFromToken } from "@/core/http/actor";
import { formatDateTime } from "@/core/i18n";
import { getMyPrivacyProfile, listMyDataRequests } from "@/core/privacy/service";
import { currentBusiness } from "@/core/settings/read";
import { getLocale, getT } from "../../i18n";
import { localizeCustomerHref } from "@/core/i18n/customer";
import { portalSignOutAction } from "../actions";
import { PortalPrivacyCentre } from "./PortalPrivacyCentre";
import { PortalLocaleChooser } from "../PortalLocaleChooser";

export const dynamic = "force-dynamic";
export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return {
    title: t("privacy.portal.title"),
    robots: { index: false, follow: false },
    referrer: "no-referrer",
  };
}

export default async function PortalPrivacyPage() {
  const [actor, business, locale] = await Promise.all([
    cookies().then((jar) => actorFromToken(jar.get(SESSION_COOKIE)?.value)),
    currentBusiness(),
    getLocale(),
  ]);
  const policy = {
    defaultLocale: business?.defaultLocale ?? "en",
    enabledLocales: business?.enabledLocales ?? ["en"],
  };
  if (actor.kind !== "user") {
    redirect(localizeCustomerHref("/portal/login", locale, policy));
  }
  if (actor.grants.length > 0) redirect("/admin");
  const [profile, requests, t] = await Promise.all([
    getMyPrivacyProfile.call({}, actor),
    listMyDataRequests.call({}, actor),
    getT(),
  ]);
  const timezone = profile.contact.timezone ?? business?.timezone ?? "UTC";
  const kinds = Object.fromEntries(
    (["access", "export", "correction", "erasure"] as const).map((kind) => [kind, t(`privacy.kind.${kind}`)]),
  );
  const statuses = Object.fromEntries(
    (["submitted", "verified", "in_progress", "completed", "partially_completed", "denied", "cancelled"] as const).map((status) => [status, t(`privacy.status.${status}`)]),
  );
  return (
    <main className="mx-auto max-w-4xl px-6 py-10">
      <header className="mb-8 flex flex-wrap items-center gap-3 border-b border-rule pb-5">
        <ShieldCheck size={24} weight="duotone" className="text-accent" />
        <div>
          <p className="text-sm font-semibold">{business?.name ?? t("common.appName")}</p>
          <h1 className="text-2xl font-bold tracking-tight">{t("privacy.portal.title")}</h1>
        </div>
        <form action={portalSignOutAction} className="ms-auto">
          <button type="submit" className="text-sm text-ink-muted underline">{t("auth.logout")}</button>
        </form>
        <PortalLocaleChooser
          locale={locale}
          policy={policy}
          path="/portal/privacy"
          signedIn
          t={t}
        />
      </header>
      <p className="mb-6 max-w-3xl text-sm text-ink-muted">{t("privacy.portal.intro")}</p>
      <PortalPrivacyCentre
        preferences={profile.effective.map((choice) => ({ channel: choice.channel, state: choice.state }))}
        profile={profile.contact}
        requests={requests.map(({ request, artifact }) => ({
          id: request.id,
          kind: request.kind,
          status: request.status,
          due: formatDateTime(request.responseDueAt, timezone, locale),
          artifactId: artifact?.id ?? null,
          artifactAvailable: Boolean(artifact && artifact.expiresAt > new Date()),
        }))}
        labels={{
          preferencesTitle: t("privacy.portal.preferencesTitle"),
          preferencesHint: t("privacy.portal.preferencesHint"),
          currentGranted: t("privacy.portal.on"),
          currentOff: t("privacy.portal.off"),
          grant: t("privacy.portal.grant"),
          withdraw: t("privacy.portal.withdraw"),
          working: t("privacy.working"),
          requestTitle: t("privacy.portal.requestTitle"),
          requestHint: t("privacy.portal.requestHint"),
          kind: t("privacy.request.kind"),
          jurisdiction: t("privacy.jurisdiction"),
          jurisdictionPlaceholder: t("privacy.jurisdictionPlaceholder"),
          note: t("privacy.note"),
          correctionHint: t("privacy.portal.correctionHint"),
          name: t("contacts.field.name"),
          email: t("contacts.field.email"),
          phone: t("contacts.field.phone"),
          preferredLocale: t("contacts.field.preferredLocale"),
          timezone: t("contacts.field.timezone"),
          country: t("contacts.field.country"),
          clearEmail: t("privacy.portal.clearEmail"),
          clearPhone: t("privacy.portal.clearPhone"),
          submit: t("privacy.portal.submit"),
          historyTitle: t("privacy.portal.historyTitle"),
          historyEmpty: t("privacy.portal.historyEmpty"),
          status: t("privacy.status"),
          due: t("privacy.due"),
          download: t("privacy.download"),
          cancel: t("privacy.portal.cancel"),
          channels: Object.fromEntries((["email", "sms", "push"] as const).map((channel) => [channel, t(`privacy.channel.${channel}`)])),
          kinds,
          statuses,
        }}
      />
    </main>
  );
}
