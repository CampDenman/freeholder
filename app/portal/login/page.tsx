// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
import type { Metadata } from "next";
import { cookies } from "next/headers";
import { Storefront } from "@phosphor-icons/react/dist/ssr";
import { Callout } from "@/ui/primitives";
import { SESSION_COOKIE } from "@/core/auth/sessions";
import { actorFromToken } from "@/core/http/actor";
import { currentBusiness } from "@/core/settings/read";
import { getLocale, getT } from "../../i18n";
import { localizeCustomerHref } from "@/core/i18n/customer";
import { MagicLinkForm } from "./MagicLinkForm";
import { PortalLocaleChooser } from "../PortalLocaleChooser";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default async function PortalLoginPage() {
  const [business, locale, t, jar] = await Promise.all([
    currentBusiness(),
    getLocale(),
    getT(),
    cookies(),
  ]);
  const actor = await actorFromToken(jar.get(SESSION_COOKIE)?.value);
  const signedIn = actor.kind === "user" && actor.grants.length === 0;
  const policy = {
    defaultLocale: business?.defaultLocale ?? "en",
    enabledLocales: business?.enabledLocales ?? ["en"],
  };
  return (
    <main className="mx-auto max-w-md px-6 py-16">
      <div className="mb-8 flex items-center gap-3">
        <Storefront size={24} weight="duotone" className="text-accent" />
        <span className="font-semibold">{business?.name ?? t("common.appName")}</span>
        <div className="ms-auto">
          <PortalLocaleChooser
            locale={locale}
            policy={policy}
            path="/portal/login"
            signedIn={signedIn}
            t={t}
          />
        </div>
      </div>
      <h1 className="text-2xl font-bold tracking-tight">{t("portal.login.title")}</h1>
      <p className="mt-2 mb-8 text-ink-muted">{t("portal.login.intro")}</p>
      {signedIn ? (
        <Callout tone="success">
          {t("portal.login.signedIn")} {" "}
          <a href={localizeCustomerHref("/portal/privacy", locale, policy)}>
            {t("privacy.portal.open")}
          </a>
        </Callout>
      ) : (
        <MagicLinkForm labels={{
          email: t("portal.login.email"),
          submit: t("portal.login.submit"),
          pending: t("portal.login.pending"),
          sent: t("portal.login.sent"),
        }} />
      )}
    </main>
  );
}
