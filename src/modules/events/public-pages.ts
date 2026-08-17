// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Public event pages: /events index and /events/{slug} (MASTER.md §5, C2.21).

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
import { events } from "./schema";

export const EVENTS_INDEX_SLUG = "events";

function pathFor(slug: string): string {
  return `${EVENTS_INDEX_SLUG}/${slug}`;
}

function eventBlocks(eventId: string, slug: string, name: string): BlockNode[] {
  return [
    { id: "event-h1", type: "heading", props: { text: name, level: 1, align: "start" } },
    { id: "event-detail", type: "eventDetail", props: { eventId, slug } },
  ];
}

function indexBlocks(title: string): BlockNode[] {
  return [
    { id: "events-h1", type: "heading", props: { text: title, level: 1, align: "start" } },
    { id: "events-list", type: "eventsIndex", props: {} },
  ];
}

async function pageAt(ctx: ServiceContext, slug: string, locale: string) {
  const [page] = await ctx.tx
    .select({ id: pages.id, slug: pages.slug })
    .from(pages)
    .where(and(eq(pages.slug, slug), eq(pages.locale, locale)))
    .limit(1);
  return page ?? null;
}

async function pageOwnedBy(ctx: ServiceContext, eventId: string, locale: string): Promise<string | null> {
  const rows = await ctx.tx
    .select({ id: pages.id, blocks: pages.blocks })
    .from(pages)
    .where(eq(pages.locale, locale));
  for (const row of rows) {
    const blocks = row.blocks as BlockNode[];
    if (blocks.some((block) => block.type === "eventDetail" && block.props.eventId === eventId)) {
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
        if (!links.some((link) => link.href === `/${EVENTS_INDEX_SLUG}`)) {
          node.props.links = [...links, { label: "Events", href: `/${EVENTS_INDEX_SLUG}` }];
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
  if (await pageAt(ctx, EVENTS_INDEX_SLUG, locale)) return;
  const created = await ctx.callAsSystem(createPage, {
    slug: EVENTS_INDEX_SLUG,
    locale,
    title: "Events",
    blocks: indexBlocks("Events"),
    seo: { description: "Upcoming events and classes." },
  });
  await ctx.callAsSystem(publishPage, { id: created.id, published: true });
  await linkFromNav(ctx, locale);
}

export async function syncEventPublicPage(ctx: ServiceContext, eventId: string): Promise<void> {
  const [event] = await ctx.tx.select().from(events).where(eq(events.id, eventId)).limit(1);
  if (!event) return;
  const locale = await localeOf(ctx);
  await ensureIndex(ctx, locale);
  const target = pathFor(event.slug);
  const owned = await pageOwnedBy(ctx, event.id, locale);
  const shouldPublish = event.status === "published";
  if (!owned && !shouldPublish) return;
  if (!owned) {
    const created = await ctx.callAsSystem(createPage, {
      slug: target,
      locale,
      title: event.name,
      blocks: eventBlocks(event.id, event.slug, event.name),
      seo: { description: event.seo.description ?? event.summary ?? `Event: ${event.name}` },
    });
    if (shouldPublish) await ctx.callAsSystem(publishPage, { id: created.id, published: true });
    return;
  }
  await ctx.callAsSystem(updatePage, {
    id: owned,
    slug: target,
    title: event.name,
    seo: { description: event.seo.description ?? event.summary ?? `Event: ${event.name}` },
  });
  await ctx.callAsSystem(publishPage, { id: owned, published: shouldPublish });
}
