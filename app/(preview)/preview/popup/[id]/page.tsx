// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// One popup's body, rendered for the editor canvas (C9.30).
//
// The same renderer, the same bridge, a different subject — which is the point
// of the context split. What the canvas shows is not a preview of the popup:
// it is the popup's blocks through `renderBlocks`, the identical function the
// public surface calls. The dialog chrome around them is deliberately absent,
// because a canvas that opened a modal over the editor would be showing the
// owner a trap rather than their content.
import { notFound } from "next/navigation";
import { translator } from "@/core/i18n";
import { currentBusiness } from "@/core/settings/read";
import { localizeCustomerHref } from "@/core/i18n/customer";
import { renderBlocks } from "@/modules/cms/render";
import type { BlockNode } from "@/modules/cms/blocks/types";
import { getPopup } from "@/modules/popups/service";
import { requireStaffActor } from "../../../../(admin)/admin/guard";

export const dynamic = "force-dynamic";

export default async function PopupPreview({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const actor = await requireStaffActor("popups");
  const [{ id }, business] = await Promise.all([params, currentBusiness()]);
  const policy = {
    defaultLocale: business?.defaultLocale ?? "en",
    enabledLocales: business?.enabledLocales ?? ["en"],
  };
  const locale = policy.defaultLocale;

  const popup = await getPopup.call({ id }, actor).catch(() => null);
  if (!popup) notFound();
  const t = translator(locale);

  return (
    <>
      <h2 className="text-lg font-bold tracking-tight text-ink">{popup.title}</h2>
      {await renderBlocks(popup.blocks as BlockNode[], {
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
