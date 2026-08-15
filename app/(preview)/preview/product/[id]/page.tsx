// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Saved product-description blocks rendered through the real CMS renderer.

import { notFound } from "next/navigation";
import { ServiceError } from "@/core/service";
import { currentBusiness } from "@/core/settings/read";
import { getProduct } from "@/modules/catalog/service";
import { renderBlocks } from "@/modules/cms/render";
import { getLocale, getT } from "../../../../i18n";
import { requireStaffActor } from "../../../../(admin)/admin/guard";

export const dynamic = "force-dynamic";

export default async function ProductPreview({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requireStaffActor("catalog");
  const { id } = await params;
  const bundle = await getProduct.call({ id }, actor).catch((error: unknown) => {
    if (error instanceof ServiceError) notFound();
    throw error;
  });
  const [locale, t, business] = await Promise.all([getLocale(), getT(), currentBusiness()]);
  return (
    <>
      {await renderBlocks(bundle.product.description, {
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
        path: `/products/${bundle.product.slug}`,
        identifyBlocks: true,
      })}
    </>
  );
}
