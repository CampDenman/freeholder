// Copyright (C) 2026 Camp Denman Society
// SPDX-License-Identifier: AGPL-3.0-only
// One chrome Section, rendered for the editor canvas. Same renderer, same
// bridge, different subject — which is the point of the context split.
import { notFound } from "next/navigation";
import { getSection } from "@/modules/cms/service";
import { renderBlocks } from "@/modules/cms/render";
import type { BlockNode } from "@/modules/cms/blocks/types";
import { getBusiness } from "@/core/settings/service";
import { getLocale, getT } from "../../../../i18n";
import { requireStaffActor } from "../../../../(admin)/admin/guard";

export const dynamic = "force-dynamic";

const ANONYMOUS = { kind: "anonymous" } as const;

export default async function SectionPreview({
  params,
}: {
  params: Promise<{ key: string }>;
}) {
  await requireStaffActor();
  const { key } = await params;

  const [section, locale, t, business] = await Promise.all([
    getSection.call({ key }, ANONYMOUS),
    getLocale(),
    getT(),
    getBusiness.call({}, ANONYMOUS),
  ]);
  if (!section) notFound();

  return (
    <>
      {await renderBlocks(section.blocks as BlockNode[], {
        locale,
        t,
        business: business
          ? { name: business.name, tagline: business.tagline }
          : null,
        path: "/",
        identifyBlocks: true,
      })}
    </>
  );
}
