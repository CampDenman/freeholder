// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Reading and signing an agreement (C6.09, MASTER.md §4.3).
//
// The whole page is the words. A waiver rendered small, behind a scroll, next
// to a pre-ticked box is a waiver a court reads as unread — so the body is the
// primary content here, the signature sits below it, and the name is typed
// rather than pre-filled, because typing your own name *is* the act being
// recorded.
//
// Signed documents keep answering. Somebody who wants to check what they
// agreed to should not have to ask, and a page that 404s after signing turns a
// record into a rumour.
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Button, Card, CardBody, CardHeader, Pill } from "@/ui/primitives";
import { SkipLink } from "@/ui/SkipLink";
import { currentBusiness } from "@/core/settings/read";
import { getT } from "../../../i18n";
import { declineAgreementAction, signAgreementAction } from "../actions";

export const dynamic = "force-dynamic";
export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return {
    title: t("agreement.title"),
    // The URL is the credential: never indexed, and never handed on as a
    // referrer to whatever the reader clicks next.
    robots: { index: false, follow: false },
    referrer: "no-referrer",
  };
}

export default async function AgreementPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ saved?: string; error?: string }>;
}) {
  const { token } = await params;
  const { contractByToken } = await import("@/modules/contracts/service");
  const [t, business, document, query] = await Promise.all([
    getT(),
    currentBusiness(),
    contractByToken.call({ token }, { kind: "anonymous" }),
    searchParams,
  ]);
  if (!document) notFound();

  const locale = business?.defaultLocale ?? "en";
  const signedOn = document.signedAt
    ? new Intl.DateTimeFormat(locale, { dateStyle: "long", timeStyle: "short" }).format(
        new Date(document.signedAt),
      )
    : null;

  return (
    <div className="mx-auto grid max-w-3xl gap-6 p-6">
      <SkipLink target="main">{t("a11y.skipToContent")}</SkipLink>
      <main id="main" className="grid gap-6">
        <div>
          <h1 className="flex flex-wrap items-center gap-2 text-xl font-bold tracking-tight">
            {document.title}
            {document.status === "signed" ? (
              <Pill tone="success">{t("agreement.status.signed")}</Pill>
            ) : document.status === "issued" ? (
              <Pill tone="warning">{t("agreement.status.issued")}</Pill>
            ) : (
              <Pill tone="neutral">{t(`agreement.status.${document.status}`)}</Pill>
            )}
          </h1>
          <p className="mt-1 text-sm text-ink-muted">
            {t("agreement.from", { business: business?.name ?? "" })}
          </p>
        </div>

        {query.error ? (
          <p className="rounded-md border border-danger bg-danger-soft px-3 py-2 text-sm text-danger">
            {query.error.includes(" ") ? query.error : t("agreement.failed")}
          </p>
        ) : null}

        <Card>
          <CardHeader title={t("agreement.terms")} />
          <CardBody>
            {/* `whitespace-pre-wrap` rather than any markup rendering: the
                snapshot is the text somebody agreed to, and running it through
                a formatter would mean the page could show something the
                signature does not cover. */}
            <div className="max-w-prose whitespace-pre-wrap text-sm leading-relaxed">
              {document.body}
            </div>
          </CardBody>
        </Card>

        {document.status === "signed" ? (
          <p className="max-w-prose text-sm text-ink-muted">
            {t("agreement.signedBy", {
              name: document.signerName ?? "",
              when: signedOn ?? "",
            })}
          </p>
        ) : document.status === "issued" ? (
          <Card>
            <CardHeader title={t("agreement.sign")} />
            <CardBody>
              <form action={signAgreementAction} className="grid gap-3">
                <input type="hidden" name="token" value={token} />
                <label className="grid gap-1 text-sm">
                  <span className="text-ink-muted">{t("agreement.field.name")}</span>
                  <input
                    name="signerName"
                    required
                    autoComplete="name"
                    className="max-w-sm rounded-md border border-rule bg-field px-2 py-1 text-sm"
                  />
                </label>
                <p className="max-w-prose text-sm text-ink-muted">
                  {t("agreement.consent")}
                </p>
                {/* Never disabled on what a field contains: the control acts,
                    and the handler validates and says why (§15.10). */}
                <div className="flex flex-wrap items-center gap-3">
                  <Button type="submit">{t("agreement.action.sign")}</Button>
                </div>
              </form>
              <form action={declineAgreementAction} className="grid gap-2">
                <input type="hidden" name="token" value={token} />
                <label className="grid gap-1 text-sm">
                  <span className="text-ink-muted">{t("agreement.field.reason")}</span>
                  <input
                    name="reason"
                    className="max-w-sm rounded-md border border-rule bg-field px-2 py-1 text-sm"
                  />
                </label>
                <div>
                  <Button type="submit" variant="quiet">
                    {t("agreement.action.decline")}
                  </Button>
                </div>
              </form>
            </CardBody>
          </Card>
        ) : (
          <p className="max-w-prose text-sm text-ink-muted">{t("agreement.closed")}</p>
        )}
      </main>
    </div>
  );
}
