// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.10: what a person bought from members.
import type { Metadata } from "next";
import { cookies } from "next/headers";
import { SESSION_COOKIE } from "@/core/auth/sessions";
import { actorFromToken } from "@/core/http/actor";
import { formatMoney } from "@/core/i18n";
import { myPurchases } from "@/modules/members/protection";
import { Pill } from "@/ui/primitives";
import { getLocale, getT } from "../../../i18n";

export const dynamic = "force-dynamic";
export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("members.sales.purchases"), robots: { index: false, follow: false } };
}

export default async function PurchasesPage() {
  const [t, locale, jar] = await Promise.all([getT(), getLocale(), cookies()]);
  const actor = await actorFromToken(jar.get(SESSION_COOKIE)?.value);
  const bought = actor.kind === "user" ? await myPurchases.call({}, actor) : [];
  return (
    <div className="grid gap-6">
      <h1 className="text-2xl font-semibold">{t("members.sales.purchases")}</h1>
      <p className="text-sm text-ink-muted">{t("members.sales.protectionIntro")}</p>
      {bought.length === 0 ? <p className="text-ink-muted">{t("members.sales.noPurchases")}</p> : null}
      <ul className="grid gap-2">
        {bought.map((s) => (
          <li key={`${s.orderId}-${s.sellerId}`}>
            <a className="flex flex-wrap items-center gap-2 rounded-md border border-rule p-3 underline" href={`/portal/purchases/${s.orderId}/${s.sellerId}`}>
              {s.items.map((i) => i.name).join(", ")} · {s.sellerName} · {formatMoney(s.items.reduce((n, i) => n + i.lineTotalMinor, 0), s.currency, locale)}
              <Pill>{t(`members.sales.fulfilment.${s.fulfilment}`)}</Pill>
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}
