// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// A gift card claim page (C9.35 / §34). The URL is the credential.
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Card, CardBody, CardHeader } from "@/ui/primitives";
import { SkipLink } from "@/ui/SkipLink";
import { formatMoney } from "@/core/i18n";
import { currentBusiness } from "@/core/settings/read";
import { giftCardByShareToken } from "@/modules/catalog/service";
import { getT } from "../../i18n";

export const dynamic = "force-dynamic";
export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return {
    title: t("catalog.gift.title"),
    robots: { index: false, follow: false },
    referrer: "no-referrer",
  };
}

export default async function GiftCardClaimPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const [t, business, card] = await Promise.all([
    getT(),
    currentBusiness(),
    giftCardByShareToken.call({ token }, { kind: "anonymous" }),
  ]);
  if (!card) notFound();

  const locale = business?.defaultLocale ?? "en";
  const remaining = formatMoney(card.remainingMinor, card.currency, locale);

  return (
    <div className="mx-auto grid max-w-md gap-6 p-6">
      <SkipLink target="main">{t("a11y.skipToContent")}</SkipLink>
      <main id="main" className="grid gap-6">
        <h1 className="text-xl font-bold tracking-tight">{t("catalog.gift.title")}</h1>
        <p className="text-sm text-ink-muted">{t("catalog.gift.intro")}</p>
        <Card>
          <CardHeader title={t("catalog.gift.balance", { remaining })} />
          <CardBody>
            <label className="grid gap-1 text-sm">
              <span className="text-ink-muted">{t("catalog.gift.code")}</span>
              <input
                readOnly
                value={card.code}
                className="rounded-md border border-rule bg-field px-2 py-1 font-mono text-sm text-ink"
              />
            </label>
          </CardBody>
        </Card>
      </main>
    </div>
  );
}
