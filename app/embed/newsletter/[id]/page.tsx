// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
import { notFound } from "next/navigation";
import { Button } from "@/ui/primitives";
import { currentBusiness } from "@/core/settings/read";
import { siteOrigin } from "@/core/seo/origin";
import { listPublicNewsletters } from "@/modules/newsletters/service";
import { getT } from "../../../i18n";
import { embedSubscribeAction } from "../actions";

export const dynamic = "force-dynamic";

export default async function EmbedNewsletterPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ saved?: string; error?: string }>;
}) {
  const { id } = await params;
  const query = await searchParams;
  const [t, business, newsletters] = await Promise.all([
    getT(),
    currentBusiness(),
    listPublicNewsletters.call({}, { kind: "anonymous" }),
  ]);
  const newsletter = newsletters.find((row) => row.id === id);
  if (!newsletter) notFound();

  const origin = siteOrigin();
  const name = business?.name ?? t("embed.thisBusiness");

  return (
    <section className="grid gap-3">
      <h1 className="text-lg font-bold tracking-tight">{newsletter.name}</h1>
      {newsletter.description ? (
        <p className="text-sm text-ink-muted">{newsletter.description}</p>
      ) : null}
      {query.saved ? (
        <p className="text-sm text-success">{t("embed.newsletter.saved")}</p>
      ) : null}
      {query.error ? (
        <p className="text-sm text-danger">{query.error}</p>
      ) : null}
      <form action={embedSubscribeAction} className="grid gap-2">
        <input type="hidden" name="newsletterId" value={newsletter.id} />
        <label className="grid gap-1 text-sm">
          <span className="text-ink-muted">{t("embed.newsletter.email")}</span>
          <input
            type="email"
            name="email"
            required
            className="rounded-md border border-rule bg-field px-2 py-1 text-sm"
          />
        </label>
        <Button type="submit">{t("embed.newsletter.subscribe")}</Button>
      </form>
      <p className="text-xs text-ink-muted">
        <a href={origin} className="underline" target="_blank" rel="noreferrer">
          {name}
        </a>
      </p>
    </section>
  );
}
