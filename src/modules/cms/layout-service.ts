// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Per-entity layout detach / rejoin (C2.14).
import { z } from "zod";
import { eq } from "drizzle-orm";
import { row, timestamp, uuid } from "@/core/contract";
import { defineService, ServiceError, type ServiceContext } from "@/core/service";
import { parseBlockTree } from "./blocks/registry";
import type { BlockNode } from "./blocks/types";
import { cloneTree } from "./section-instances";
import {
  contentLayouts,
  LAYOUT_ENTITY_TYPES,
  pages,
  type LayoutEntityType,
} from "./schema";
import { getTemplate } from "./template-service";

export interface LayoutBindings {
  title?: string;
  slug?: string;
  productId?: string;
  locationId?: string;
  eventId?: string;
}

const entityTypeSchema = z.enum(LAYOUT_ENTITY_TYPES);
const layoutRow = row({
  id: uuid,
  pageId: uuid,
  entityType: entityTypeSchema,
  entityId: uuid,
  templateKey: z.string(),
  detached: z.boolean(),
  createdAt: timestamp,
  updatedAt: timestamp,
});

function templateKeyFor(entityType: LayoutEntityType): string {
  switch (entityType) {
    case "product":
      return "product.default";
    case "service":
      return "service.default";
    case "post":
      return "post.article";
    case "location":
    case "event":
    case "gallery":
    case "page":
      return "page.landing";
    default:
      return "page.blank";
  }
}

export function ensureBoundEntityBlock(
  nodes: BlockNode[],
  entityType: LayoutEntityType,
  bind: LayoutBindings,
): BlockNode[] {
  if (entityType === "product" || entityType === "service") {
    let bound = nodes;
    // Service pages need both the booking surface and the live entity facts.
    // The latter also carries C8.01's reciprocal links to published work;
    // treating either block as a substitute for the other silently removed
    // proof from every default service template, because it already booked.
    if (bind.productId && bind.slug && !bound.some((node) => node.type === "productDetail")) {
      bound = [
        ...bound,
        {
          id: "bound-product",
          type: "productDetail",
          props: { productId: bind.productId, slug: bind.slug },
        },
      ];
    }
    if (entityType === "service") {
      if (!bound.some((node) => node.type === "booking")) {
        bound = [
          ...bound,
          {
            id: "bound-booking",
            type: "booking",
            props: { slug: bind.slug ?? "session", ctaHref: "/contact" },
          },
        ];
      }
    }
    return bound;
  }
  if (entityType === "location" && bind.locationId && !nodes.some((node) => node.type === "nap")) {
    return [
      ...nodes,
      {
        id: "bound-nap",
        type: "nap",
        props: {
          locationId: bind.locationId,
          showAddress: true,
          showPhone: true,
          showEmail: true,
          showHours: true,
        },
      },
    ];
  }
  if (entityType === "event" && bind.eventId && bind.slug && !nodes.some((node) => node.type === "eventDetail")) {
    return [
      ...nodes,
      {
        id: "bound-event",
        type: "eventDetail",
        props: { eventId: bind.eventId, slug: bind.slug },
      },
    ];
  }
  return nodes;
}

export function applyLayoutBindings(nodes: BlockNode[], bind: LayoutBindings): BlockNode[] {
  return nodes.map((node) => {
    const props = { ...node.props };
    if (node.type === "heading" && node.props.level === 1 && bind.title) {
      props.text = bind.title;
    }
    if (node.type === "productDetail") {
      if (bind.productId) props.productId = bind.productId;
      if (bind.slug) props.slug = bind.slug;
    }
    if (node.type === "booking" && bind.slug) {
      props.slug = bind.slug;
    }
    if (node.type === "nap" && bind.locationId) {
      props.locationId = bind.locationId;
    }
    if (node.type === "eventDetail") {
      if (bind.eventId) props.eventId = bind.eventId;
      if (bind.slug) props.slug = bind.slug;
    }
    return {
      ...node,
      props,
      children: node.children ? applyLayoutBindings(node.children, bind) : undefined,
    };
  });
}

export const getLayout = defineService({
  name: "cms.getLayout",
  summary: "The template attachment for a page, if it has one.",
  kind: "query",
  permission: "scoped",
  input: z.object({ pageId: z.string().uuid() }),
  output: layoutRow.nullable(),
  handler: async (input, ctx) => {
    const [row] = await ctx.tx
      .select()
      .from(contentLayouts)
      .where(eq(contentLayouts.pageId, input.pageId))
      .limit(1);
    return row ?? null;
  },
});

export const attachLayout = defineService({
  name: "cms.attachLayout",
  summary: "Record that a page follows (or starts from) a template.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({
    pageId: z.string().uuid(),
    entityType: entityTypeSchema,
    entityId: z.string().uuid(),
    templateKey: z.string().min(1).max(80),
    detached: z.boolean().default(false),
  }),
  output: layoutRow,
  handler: async (input, ctx) => {
    const [page] = await ctx.tx.select({ id: pages.id }).from(pages).where(eq(pages.id, input.pageId)).limit(1);
    if (!page) throw new ServiceError("not_found", "That page is not on this site.");
    const [existing] = await ctx.tx
      .select()
      .from(contentLayouts)
      .where(eq(contentLayouts.pageId, input.pageId))
      .limit(1);
    if (existing) {
      const [updated] = await ctx.tx
        .update(contentLayouts)
        .set({
          entityType: input.entityType,
          entityId: input.entityId,
          templateKey: input.templateKey,
          detached: input.detached,
        })
        .where(eq(contentLayouts.id, existing.id))
        .returning();
      return updated!;
    }
    const [created] = await ctx.tx
      .insert(contentLayouts)
      .values({
        pageId: input.pageId,
        entityType: input.entityType,
        entityId: input.entityId,
        templateKey: input.templateKey,
        detached: input.detached,
      })
      .returning();
    ctx.setSubject("page", input.pageId);
    ctx.queueEvent("cms.layoutAttached", {
      pageId: input.pageId,
      entityType: input.entityType,
    });
    return created!;
  },
});

export const detachLayout = defineService({
  name: "cms.detachLayout",
  summary: "Stop following the template so this page can diverge.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({ pageId: z.string().uuid() }),
  output: layoutRow,
  handler: async (input, ctx) => {
    const [row] = await ctx.tx
      .select()
      .from(contentLayouts)
      .where(eq(contentLayouts.pageId, input.pageId))
      .limit(1);
    if (!row) throw new ServiceError("not_found", "That page is not attached to a template.");
    if (row.detached) return row;
    const [updated] = await ctx.tx
      .update(contentLayouts)
      .set({ detached: true })
      .where(eq(contentLayouts.id, row.id))
      .returning();
    ctx.setSubject("page", input.pageId);
    ctx.queueEvent("cms.layoutDetached", { pageId: input.pageId });
    return updated!;
  },
});

export const rejoinLayout = defineService({
  name: "cms.rejoinLayout",
  summary: "Throw away the override and follow the template again.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({
    pageId: z.string().uuid(),
    bindings: z
      .object({
        title: z.string().optional(),
        slug: z.string().optional(),
        productId: z.string().uuid().optional(),
        locationId: z.string().uuid().optional(),
        eventId: z.string().uuid().optional(),
      })
      .optional(),
    locale: z.string().default("en"),
  }),
  output: z.object({
    layout: layoutRow,
    blocks: z.unknown(),
  }),
  handler: async (input, ctx) => {
    const [row] = await ctx.tx
      .select()
      .from(contentLayouts)
      .where(eq(contentLayouts.pageId, input.pageId))
      .limit(1);
    if (!row) throw new ServiceError("not_found", "That page is not attached to a template.");
    const template = await ctx.call(getTemplate, {
      key: row.templateKey,
      locale: input.locale,
    });
    if (!template) {
      throw new ServiceError("not_found", "The template this page followed is gone.");
    }
    const stamp = Math.random().toString(36).slice(2, 7);
    const blocks = applyLayoutBindings(
      cloneTree(parseBlockTree(template.blocks, "page"), stamp),
      input.bindings ?? {},
    );
    const [page] = await ctx.tx.select().from(pages).where(eq(pages.id, input.pageId)).limit(1);
    if (!page) throw new ServiceError("not_found", "That page is not on this site.");
    await ctx.tx
      .update(pages)
      .set({
        blocks,
        workingBlocks: blocks,
        version: page.version + 1,
      })
      .where(eq(pages.id, input.pageId));
    const [updated] = await ctx.tx
      .update(contentLayouts)
      .set({ detached: false })
      .where(eq(contentLayouts.id, row.id))
      .returning();
    ctx.setSubject("page", input.pageId);
    ctx.queueEvent("cms.layoutRejoined", { pageId: input.pageId });
    return { layout: updated!, blocks };
  },
});

export async function blocksFromTemplate(
  ctx: Pick<ServiceContext, "call">,
  entityType: LayoutEntityType,
  bind: LayoutBindings,
  locale = "en",
): Promise<{ blocks: BlockNode[]; templateKey: string }> {
  const templateKey = templateKeyFor(entityType);
  const template = await ctx.call(getTemplate, { key: templateKey, locale });
  const seed = template
    ? parseBlockTree(template.blocks, "page")
    : [{ id: "fallback-h1", type: "heading", props: { text: bind.title ?? "Untitled", level: 1, align: "start" } }];
  const stamp = Math.random().toString(36).slice(2, 7);
  return {
    templateKey,
    blocks: ensureBoundEntityBlock(
      applyLayoutBindings(cloneTree(seed, stamp), bind),
      entityType,
      bind,
    ),
  };
}

export { templateKeyFor };
