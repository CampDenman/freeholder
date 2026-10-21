// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.09 (MASTER.md §44.8): what a seller has earned and how they are paid.
import type { Metadata } from "next";
import { cookies } from "next/headers";
import { SESSION_COOKIE } from "@/core/auth/sessions";
import { actorFromToken } from "@/core/http/actor";
import { formatDateTime, formatMoney } from "@/core/i18n";
import { currentBusiness } from "@/core/settings/read";
import { myPayoutAccount, myPayouts } from "@/modules/members/payouts";
import { membershipRules } from "@/modules/members/service";
import { Button, Callout, Card, CardBody, CardHeader, Field, Input, Pill } from "@/ui/primitives";
import { getLocale, getT } from "../../../i18n";
import { refreshPayoutAccountAction, savePayoutInstructionsAction, startPayoutSetupAction } from "./actions";
import { payoutSetup } from "@/modules/members/provider-payouts";

export const dynamic = "force-dynamic";
export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("members.payouts.title"), robots: { index: false, follow: false } };
}

export default async function PayoutsPage({ searchParams }: { searchParams: Promise<{ saved?: string; error?: string }> }) {
  const [t, locale, business, jar, query] = await Promise.all([getT(), getLocale(), currentBusiness(), cookies(), searchParams]);
  const actor = await actorFromToken(jar.get(SESSION_COOKIE)?.value);
  const rules = await membershipRules.call({}, actor);
  if (actor.kind !== "user" || !rules.marketplaceEnabled) {
    return (
      <div className="grid gap-4">
        <h1 className="text-2xl font-semibold">{t("members.payouts.title")}</h1>
        <p>{t("members.listings.closed")}</p>
      </div>
    );
  }
  const [account, earnings, setup] = await Promise.all([myPayoutAccount.call({}, actor), myPayouts.call({}, actor), payoutSetup.call({}, actor)]);
  const timezone = business?.timezone ?? "UTC";
  return (
    <div className="grid gap-6">
      <h1 className="text-2xl font-semibold">{t("members.payouts.title")}</h1>
      <p className="text-sm text-ink-muted">
        {t(`members.payouts.model.${rules.payoutModel}`, { days: rules.holdDays })} {rules.siteFeeBps > 0 ? t("members.payouts.fee", { percent: rules.siteFeeBps / 100 }) : t("members.payouts.noFee")}
      </p>
      {query.saved ? <Callout tone="success">{t("members.payouts.saved")}</Callout> : null}
      {query.error ? <Callout tone="danger">{t("members.payouts.failed")}</Callout> : null}
      <Card>
        <CardHeader title={t("members.payouts.howPaid")} status={<Pill tone={account.status === "ready" ? "success" : "warning"}>{t(`members.payouts.account.${account.status}`)}</Pill>} />
        <CardBody>
          {account.manual ? (
            <form action={savePayoutInstructionsAction} className="grid gap-3">
              <Field label={t("members.payouts.instructions")} htmlFor="payout-instructions" hint={t("members.payouts.instructionsHint")}>
                <textarea id="payout-instructions" name="instructions" required minLength={5} maxLength={1000} rows={3} defaultValue={account.instructions ?? ""} className="w-full rounded-md border border-rule-strong bg-field px-3 py-2 text-sm" />
              </Field>
              <div><Button type="submit">{t("members.payouts.saveInstructions")}</Button></div>
            </form>
          ) : !setup.provider ? (
            <p>{t("members.payouts.providerManaged")}</p>
          ) : !setup.configured ? (
            <Callout>{t("members.payouts.notConfigured")}</Callout>
          ) : (
            <div className="grid gap-3">
              <p className="text-sm text-ink-muted">{t(`members.payouts.setupIntro.${setup.provider}`)}</p>
              {setup.kind === "hosted" ? (
                <form action={startPayoutSetupAction}><Button type="submit">{t(account.status === "none" ? "members.payouts.setupStart" : "members.payouts.setupContinue")}</Button></form>
              ) : (
                <form action={startPayoutSetupAction} className="grid gap-3 sm:grid-cols-2">
                  {setup.fields.map((field) => (
                    <Field key={field} label={t(`members.payouts.field.${field}`)} htmlFor={`payout-${field}`}>
                      <Input id={`payout-${field}`} name={field} required maxLength={200} autoComplete="off" />
                    </Field>
                  ))}
                  <div className="sm:col-span-2"><Button type="submit">{t("members.payouts.setupSave")}</Button></div>
                </form>
              )}
              {account.status !== "none" ? (
                <form action={refreshPayoutAccountAction}><Button type="submit" variant="quiet">{t("members.payouts.checkStatus")}</Button></form>
              ) : null}
            </div>
          )}
        </CardBody>
      </Card>
      <Card>
        <CardHeader title={t("members.payouts.earnings")} />
        <CardBody>
          {earnings.totals.length ? (
            <ul className="mb-4 flex flex-wrap gap-4">
              {earnings.totals.map((total) => (
                <li key={`${total.currency}-${total.state}`}>
                  <span className="text-sm text-ink-muted">{t(`members.payouts.state.${total.state}`)}</span>{" "}
                  <strong>{formatMoney(total.netMinor, total.currency, locale)}</strong>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-ink-muted">{t("members.payouts.none")}</p>
          )}
          <ul className="grid gap-2">
            {earnings.payouts.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-rule p-3 text-sm">
                <span>{formatDateTime(p.createdAt, timezone, locale)}</span>
                <span>{t("members.payouts.line", { gross: formatMoney(p.grossMinor, p.currency, locale), fee: formatMoney(p.feeMinor, p.currency, locale), net: formatMoney(p.netMinor, p.currency, locale) })}</span>
                <Pill>{t(`members.payouts.state.${p.state}`)}</Pill>
              </li>
            ))}
          </ul>
        </CardBody>
      </Card>
    </div>
  );
}
