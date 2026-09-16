// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// A gallery teaser for other sites. Files stay behind the lock (C8.03).
import { notFound } from "next/navigation";
import { currentBusiness } from "@/core/settings/read";
import { siteOrigin } from "@/core/seo/origin";
import { galleryBySlug } from "@/modules/galleries/service";
import { getT } from "../../../i18n";

export const dynamic = "force-dynamic";

export default async function EmbedGalleryPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const [t, business, lock] = await Promise.all([
    getT(),
    currentBusiness(),
    galleryBySlug.call({ slug }, { kind: "anonymous" }),
  ]);
  if (!lock) notFound();

  const origin = siteOrigin();
  const name = business?.name ?? t("embed.thisBusiness");
  const href = `${origin}/g/${encodeURIComponent(lock.slug)}`;

  return (
    <section className="grid gap-3">
      <h1 className="text-lg font-bold tracking-tight">{lock.title}</h1>
      <p className="text-sm text-ink-muted">
        {lock.expired ? t("galleries.expired") : t("embed.gallery.intro")}
      </p>
      {lock.expired ? null : (
        <a
          href={href}
          className="inline-flex w-fit rounded-md bg-accent px-4 py-2 text-sm font-semibold text-on-accent"
          target="_blank"
          rel="noreferrer"
        >
          {t("embed.gallery.open")}
        </a>
      )}
      <p className="text-xs text-ink-muted">
        <a href={origin} className="underline" target="_blank" rel="noreferrer">
          {name}
        </a>
      </p>
    </section>
  );
}
