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
import { redirect } from "next/navigation";
import { env } from "@/core/env";
import { customerSignInStatus } from "@/core/portal/sign-in";
import { safeCustomerReturnPath } from "@/core/portal/return-path";
import { MagicLinkForm } from "./MagicLinkForm";
import { PortalPasskeySignIn } from "./PortalPasskeySignIn";
import { PortalLocaleChooser } from "../PortalLocaleChooser";

export const dynamic = "force-dynamic";
export async function generateMetadata(): Promise<Metadata> {
  const [business, t] = await Promise.all([currentBusiness(), getT()]);
  return {
    // A tab, a bookmark and a screen reader all start from the title; an
    // empty one made this page anonymous in every one of them.
    title: `${t("portal.login.title")} — ${business?.name ?? t("common.appName")}`,
    robots: { index: false, follow: false },
    referrer: "no-referrer",
  };
}

export default async function PortalLoginPage({ searchParams }: { searchParams: Promise<{ returnTo?: string }> }) {
  const query = await searchParams;
  const returnTo = safeCustomerReturnPath(query.returnTo);
  const availability = await customerSignInStatus.call({}, {kind:"anonymous"});
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
  if (signedIn && query.returnTo) redirect(localizeCustomerHref(returnTo, locale, policy));
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
      {env().FREEHOLDER_PLAYGROUND === "1" ? <div className="mb-8" /> : (
        <p className="mt-2 mb-8 text-ink-muted">{t("portal.login.intro")}</p>
      )}
      {signedIn ? (
        <Callout tone="success">
          {t("portal.login.signedIn")} {" "}
          <a href={localizeCustomerHref("/portal/privacy", locale, policy)}>
            {t("privacy.portal.open")}
          </a>
        </Callout>
      ) : env().FREEHOLDER_PLAYGROUND === "1" ? (
        // C1.38: the playground sends no mail and issues no customer
        // credentials, so neither sign-in below could finish. Say that, and
        // what the portal is, rather than "not available yet", which reads
        // as an unfinished product.
        <Callout>{t("portal.login.playground")}</Callout>
      ) : (
        <>
        <PortalPasskeySignIn returnTo={returnTo} labels={{
          heading: t("portal.passkey.heading"),
          intro: t("portal.passkey.intro"),
          email: t("portal.login.email"),
          submit: t("portal.passkey.submit"),
          failed: t("portal.passkey.failed"),
        }} />
        {availability.available ? <MagicLinkForm returnTo={returnTo} labels={{
          name: t("portal.profile.name"),
          email: t("portal.login.email"),
          submit: t("portal.login.submit"),
          pending: t("portal.login.pending"),
          sent: t("portal.login.sent"),
        }} /> : <Callout>{t("portal.login.unavailable")}</Callout>}
        </>
      )}
    </main>
  );
}
