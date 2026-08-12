// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: AGPL-3.0-only
// One chrome Section, rendered for the editor canvas. Same renderer, same
// bridge, different subject — which is the point of the context split.
import { notFound } from "next/navigation";
import { getSection } from "@/modules/cms/service";
import { renderBlocks } from "@/modules/cms/render";
import type { BlockNode } from "@/modules/cms/blocks/types";
import { translator } from "@/core/i18n";
import { localizeCustomerHref, resolveEnabledLocale } from "@/core/i18n/customer";
import { requireStaffActor } from "../../../../(admin)/admin/guard";
import { currentBusiness } from "@/core/settings/read";

export const dynamic = "force-dynamic";

const ANONYMOUS = { kind: "anonymous" } as const;

export default async function SectionPreview({
  params,
  searchParams,
}: {
  params: Promise<{ key: string }>;
  searchParams: Promise<{ locale?: string }>;
}) {
  await requireStaffActor();
  const [{ key }, query, business] = await Promise.all([
    params,
    searchParams,
    currentBusiness(),
  ]);
  const policy = {
    defaultLocale: business?.defaultLocale ?? "en",
    enabledLocales: business?.enabledLocales ?? ["en"],
  };
  const locale = resolveEnabledLocale(query.locale, policy);

  const section = await getSection.call(
    { key, locale, fallback: false },
    ANONYMOUS,
  );
  if (!section) notFound();
  const t = translator(locale);

  return (
    <>
      {await renderBlocks(section.blocks as BlockNode[], {
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
        path: "/",
        localizeHref: (href) => localizeCustomerHref(href, locale, policy),
        identifyBlocks: true,
      })}
    </>
  );
}
