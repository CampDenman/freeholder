// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// A shareable look at a working draft. The token is the only credential.
import { notFound } from "next/navigation";
import { resolvePreviewLink } from "@/modules/cms/lifecycle";
import { renderBlocks } from "@/modules/cms/render";
import type { BlockNode } from "@/modules/cms/blocks/types";
import { currentBusiness } from "@/core/settings/read";
import { getLocale, getT } from "../../../../i18n";

export const dynamic = "force-dynamic";

export default async function SharedPreview({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const preview = await resolvePreviewLink.call({ token }, { kind: "anonymous" });
  if (!preview) notFound();

  const [locale, t, business] = await Promise.all([
    getLocale(),
    getT(),
    currentBusiness(),
  ]);

  return (
    <>
      <p className="border-b border-rule bg-surface-muted px-4 py-2 text-sm text-ink-muted">
        {t("cms.preview.draftBanner")}
      </p>
      {await renderBlocks(preview.blocks as BlockNode[], {
        locale,
        t,
        business: business
          ? {
              name: business.name,
              tagline: business.tagline,
              defaultLocale: business.defaultLocale,
              enabledLocales: business.enabledLocales,
            }
          : null,
        path: preview.slug === "" ? "/" : `/${preview.slug}`,
      })}
    </>
  );
}
