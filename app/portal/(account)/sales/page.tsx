// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.10: what a member sold.
import type { Metadata } from "next";
import { cookies } from "next/headers";
import { SESSION_COOKIE } from "@/core/auth/sessions";
import { actorFromToken } from "@/core/http/actor";
import { formatMoney } from "@/core/i18n";
import { mySales } from "@/modules/members/protection";
import { Pill } from "@/ui/primitives";
import { getLocale, getT } from "../../../i18n";

export const dynamic = "force-dynamic";
export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("members.sales.sales"), robots: { index: false, follow: false } };
}

export default async function SalesPage() {
  const [t, locale, jar] = await Promise.all([getT(), getLocale(), cookies()]);
  const actor = await actorFromToken(jar.get(SESSION_COOKIE)?.value);
  const sales = actor.kind === "user" ? await mySales.call({}, actor) : [];
  return (
    <div className="grid gap-6">
      <h1 className="text-2xl font-semibold">{t("members.sales.sales")}</h1>
      {sales.length === 0 ? <p className="text-ink-muted">{t("members.sales.noSales")}</p> : null}
      <ul className="grid gap-2">
        {sales.map((s) => (
          <li key={`${s.orderId}`}>
            <a className="flex flex-wrap items-center gap-2 rounded-md border border-rule p-3 underline" href={`/portal/sales/${s.orderId}/${s.sellerId}`}>
              {s.items.map((i) => i.name).join(", ")} · {formatMoney(s.items.reduce((n, i) => n + i.lineTotalMinor, 0), s.currency, locale)}
              <Pill>{t(`members.sales.fulfilment.${s.fulfilment}`)}</Pill>
              {s.dispute?.state === "open" ? <Pill tone="warning">{t("members.sales.dispute.open")}</Pill> : null}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}
