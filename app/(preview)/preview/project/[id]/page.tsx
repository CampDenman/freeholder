// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Saved case-study narrative rendered through the real CMS renderer.
import { notFound } from "next/navigation";
import { ServiceError } from "@/core/service";
import { currentBusiness } from "@/core/settings/read";
import { getProject } from "@/modules/projects/service";
import { renderBlocks } from "@/modules/cms/render";
import { getLocale, getT } from "../../../../i18n";
import { requireStaffActor } from "../../../../(admin)/admin/guard";

export const dynamic = "force-dynamic";

export default async function ProjectPreview({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requireStaffActor("projects");
  const { id } = await params;
  const project = await getProject.call({ id }, actor).catch((error: unknown) => {
    if (error instanceof ServiceError) notFound();
    throw error;
  });
  if (!project) notFound();
  const [locale, t, business] = await Promise.all([getLocale(), getT(), currentBusiness()]);
  return (
    <>
      {await renderBlocks(project.blocks, {
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
        path: `/portfolio/${project.slug}`,
        identifyBlocks: true,
      })}
    </>
  );
}
