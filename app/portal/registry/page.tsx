// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// The customer's own gift list, and the link they send (C9.35).
import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE } from "@/core/auth/sessions";
import { actorFromToken } from "@/core/http/actor";
import { currentBusiness } from "@/core/settings/read";
import { localizeCustomerHref } from "@/core/i18n/customer";
import { WISHLIST_SHARE_COOKIE } from "@/modules/catalog/cookies";
import { listWishlist } from "@/modules/catalog/service";
import { Button } from "@/ui/primitives";
import { getLocale, getT } from "../../i18n";
import { shareMyWishlistAction } from "./actions";

export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function PortalRegistryPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; invited?: string }>;
}) {
  const [locale, t, jar, business, query] = await Promise.all([
    getLocale(),
    getT(),
    cookies(),
    currentBusiness(),
    searchParams,
  ]);
  const actor = await actorFromToken(jar.get(SESSION_COOKIE)?.value);
  if (actor.kind !== "user") {
    const signIn = business
      ? localizeCustomerHref("/portal/login", locale, business)
      : "/portal/login";
    redirect(signIn);
  }

  const list = await listWishlist.call({}, actor).catch(async () => {
    // Staff accounts have no contact. The customer path always does.
    return { wishlist: null, items: [] as Array<{ id: string; sku: string; productName: string }> };
  });

  return (
    <section className="grid gap-4">
      <h1 className="text-2xl font-semibold text-ink">{t("catalog.registry.title")}</h1>
      {query.error ? (
        <p className="rounded-md border border-danger bg-danger-soft px-3 py-2 text-sm text-danger">
          {query.error}
        </p>
      ) : null}
      {query.invited && jar.get(WISHLIST_SHARE_COOKIE)?.value ? (
        <label className="grid gap-1 text-sm">
          <span className="text-ink-muted">{t("catalog.registry.link")}</span>
          <input
            readOnly
            value={jar.get(WISHLIST_SHARE_COOKIE)?.value}
            className="rounded-md border border-rule bg-field px-2 py-1 font-mono text-xs text-ink"
          />
        </label>
      ) : null}
      {list.items.length === 0 ? (
        <p className="text-ink-muted">{t("catalog.registry.empty")}</p>
      ) : (
        <>
          <ul className="grid list-none gap-2 p-0">
            {list.items.map((item) => (
              <li key={item.id} className="text-sm">
                {item.productName}{" "}
                <span className="font-mono text-ink-muted">{item.sku}</span>
              </li>
            ))}
          </ul>
          <form action={shareMyWishlistAction}>
            <Button type="submit">{t("catalog.registry.share")}</Button>
          </form>
        </>
      )}
    </section>
  );
}
