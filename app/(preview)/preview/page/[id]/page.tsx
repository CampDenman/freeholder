// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// One page, rendered for the editor canvas.
//
// It reads the *saved* tree. The editor overlays its local draft onto the
// typeable elements (see canvas-bridge.ts) the moment a keystroke lands, so
// the canvas keeps up while typing; every successful save then reloads this
// frame from stored state, which is what reconverges anything the text patch
// cannot express and keeps the guarantee that the canvas never disagrees with
// the page for long.
//
// Drafts render here and nowhere else: `cms.getPage` is staff-only and sees
// them, while the public route asks `cms.resolvePage`, which does not.
import { notFound } from "next/navigation";
import { getPage } from "@/modules/cms/service";
import { renderBlocks } from "@/modules/cms/render";
import type { BlockNode } from "@/modules/cms/blocks/types";
import { ServiceError } from "@/core/service";
import { getLocale, getT } from "../../../../i18n";
import { requireStaffActor } from "../../../../(admin)/admin/guard";
import { currentBusiness } from "@/core/settings/read";

export const dynamic = "force-dynamic";


export default async function PagePreview({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const actor = await requireStaffActor();
  const { id } = await params;

  const page = await getPage.call({ id }, actor).catch((error: unknown) => {
    if (error instanceof ServiceError) notFound();
    throw error;
  });

  const [locale, t, business] = await Promise.all([
    getLocale(),
    getT(),
    currentBusiness(),
  ]);

  return (
    <>
      {await renderBlocks((page.workingBlocks ?? page.blocks) as BlockNode[], {
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
        path: page.slug === "" ? "/" : `/${page.slug}`,
        identifyBlocks: true,
      })}
    </>
  );
}
