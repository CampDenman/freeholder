// Copyright (C) 2026 Camp Denman Society
// SPDX-License-Identifier: AGPL-3.0-only
// One page, rendered for the editor canvas.
//
// It reads the *saved* tree — the editor autosaves and then reloads this frame
// — so what the canvas shows is what is stored, never a client-side guess at
// what storing it would do. The lag is the autosave debounce, and it buys the
// guarantee that the preview cannot disagree with the page.
//
// Drafts render here and nowhere else: `cms.getPage` is staff-only and sees
// them, while the public route asks `cms.resolvePage`, which does not.
import { notFound } from "next/navigation";
import { getPage } from "@/modules/cms/service";
import { renderBlocks } from "@/modules/cms/render";
import type { BlockNode } from "@/modules/cms/blocks/types";
import { getBusiness } from "@/core/settings/service";
import { ServiceError } from "@/core/service";
import { getLocale, getT } from "../../../../i18n";
import { requireStaffActor } from "../../../../(admin)/admin/guard";

export const dynamic = "force-dynamic";

const ANONYMOUS = { kind: "anonymous" } as const;

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
    getBusiness.call({}, ANONYMOUS),
  ]);

  return (
    <>
      {await renderBlocks(page.blocks as BlockNode[], {
        locale,
        t,
        business: business
          ? { name: business.name, tagline: business.tagline }
          : null,
        path: page.slug === "" ? "/" : `/${page.slug}`,
        identifyBlocks: true,
      })}
    </>
  );
}
