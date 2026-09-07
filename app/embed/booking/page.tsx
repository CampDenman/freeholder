// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
import { currentBusiness } from "@/core/settings/read";
import { siteOrigin } from "@/core/seo/origin";
import { getT } from "../../i18n";

export const dynamic = "force-dynamic";

export default async function EmbedBookingPage() {
  const [t, business] = await Promise.all([getT(), currentBusiness()]);
  const origin = siteOrigin();
  const name = business?.name ?? t("embed.thisBusiness");
  const href = `${origin}/contact`;

  return (
    <section className="grid gap-3">
      <h1 className="text-lg font-bold tracking-tight">{t("embed.booking.title")}</h1>
      <p className="text-sm text-ink-muted">{t("embed.booking.intro", { name })}</p>
      <a
        href={href}
        className="inline-flex w-fit rounded-md bg-accent px-4 py-2 text-sm font-semibold text-on-accent"
        target="_blank"
        rel="noreferrer"
      >
        {t("embed.booking.cta")}
      </a>
      <p className="text-xs text-ink-muted">
        <a href={origin} className="underline" target="_blank" rel="noreferrer">
          {name}
        </a>
      </p>
    </section>
  );
}
