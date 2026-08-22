// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Where somebody lands after accepting a quote (C6.12).
//
// The link is spent at acceptance — an offer that has become an agreement is
// no longer an offer — so the page they were on has genuinely stopped
// existing. Saying so plainly beats a dead link, and what happens next reaches
// them the same way the quote did.
import type { Metadata } from "next";
import { getT } from "../../../i18n";

export const dynamic = "force-dynamic";
export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return {
    title: t("quote.acceptedTitle"),
    robots: { index: false, follow: false },
    referrer: "no-referrer",
  };
}

export default async function QuoteAcceptedPage() {
  const t = await getT();
  return (
    <div className="mx-auto grid max-w-2xl gap-4 p-6">
      <h1 className="text-xl font-bold tracking-tight">{t("quote.acceptedTitle")}</h1>
      <p className="max-w-prose text-sm text-ink-muted">{t("quote.acceptedBody")}</p>
    </div>
  );
}
