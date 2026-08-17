// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Public newsletter archive: /newsletters and /newsletters/{issue} (C9.04, C2.21).

import { and, eq } from "drizzle-orm";
import type { ServiceContext } from "@/core/service";
import { pages } from "@/modules/cms/schema";
import { HEADER_KEY } from "@/modules/cms/defaults";
import {
  createPage,
  getSection,
  publishPage,
  updatePage,
  updateSection,
} from "@/modules/cms/service";
import type { BlockNode } from "@/modules/cms/blocks/types";
import { getBusiness } from "@/core/settings/service";
import { newsletterIssues, newsletters } from "./schema";

export const NEWSLETTERS_INDEX_SLUG = "newsletters";

function pathFor(slug: string): string {
  return `${NEWSLETTERS_INDEX_SLUG}/${slug}`;
}

function issueBlocks(issueId: string, slug: string, title: string): BlockNode[] {
  return [
    { id: "issue-h1", type: "heading", props: { text: title, level: 1, align: "start" } },
    { id: "issue-body", type: "newsletterIssue", props: { issueId, slug } },
    { id: "issue-subscribe", type: "newsletterSubscribe", props: {} },
  ];
}

function indexBlocks(): BlockNode[] {
  return [
    { id: "newsletters-h1", type: "heading", props: { text: "Newsletters", level: 1, align: "start" } },
    { id: "newsletters-archive", type: "newsletterArchive", props: {} },
    { id: "newsletters-subscribe", type: "newsletterSubscribe", props: {} },
  ];
}

async function pageAt(ctx: ServiceContext, slug: string, locale: string) {
  const [page] = await ctx.tx
    .select({ id: pages.id })
    .from(pages)
    .where(and(eq(pages.slug, slug), eq(pages.locale, locale)))
    .limit(1);
  return page ?? null;
}

async function pageOwnedBy(ctx: ServiceContext, issueId: string, locale: string): Promise<string | null> {
  const rows = await ctx.tx
    .select({ id: pages.id, blocks: pages.blocks })
    .from(pages)
    .where(eq(pages.locale, locale));
  for (const row of rows) {
    const blocks = row.blocks as BlockNode[];
    if (blocks.some((block) => block.type === "newsletterIssue" && block.props.issueId === issueId)) {
      return row.id;
    }
  }
  return null;
}

async function localeOf(ctx: ServiceContext): Promise<string> {
  const business = await ctx.callAsSystem(getBusiness, {});
  return business?.defaultLocale ?? "en";
}

async function linkFromNav(ctx: ServiceContext, locale: string): Promise<void> {
  const header = await ctx.callAsSystem(getSection, { key: HEADER_KEY, locale });
  if (!header) return;
  const blocks = structuredClone(header.blocks) as BlockNode[];
  let linked = false;
  const walk = (nodes: BlockNode[]): void => {
    for (const node of nodes) {
      if (node.type === "nav") {
        const links = (node.props.links ?? []) as Array<{ label: string; href: string }>;
        if (!links.some((link) => link.href === `/${NEWSLETTERS_INDEX_SLUG}`)) {
          node.props.links = [...links, { label: "Newsletters", href: `/${NEWSLETTERS_INDEX_SLUG}` }];
          linked = true;
        }
        return;
      }
      if (node.children) walk(node.children);
    }
  };
  walk(blocks);
  if (linked) await ctx.callAsSystem(updateSection, { key: HEADER_KEY, locale, blocks });
}

async function ensureIndex(ctx: ServiceContext, locale: string): Promise<void> {
  if (await pageAt(ctx, NEWSLETTERS_INDEX_SLUG, locale)) return;
  const created = await ctx.callAsSystem(createPage, {
    slug: NEWSLETTERS_INDEX_SLUG,
    locale,
    title: "Newsletters",
    blocks: indexBlocks(),
    seo: { description: "Public newsletter archive." },
  });
  await ctx.callAsSystem(publishPage, { id: created.id, published: true });
  await linkFromNav(ctx, locale);
}

export async function syncNewsletterIssuePage(ctx: ServiceContext, issueId: string): Promise<void> {
  const [issue] = await ctx.tx
    .select()
    .from(newsletterIssues)
    .where(eq(newsletterIssues.id, issueId))
    .limit(1);
  if (!issue) return;
  const [newsletter] = await ctx.tx
    .select()
    .from(newsletters)
    .where(eq(newsletters.id, issue.newsletterId))
    .limit(1);
  const locale = await localeOf(ctx);
  await ensureIndex(ctx, locale);
  const target = pathFor(issue.slug);
  const owned = await pageOwnedBy(ctx, issue.id, locale);
  const shouldPublish = issue.status === "published";
  const description =
    issue.seo.description ?? issue.excerpt ?? `${newsletter?.name ?? "Newsletter"}: ${issue.title}`;
  if (!owned && !shouldPublish) return;
  if (!owned) {
    const created = await ctx.callAsSystem(createPage, {
      slug: target,
      locale,
      title: issue.title,
      blocks: issueBlocks(issue.id, issue.slug, issue.title),
      seo: { description },
    });
    if (shouldPublish) await ctx.callAsSystem(publishPage, { id: created.id, published: true });
    return;
  }
  await ctx.callAsSystem(updatePage, { id: owned, slug: target, title: issue.title, seo: { description } });
  await ctx.callAsSystem(publishPage, { id: owned, published: shouldPublish });
}
