// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import {
  AddressBook,
  FileCsv,
  GoogleLogo,
  MicrosoftOutlookLogo,
} from "@phosphor-icons/react/dist/ssr";
import { SESSION_COOKIE } from "@/core/auth/sessions";
import { actorFromToken } from "@/core/http/actor";
import {
  getSignupContactImportOffer,
  listSignupProviderContacts,
} from "@/core/import/signup-contact-service";
import { ServiceError } from "@/core/service";
import { currentBusiness } from "@/core/settings/read";
import { localizeCustomerHref } from "@/core/i18n/customer";
import { Button, Callout, Card, CardBody, CardHeader, Pill } from "@/ui/primitives";
import { SkipLink } from "@/ui/SkipLink";
import { getLocale, getT } from "../../i18n";
import { PortalLocaleChooser } from "../PortalLocaleChooser";
import { portalSignOutAction } from "../actions";
import { DeviceContactPicker } from "./DeviceContactPicker";
import {
  beginContactsOAuthAction,
  disconnectSignupContactsAction,
  skipSignupImportAction,
  stageContactFileAction,
  stageProviderContactsAction,
} from "./actions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};
const ROOT = "/portal/contact-import";

const SOURCE_ICONS = {
  google: <GoogleLogo size={18} weight="bold" />,
  microsoft: <MicrosoftOutlookLogo size={18} weight="bold" />,
};

export default async function PortalContactImportPage({
  searchParams,
}: {
  searchParams: Promise<{ account?: string; oauth?: string; error?: string; saved?: string }>;
}) {
  const [actor, business, locale, t, query] = await Promise.all([
    cookies().then((jar) => actorFromToken(jar.get(SESSION_COOKIE)?.value)),
    currentBusiness(),
    getLocale(),
    getT(),
    searchParams,
  ]);
  const languagePolicy = {
    defaultLocale: business?.defaultLocale ?? "en",
    enabledLocales: business?.enabledLocales ?? ["en"],
  };
  if (actor.kind !== "user") {
    redirect(localizeCustomerHref("/portal/login", locale, languagePolicy));
  }
  if (actor.grants.length > 0) redirect("/admin");

  const offer = await getSignupContactImportOffer.call({}, actor);
  let providerData: Awaited<ReturnType<typeof listSignupProviderContacts.call>> | null = null;
  let providerError: string | null = null;
  if (query.account) {
    try {
      providerData = await listSignupProviderContacts.call({ accountId: query.account }, actor);
    } catch (error) {
      providerError = error instanceof ServiceError ? error.message : t("contactImports.signup.providerFailed");
    }
  }
  const offering = offer.enabled && (offer.decision === null || offer.decision === "pending");
  const fieldList = offer.allowedFields
    .map((field) => t(`contactImports.signup.field.${field}`))
    .join(", ");

  return (
    <>
      <SkipLink>{t("a11y.skipToContent")}</SkipLink>
      <main id="main-content" tabIndex={-1} className="mx-auto max-w-4xl px-6 py-10">
        <header className="mb-8 flex flex-wrap items-center gap-3 border-b border-rule pb-5">
          <AddressBook size={24} weight="duotone" className="text-accent" />
          <div>
            <p className="text-sm font-semibold">{business?.name ?? t("common.appName")}</p>
            <h1 className="text-2xl font-bold tracking-tight">{t("contactImports.signup.portalTitle")}</h1>
          </div>
          <a
            href={localizeCustomerHref("/portal/privacy", locale, languagePolicy)}
            className="ms-auto text-sm text-ink-muted underline"
          >
            {t("contactImports.signup.portalHome")}
          </a>
          <form action={portalSignOutAction}>
            <button type="submit" className="text-sm text-ink-muted underline">{t("auth.logout")}</button>
          </form>
          <PortalLocaleChooser
            locale={locale}
            policy={languagePolicy}
            path="/portal/contact-import"
            signedIn
            t={t}
          />
        </header>

        {query.error ? <Callout tone="danger">{query.error}</Callout> : null}
        {providerError ? <Callout tone="danger">{providerError}</Callout> : null}
        {query.oauth === "cancelled" ? <Callout tone="warning">{t("contactImports.signup.oauthCancelled")}</Callout> : null}
        {query.oauth && !["cancelled", "connected"].includes(query.oauth) ? (
          <Callout tone="danger">{t("contactImports.signup.oauthFailed")}</Callout>
        ) : null}
        {query.saved === "disconnected" ? <Callout tone="success">{t("contactImports.signup.disconnected")}</Callout> : null}

        {offering ? (
          <div className="grid gap-6">
            <section className="border-s-4 border-accent ps-5">
              <h2 className="text-xl font-bold">{t("contactImports.signup.offerTitle")}</h2>
              <p className="mt-2 max-w-2xl text-sm text-ink-muted">
                {t("contactImports.signup.offerIntro")}
              </p>
              <dl className="mt-4 grid gap-2 text-sm sm:grid-cols-2">
                <div><dt className="font-semibold">{t("contactImports.signup.fields")}</dt><dd>{fieldList}</dd></div>
                <div><dt className="font-semibold">{t("contactImports.signup.maximum")}</dt><dd>{offer.maxContacts}</dd></div>
              </dl>
            </section>

            {providerData ? (
              <Card>
                <CardHeader title={t("contactImports.signup.chooseProvider")} />
                <CardBody>
                  <p className="text-sm text-ink-muted">
                    {t("contactImports.signup.providerPreviewHint")}
                  </p>
                  <form action={stageProviderContactsAction} className="grid gap-4">
                    <input type="hidden" name="accountId" value={query.account} />
                    <p className="text-sm font-semibold">
                      {t("contactImports.signup.providerCount", { count: String(providerData.contacts.length) })}
                    </p>
                    <div className="max-h-96 overflow-auto rounded-md border border-rule">
                      <table className="w-full text-start text-sm">
                        <thead className="sticky top-0 bg-surface-subtle text-xs text-ink-muted">
                          <tr>
                            <th className="px-3 py-2"><span className="sr-only">{t("contactImports.signup.select")}</span></th>
                            {providerData.fields.map((field) => <th key={field} className="px-3 py-2">{t(`contactImports.signup.field.${field}`)}</th>)}
                          </tr>
                        </thead>
                        <tbody>
                          {providerData.contacts.map((contact) => (
                            <tr key={contact.externalId} className="border-t border-rule">
                              <td className="px-3 py-2 align-top"><input type="checkbox" name="externalId" value={contact.externalId} aria-label={t("contactImports.signup.selectContact", { name: contact.name ?? contact.email ?? "" })} /></td>
                              {providerData.fields.map((field) => (
                                <td key={field} className="px-3 py-2">{contact[field] || t("contactImports.signup.blank")}</td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <p className="text-xs text-ink-muted">{t("contactImports.signup.noImportYet")}</p>
                    <div className="flex flex-wrap gap-3">
                      <Button type="submit">{t("contactImports.signup.previewSelected")}</Button>
                    </div>
                  </form>
                  <form action={disconnectSignupContactsAction} className="mt-4 border-t border-rule pt-4">
                    <input type="hidden" name="accountId" value={query.account} />
                    <Button type="submit" variant="danger">{t("contactImports.signup.disconnect")}</Button>
                  </form>
                </CardBody>
              </Card>
            ) : null}

            <div className="grid gap-5 md:grid-cols-2">
              {offer.allowedSources.includes("csv") || offer.allowedSources.includes("vcard") ? (
                <Card>
                  <CardHeader icon={<FileCsv size={18} weight="bold" />} title={t("contactImports.signup.fileTitle")} />
                  <CardBody>
                    <p className="text-sm text-ink-muted">{t("contactImports.signup.fileHint")}</p>
                    <form action={stageContactFileAction} className="grid gap-4">
                      <label htmlFor="signup-contact-source" className="text-sm font-semibold">
                        {t("contactImports.signup.sources")}
                      </label>
                      <select id="signup-contact-source" name="source" className="rounded-md border border-rule bg-field px-3 py-2 text-sm">
                        {offer.allowedSources.includes("csv") ? <option value="csv">{t("contactImports.signup.source.csv")}</option> : null}
                        {offer.allowedSources.includes("vcard") ? <option value="vcard">{t("contactImports.signup.source.vcard")}</option> : null}
                      </select>
                      <label htmlFor="signup-contact-file" className="text-sm font-semibold">
                        {t("contactImports.field.file")}
                      </label>
                      <input id="signup-contact-file" type="file" name="file" required accept=".csv,.vcf,text/csv,text/vcard" className="rounded-md border border-rule bg-field px-3 py-2 text-sm" />
                      {offer.allowedFields.map((field) => <input key={field} type="hidden" name="field" value={field} />)}
                      <div><Button type="submit">{t("contactImports.signup.preview")}</Button></div>
                    </form>
                  </CardBody>
                </Card>
              ) : null}

              {offer.allowedSources.includes("device") ? (
                <Card>
                  <CardHeader icon={<AddressBook size={18} weight="bold" />} title={t("contactImports.signup.deviceTitle")} />
                  <CardBody>
                    <p className="text-sm text-ink-muted">{t("contactImports.signup.deviceHint")}</p>
                    <DeviceContactPicker
                      fields={offer.allowedFields as Array<"email" | "name" | "phone">}
                      maxContacts={offer.maxContacts}
                      labels={{
                        choose: t("contactImports.signup.chooseDevice"),
                        unsupported: t("contactImports.signup.deviceUnsupported"),
                        selected: t("contactImports.signup.deviceSelected"),
                        tooMany: t("contactImports.signup.tooMany"),
                        failed: t("contactImports.signup.deviceFailed"),
                        previewHint: t("contactImports.signup.noImportYet"),
                        preview: t("contactImports.signup.preview"),
                        working: t("common.working"),
                        blank: t("contactImports.signup.blank"),
                        email: t("contactImports.signup.field.email"),
                        name: t("contactImports.signup.field.name"),
                        phone: t("contactImports.signup.field.phone"),
                      }}
                    />
                  </CardBody>
                </Card>
              ) : null}

              {(["google", "microsoft"] as const).map((provider) =>
                offer.allowedSources.includes(provider) ? (
                  <Card key={provider}>
                    <CardHeader icon={SOURCE_ICONS[provider]} title={t(`contactImports.signup.source.${provider}`)} />
                    <CardBody>
                      <p className="text-sm text-ink-muted">
                        {t("contactImports.signup.oauthDisclosure", {
                          provider: t(`contactImports.signup.source.${provider}`),
                          fields: fieldList,
                          count: String(offer.maxContacts),
                        })}
                      </p>
                      <form action={beginContactsOAuthAction}>
                        <input type="hidden" name="provider" value={provider} />
                        <Button type="submit" variant="quiet">{t("contactImports.signup.connect", { provider: t(`contactImports.signup.source.${provider}`) })}</Button>
                      </form>
                    </CardBody>
                  </Card>
                ) : null,
              )}
            </div>

            <form action={skipSignupImportAction} className="border-t border-rule pt-5">
              <Button type="submit" variant="quiet">{t("contactImports.signup.skip")}</Button>
              <p className="mt-2 text-xs text-ink-muted">{t("contactImports.signup.skipHint")}</p>
            </form>
          </div>
        ) : offer.batches.length === 0 ? (
          <Callout tone="neutral">{t("contactImports.signup.notOffered")}</Callout>
        ) : null}

        {offer.batches.length > 0 ? (
          <section className="mt-8">
            <h2 className="text-lg font-bold">{t("contactImports.signup.yourBatches")}</h2>
            <p className="mt-1 text-sm text-ink-muted">{t("contactImports.signup.revokeHint")}</p>
            <ul className="mt-4 grid list-none gap-2 p-0">
              {offer.batches.map((batch) => (
                <li key={batch.id} className="flex flex-wrap items-center gap-3 rounded-md border border-rule p-3 text-sm">
                  <a href={localizeCustomerHref(`${ROOT}/${batch.id}`, locale, languagePolicy)} className="font-semibold underline">
                    {t(`contactImports.signup.source.${batch.sourceKind}`)}
                  </a>
                  <Pill>{t(`contactImports.status.${batch.status}`)}</Pill>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {offer.connections.length > 0 ? (
          <section className="mt-8 border-t border-rule pt-6">
            <h2 className="text-lg font-bold">{t("contactImports.signup.connectedSources")}</h2>
            <p className="mt-1 text-sm text-ink-muted">{t("contactImports.signup.connectedSourcesHint")}</p>
            <ul className="mt-4 grid list-none gap-3 p-0">
              {offer.connections.map((connection) => (
                <li key={connection.id} className="flex flex-wrap items-center gap-3 rounded-md border border-rule p-3 text-sm">
                  <strong>{t(`contactImports.signup.source.${connection.provider}`)}</strong>
                  {connection.email ? <span className="text-ink-muted">{connection.email}</span> : null}
                  <form action={disconnectSignupContactsAction} className="ms-auto">
                    <input type="hidden" name="accountId" value={connection.id} />
                    <Button type="submit" variant="danger">{t("contactImports.signup.disconnect")}</Button>
                  </form>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </main>
    </>
  );
}
