// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// One template, rendered for the editor canvas (C2.13).
import { notFound } from "next/navigation";
import { getTemplate } from "@/modules/cms/service";
import { renderBlocks } from "@/modules/cms/render";
import type { BlockNode } from "@/modules/cms/blocks/types";
import { translator } from "@/core/i18n";
import { localizeCustomerHref, resolveEnabledLocale } from "@/core/i18n/customer";
import { requireStaffActor } from "../../../../(admin)/admin/guard";
import { currentBusiness } from "@/core/settings/read";

export const dynamic = "force-dynamic";

export default async function TemplatePreview({
  params,
  searchParams,
}: {
  params: Promise<{ key: string }>;
  searchParams: Promise<{ locale?: string }>;
}) {
  const actor = await requireStaffActor();
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

  const template = await getTemplate.call({ key, locale }, actor);
  if (!template) notFound();
  const t = translator(locale);

  return (
    <>
      {await renderBlocks(template.blocks as BlockNode[], {
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
