// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
import type { Metadata } from "next";
import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { AddressBook, CheckCircle, WarningCircle } from "@phosphor-icons/react/dist/ssr";
import { SESSION_COOKIE } from "@/core/auth/sessions";
import { actorFromToken } from "@/core/http/actor";
import { getSignupContactImport } from "@/core/import/signup-contact-service";
import { ServiceError } from "@/core/service";
import { currentBusiness } from "@/core/settings/read";
import { localizeCustomerHref } from "@/core/i18n/customer";
import { Button, Callout, Card, CardBody, CardHeader, Pill } from "@/ui/primitives";
import { SkipLink } from "@/ui/SkipLink";
import { getLocale, getT } from "../../../i18n";
import { PortalLocaleChooser } from "../../PortalLocaleChooser";
import { portalSignOutAction } from "../../actions";
import {
  commitSignupImportAction,
  revertSignupImportAction,
  skipSignupImportAction,
} from "../actions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default async function SignupContactImportPreviewPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; saved?: string }>;
}) {
  const [{ id }, query, actor, business, locale, t] = await Promise.all([
    params,
    searchParams,
    cookies().then((jar) => actorFromToken(jar.get(SESSION_COOKIE)?.value)),
    currentBusiness(),
    getLocale(),
    getT(),
  ]);
  const languagePolicy = {
    defaultLocale: business?.defaultLocale ?? "en",
    enabledLocales: business?.enabledLocales ?? ["en"],
  };
  if (actor.kind !== "user") redirect(localizeCustomerHref("/portal/login", locale, languagePolicy));
  if (actor.grants.length > 0) redirect("/admin");
  let batch: Awaited<ReturnType<typeof getSignupContactImport.call>>;
  try {
    batch = await getSignupContactImport.call({ id }, actor);
  } catch (error) {
    if (error instanceof ServiceError && error.code === "not_found") notFound();
    throw error;
  }
  const counts = batch.counts as Record<string, number>;
  const fields = batch.mapping
    .map((field, index) => ({ field, index }))
    .filter(({ field }) => field !== "ignore");
  const root = localizeCustomerHref("/portal/contact-import", locale, languagePolicy);

  return (
    <>
      <SkipLink>{t("a11y.skipToContent")}</SkipLink>
      <main id="main-content" tabIndex={-1} className="mx-auto max-w-5xl px-6 py-10">
        <header className="mb-8 flex flex-wrap items-center gap-3 border-b border-rule pb-5">
          <AddressBook size={24} weight="duotone" className="text-accent" />
          <div>
            <p className="text-sm font-semibold">{business?.name ?? t("common.appName")}</p>
            <h1 className="text-2xl font-bold tracking-tight">{t("contactImports.signup.previewTitle")}</h1>
          </div>
          <a href={root} className="ms-auto text-sm text-ink-muted underline">{t("contactImports.signup.back")}</a>
          <form action={portalSignOutAction}><button type="submit" className="text-sm text-ink-muted underline">{t("auth.logout")}</button></form>
          <PortalLocaleChooser
            locale={locale}
            policy={languagePolicy}
            path={`/portal/contact-import/${id}`}
            signedIn
            t={t}
          />
        </header>

        {query.error ? <Callout tone="danger" icon={<WarningCircle size={17} weight="fill" />}>{query.error}</Callout> : null}
        {query.saved === "committed" ? <Callout tone="success" icon={<CheckCircle size={17} weight="fill" />}>{t("contactImports.signup.committed")}</Callout> : null}
        {query.saved === "reverted" ? <Callout tone="success">{t("contactImports.signup.reverted")}</Callout> : null}

        <div className="grid gap-6">
          <section className="border-s-4 border-accent ps-5">
            <div className="flex flex-wrap items-center gap-3">
              <h2 className="text-xl font-bold">{t(`contactImports.signup.source.${batch.sourceKind}`)}</h2>
              <Pill>{t(`contactImports.status.${batch.status}`)}</Pill>
            </div>
            <p className="mt-2 text-sm text-ink-muted">{t("contactImports.signup.exactPreview")}</p>
          </section>

          <div className="grid gap-3 sm:grid-cols-5">
            {(["create", "update", "unchanged", "skip", "error"] as const).map((outcome) => (
              <div key={outcome} className="rounded-md border border-rule p-3">
                <div className="text-2xl font-bold">{counts[outcome] ?? 0}</div>
                <div className="text-xs text-ink-muted">{t(`contactImports.outcome.${outcome}`)}</div>
              </div>
            ))}
          </div>

          <Callout tone="neutral">{t("contactImports.signup.noConsent")}</Callout>

          <Card>
            <CardHeader title={t("contactImports.signup.exactRows", { count: String(batch.rows.length) })} />
            <CardBody>
              <div className="max-h-[34rem] overflow-auto rounded-md border border-rule">
                <table className="w-full text-start text-sm">
                  <thead className="sticky top-0 bg-surface-subtle text-xs text-ink-muted">
                    <tr>
                      {fields.map(({ field, index }) => (
                        <th key={`${field}-${index}`} className="px-3 py-2">
                          {t(`contactImports.signup.field.${field}`)}
                        </th>
                      ))}
                      <th className="px-3 py-2">{t("contactImports.column.outcome")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {batch.rows.map((line) => (
                      <tr key={line.id} className="border-t border-rule">
                        {fields.map(({ field, index }) => (
                          <td key={`${field}-${index}`} className="px-3 py-2 align-top">
                            {line.cells[index] || t("contactImports.signup.blank")}
                          </td>
                        ))}
                        <td className="px-3 py-2 align-top">
                          <Pill tone={line.outcome === "error" ? "danger" : line.outcome === "skip" ? "warning" : "neutral"}>
                            {t(`contactImports.outcome.${line.outcome}`)}
                          </Pill>
                          {line.errors.length > 0 ? <p className="mt-1 max-w-xs text-xs text-danger">{line.errors.join(" ")}</p> : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardBody>
          </Card>

          {batch.status === "validated" ? (
            <div className="flex flex-wrap gap-3 border-t border-rule pt-5">
              <form action={commitSignupImportAction}>
                <input type="hidden" name="id" value={batch.id} />
                <Button type="submit">{t("contactImports.signup.apply")}</Button>
              </form>
              <form action={skipSignupImportAction}>
                <input type="hidden" name="id" value={batch.id} />
                <Button type="submit" variant="quiet">{t("contactImports.signup.discardAndSkip")}</Button>
              </form>
            </div>
          ) : batch.status === "committed" ? (
            <div className="border-t border-rule pt-5">
              <form action={revertSignupImportAction}>
                <input type="hidden" name="id" value={batch.id} />
                <Button type="submit" variant="danger">{t("contactImports.signup.undo")}</Button>
              </form>
              <p className="mt-2 max-w-2xl text-xs text-ink-muted">{t("contactImports.signup.undoHint")}</p>
            </div>
          ) : null}
        </div>
      </main>
    </>
  );
}
