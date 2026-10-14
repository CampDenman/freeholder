// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.08 (MASTER.md §44.8): what members sell, newest first.
import type { Metadata } from "next";
import { cookies } from "next/headers";
import { SESSION_COOKIE } from "@/core/auth/sessions";
import { actorFromToken } from "@/core/http/actor";
import { formatMoney } from "@/core/i18n";
import { marketListings } from "@/modules/catalog/market";
import { LISTING_KINDS } from "@/modules/members/listings";
import { membershipRules } from "@/modules/members/service";
import { Button, Field, Input, Select } from "@/ui/primitives";
import { getLocale, getT } from "../../i18n";

export const dynamic = "force-dynamic";
export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("members.market.title") };
}

export default async function MarketPage({ searchParams }: { searchParams: Promise<{ q?: string; kind?: string }> }) {
  const [t, locale, jar, query] = await Promise.all([getT(), getLocale(), cookies(), searchParams]);
  const actor = await actorFromToken(jar.get(SESSION_COOKIE)?.value);
  const rules = await membershipRules.call({}, actor);
  const kind = (LISTING_KINDS as readonly string[]).includes(query.kind ?? "") ? (query.kind as (typeof LISTING_KINDS)[number]) : undefined;
  const listings = rules.marketplaceEnabled ? await marketListings.call({ term: query.q || undefined, kind }, actor) : [];
  return (
    <div className="mx-auto grid max-w-4xl gap-6 px-6 py-12">
      <h1 className="text-3xl font-semibold">{t("members.market.title")}</h1>
      <p className="text-ink-muted">{t("members.market.intro")}</p>
      <form className="flex flex-wrap items-end gap-3" action="/market">
        <Field label={t("members.market.search")} htmlFor="market-q">
          <Input id="market-q" name="q" defaultValue={query.q ?? ""} maxLength={100} />
        </Field>
        <Field label={t("members.listings.field.kind")} htmlFor="market-kind">
          <Select id="market-kind" name="kind" defaultValue={kind ?? ""}>
            <option value="">{t("members.market.anyKind")}</option>
            {LISTING_KINDS.map((k) => <option key={k} value={k}>{t(`members.listings.kind.${k}`)}</option>)}
          </Select>
        </Field>
        <Button type="submit" variant="quiet">{t("members.market.searchButton")}</Button>
      </form>
      {listings.length === 0 ? <p className="text-ink-muted">{t("members.market.empty")}</p> : null}
      <ul className="grid gap-4 sm:grid-cols-2">
        {listings.map((l) => (
          <li key={l.id} className="grid gap-1 rounded-lg border border-rule bg-surface p-4">
            <a className="font-semibold underline" href={`/products/${l.slug}`}>{l.name}</a>
            <span className="text-sm text-ink-muted">{t(`members.listings.kind.${l.kind}`)}</span>
            {l.priceMinor !== null && l.currency ? <span>{formatMoney(l.priceMinor, l.currency, locale)}</span> : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
