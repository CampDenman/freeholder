// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// One membership, cancelled by the person paying for it (MASTER.md §4.15, C9.13).
import type { Metadata } from "next";
import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { Button, Card, CardBody, CardHeader, Pill } from "@/ui/primitives";
import { SESSION_COOKIE } from "@/core/auth/sessions";
import { actorFromToken } from "@/core/http/actor";
import { myRecords } from "@/core/portal/service";
import { currentBusiness } from "@/core/settings/read";
import { localizeCustomerHref } from "@/core/i18n/customer";
import { getLocale, getT } from "../../../../i18n";
import { cancelMySubscriptionAction } from "../../../subscription-actions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { robots: { index: false, follow: false } };

const TONE = {
  trialing: "accent",
  active: "success",
  past_due: "danger",
  paused: "warning",
  cancelled: "neutral",
  expired: "neutral",
} as const;

export default async function PortalSubscriptionPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ cancelled?: string; error?: string }>;
}) {
  const { id } = await params;
  const query = await searchParams;
  const [locale, t, jar, business] = await Promise.all([
    getLocale(),
    getT(),
    cookies(),
    currentBusiness(),
  ]);
  const href = (path: string) =>
    business ? localizeCustomerHref(path, locale, business) : path;
  const actor = await actorFromToken(jar.get(SESSION_COOKIE)?.value);
  if (actor.kind !== "user") redirect(href("/portal/login"));

  const rooms = await myRecords.call({ section: "subscriptions", limit: 100 }, actor);
  const record = rooms[0]?.records.find((each) => each.id === id);
  if (!record) notFound();

  const status = record.status ?? "active";
  const canCancel =
    !query.cancelled &&
    (status === "active" || status === "trialing" || status === "paused");

  return (
    <section className="grid gap-4">
      <a href={href("/portal/subscriptions")} className="text-sm text-ink-muted">
        {t("subscriptions.portal.back")}
      </a>
      <h1 className="text-2xl font-semibold text-ink">{t("portal.room.subscriptions")}</h1>

      {query.cancelled ? (
        <p className="rounded-md border border-success bg-success-soft px-3 py-2 text-sm text-success">
          {t("subscriptions.cancelled")}
        </p>
      ) : null}
      {query.error ? (
        <p className="rounded-md border border-danger bg-danger-soft px-3 py-2 text-sm text-danger">
          {t("subscriptions.portal.failed")}
        </p>
      ) : null}

      <Card>
        <CardHeader
          title={record.title}
          status={
            <Pill tone={TONE[status as keyof typeof TONE] ?? "neutral"}>
              {t(`subscriptions.status.${status}`)}
            </Pill>
          }
        />
        <CardBody>
          {record.at ? (
            <p className="text-sm text-ink-muted">
              {t(
                query.cancelled || status === "cancelled" || status === "expired"
                  ? "subscriptions.endsAt"
                  : "subscriptions.renewsAt",
                { date: record.at.toLocaleDateString(locale) },
              )}
            </p>
          ) : null}

          {canCancel ? (
            <form action={cancelMySubscriptionAction} className="mt-4 grid gap-3">
              <input type="hidden" name="id" value={record.id} />
              <p className="max-w-prose text-sm text-ink-muted">
                {t("subscriptions.portal.cancelIntro")}
              </p>
              <label className="flex items-start gap-2 text-sm text-ink">
                <input
                  type="checkbox"
                  name="confirm"
                  value="yes"
                  required
                  className="mt-1"
                />
                {t("subscriptions.confirmCancel")}
              </label>
              <div>
                <Button type="submit" variant="danger">
                  {t("subscriptions.action.cancel")}
                </Button>
              </div>
            </form>
          ) : query.cancelled ? (
            <p className="mt-3 text-sm text-ink-muted">{t("subscriptions.leaving")}</p>
          ) : null}
        </CardBody>
      </Card>
    </section>
  );
}
