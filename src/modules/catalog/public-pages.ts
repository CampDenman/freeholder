// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Public product landing pages (MASTER.md §5, C2.21).
//
// Same shape as cms/locations.ts: a product page is a cms page one hop below
// /products, RIBA-compliant by construction, editable, and in the sitemap
// because it is a published page.

import { and, eq } from "drizzle-orm";
import type { ServiceContext } from "@/core/service";
import { pages } from "@/modules/cms/schema";
import { addNavLink, NAV_SECTION_KEYS } from "@/modules/cms/chrome-nav";
import {
  createPage,
  getSection,
  publishPage,
  updatePage,
  updateSection,
} from "@/modules/cms/service";
import type { BlockNode } from "@/modules/cms/blocks/types";
import { getBusiness } from "@/core/settings/service";
import { products } from "./schema";

export const PRODUCTS_INDEX_SLUG = "products";

function pathFor(slug: string): string {
  return `${PRODUCTS_INDEX_SLUG}/${slug}`;
}

function productBlocks(productId: string, slug: string, name: string): BlockNode[] {
  return [
    { id: "product-h1", type: "heading", props: { text: name, level: 1, align: "start" } },
    { id: "product-detail", type: "productDetail", props: { productId, slug } },
  ];
}

function indexBlocks(title: string): BlockNode[] {
  return [
    { id: "products-h1", type: "heading", props: { text: title, level: 1, align: "start" } },
    { id: "products-list", type: "productsIndex", props: {} },
  ];
}

function describeProduct(product: { name: string; subtitle: string | null; seo: { description?: string } }): string {
  return product.seo.description ?? product.subtitle ?? `Details for ${product.name}.`;
}

async function pageAt(ctx: ServiceContext, slug: string, locale: string) {
  const [page] = await ctx.tx
    .select({ id: pages.id, slug: pages.slug, status: pages.status })
    .from(pages)
    .where(and(eq(pages.slug, slug), eq(pages.locale, locale)))
    .limit(1);
  return page ?? null;
}

async function pageOwnedBy(ctx: ServiceContext, productId: string, locale: string): Promise<string | null> {
  const rows = await ctx.tx
    .select({ id: pages.id, blocks: pages.blocks })
    .from(pages)
    .where(eq(pages.locale, locale));
  for (const row of rows) {
    const blocks = row.blocks as BlockNode[];
    if (blocks.some((block) => block.type === "productDetail" && block.props.productId === productId)) {
      return row.id;
    }
  }
  return null;
}

async function defaultLocale(ctx: ServiceContext): Promise<string> {
  const business = await ctx.callAsSystem(getBusiness, {});
  return business?.defaultLocale ?? "en";
}

async function businessName(ctx: ServiceContext): Promise<string> {
  const business = await ctx.callAsSystem(getBusiness, {});
  return business?.name ?? "us";
}

async function linkFromNav(ctx: ServiceContext, locale: string): Promise<void> {
  for (const key of NAV_SECTION_KEYS) {
    const section = await ctx.callAsSystem(getSection, { key, locale });
    if (!section) continue;
    const blocks = structuredClone(section.blocks) as BlockNode[];
    if (addNavLink(blocks, "Products", `/${PRODUCTS_INDEX_SLUG}`)) {
      await ctx.callAsSystem(updateSection, { key, locale, blocks });
      return;
    }
  }
}

async function ensureIndex(ctx: ServiceContext, locale: string): Promise<void> {
  if (await pageAt(ctx, PRODUCTS_INDEX_SLUG, locale)) return;
  const created = await ctx.callAsSystem(createPage, {
    slug: PRODUCTS_INDEX_SLUG,
    locale,
    title: "Products",
    blocks: indexBlocks("Products"),
    seo: { description: `What ${await businessName(ctx)} sells.` },
  });
  await ctx.callAsSystem(publishPage, { id: created.id, published: true });
  await linkFromNav(ctx, locale);
}

export async function syncProductPublicPage(
  ctx: ServiceContext,
  productId: string,
): Promise<void> {
  const [product] = await ctx.tx.select().from(products).where(eq(products.id, productId)).limit(1);
  if (!product) return;

  const locale = await defaultLocale(ctx);
  await ensureIndex(ctx, locale);

  const target = pathFor(product.slug);
  const owned = await pageOwnedBy(ctx, product.id, locale);
  const shouldPublish = product.status === "active" && product.visibility === "public";

  if (!owned && !shouldPublish) return;

  if (!owned) {
    const created = await ctx.callAsSystem(createPage, {
      slug: target,
      locale,
      title: product.name,
      blocks: productBlocks(product.id, product.slug, product.name),
      seo: { description: describeProduct(product) },
    });
    if (shouldPublish) {
      await ctx.callAsSystem(publishPage, { id: created.id, published: true });
    }
    return;
  }

  await ctx.callAsSystem(updatePage, {
    id: owned,
    slug: target,
    title: product.name,
    seo: { description: describeProduct(product) },
  });
  await ctx.callAsSystem(publishPage, { id: owned, published: shouldPublish });
}
