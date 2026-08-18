// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Save-as-Section, detach, and dependency-aware deletion (C2.12).
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { actorString, defineService, ServiceError, type Tx } from "@/core/service";
import { writeRevision } from "./history";
import { isUniqueViolation } from "@/core/db";
import { pages, sections } from "./schema";
import { blockTreeSchema, parseBlockTree } from "./blocks/registry";
import type { BlockNode } from "./blocks/types";
import {
  cloneTree,
  collectSectionKeys,
  collectSectionKeysFromUnknown,
  SECTION_INSTANCE_TYPE,
  slugifySectionName,
} from "./section-instances";

const nodeSchema = z.object({
  id: z.string().min(1),
  type: z.string().min(1),
  props: z.record(z.string(), z.unknown()),
  children: z.array(z.unknown()).optional(),
});

function usageLabel(kind: "page" | "section", title: string, id: string) {
  return { kind, title, id };
}

async function referencedKeys(tx: Tx, start: Iterable<string>): Promise<Set<string>> {
  const seen = new Set<string>();
  const queue = [...start];
  while (queue.length) {
    const key = queue.pop()!;
    if (seen.has(key)) continue;
    seen.add(key);
    const rows = await tx
      .select({ blocks: sections.blocks })
      .from(sections)
      .where(eq(sections.key, key));
    for (const row of rows) {
      for (const next of collectSectionKeysFromUnknown(row.blocks)) {
        if (!seen.has(next)) queue.push(next);
      }
    }
  }
  return seen;
}

export const createSection = defineService({
  name: "cms.createSection",
  summary: "Save a reusable Section from a name and a block tree.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({
    name: z.string().trim().min(1).max(80),
    locale: z.string().default("en"),
    blocks: blockTreeSchema("page"),
    key: z.string().trim().min(1).max(80).optional(),
  }),
  handler: async (input, ctx) => {
    const referenced = collectSectionKeys(input.blocks);
    if (input.key && referenced.has(input.key)) {
      throw new ServiceError(
        "validation",
        "A Section cannot include an instance of itself.",
      );
    }
    const nested = await referencedKeys(ctx.tx, referenced);
    if (input.key && nested.has(input.key)) {
      throw new ServiceError(
        "validation",
        "That tree would loop back to this Section.",
      );
    }
    const base = slugifySectionName(input.key ?? input.name);
    let key = base;
    for (let attempt = 0; attempt < 8; attempt += 1) {
      try {
        const [created] = await ctx.tx
          .insert(sections)
          .values({
            key,
            locale: input.locale,
            name: input.name,
            kind: "reusable",
            blocks: input.blocks,
          })
          .returning();
        await writeRevision(ctx.tx, {
          subjectType: "section",
          subjectId: created!.id,
          title: created!.name,
          blocks: created!.blocks,
          kind: "create",
          actor: actorString(ctx.actor),
        });
        ctx.setSubject("section", created!.id);
        ctx.queueEvent("cms.sectionCreated", { key: created!.key });
        return created!;
      } catch (error) {
        if (!isUniqueViolation(error, "sections_key_locale_idx")) throw error;
        key = `${base}-${Math.random().toString(36).slice(2, 6)}`;
      }
    }
    throw new ServiceError("conflict", "Could not allocate a Section key.");
  },
});

export const saveAsSection = defineService({
  name: "cms.saveAsSection",
  summary: "Turn selected blocks into a synced Section instance.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({
    name: z.string().trim().min(1).max(80),
    locale: z.string().default("en"),
    nodes: z.array(nodeSchema).min(1),
  }),
  handler: async (input, ctx) => {
    const blocks = parseBlockTree(input.nodes, "page");
    const section = await ctx.call(createSection, {
      name: input.name,
      locale: input.locale,
      blocks,
    });
    const instance: BlockNode = {
      id: `section-${section.key}`,
      type: SECTION_INSTANCE_TYPE,
      props: { sectionKey: section.key },
    };
    return { section, instance };
  },
});

export const detachSection = defineService({
  name: "cms.detachSection",
  summary: "Replace a synced Section instance with a local copy of its blocks.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({
    sectionKey: z.string().min(1),
    locale: z.string().default("en"),
  }),
  handler: async (input, ctx) => {
    const [section] = await ctx.tx
      .select()
      .from(sections)
      .where(and(eq(sections.key, input.sectionKey), eq(sections.locale, input.locale)))
      .limit(1);
    if (!section) {
      throw new ServiceError("not_found", "That Section is not on this site.");
    }
    const stamp = Math.random().toString(36).slice(2, 7);
    return {
      nodes: cloneTree(parseBlockTree(section.blocks, "page"), stamp),
    };
  },
});

export const listSectionUsages = defineService({
  name: "cms.listSectionUsages",
  summary: "Pages and Sections that still instance this Section.",
  kind: "query",
  permission: "scoped",
  input: z.object({ key: z.string().min(1) }),
  handler: async (input, ctx) => {
    const pageRows = await ctx.tx
      .select({
        id: pages.id,
        title: pages.title,
        blocks: pages.blocks,
        workingBlocks: pages.workingBlocks,
      })
      .from(pages);
    const sectionRows = await ctx.tx
      .select({
        id: sections.id,
        name: sections.name,
        key: sections.key,
        blocks: sections.blocks,
      })
      .from(sections);
    const usages = [];
    for (const page of pageRows) {
      if (
        collectSectionKeysFromUnknown(page.blocks).has(input.key) ||
        collectSectionKeysFromUnknown(page.workingBlocks).has(input.key)
      ) {
        usages.push(usageLabel("page", page.title, page.id));
      }
    }
    for (const section of sectionRows) {
      if (section.key === input.key) continue;
      if (collectSectionKeysFromUnknown(section.blocks).has(input.key)) {
        usages.push(usageLabel("section", section.name, section.id));
      }
    }
    return usages;
  },
});

export const deleteSection = defineService({
  name: "cms.deleteSection",
  summary: "Delete a reusable Section when nothing still instances it.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({ key: z.string().min(1) }),
  handler: async (input, ctx) => {
    const rows = await ctx.tx
      .select()
      .from(sections)
      .where(eq(sections.key, input.key));
    if (rows.length === 0) {
      throw new ServiceError("not_found", "That Section is not on this site.");
    }
    if (rows.some((row) => row.kind === "chrome")) {
      throw new ServiceError(
        "conflict",
        "Site chrome cannot be deleted. Empty it instead.",
      );
    }
    const usages = await ctx.call(listSectionUsages, { key: input.key });
    if (usages.length > 0) {
      throw new ServiceError(
        "conflict",
        `This Section is still used on ${usages.length === 1 ? "one surface" : `${usages.length} surfaces`}. Detach those instances first.`,
      );
    }
    await ctx.tx.delete(sections).where(eq(sections.key, input.key));
    ctx.setSubject("section", rows[0]!.id);
    ctx.queueEvent("cms.sectionDeleted", { key: input.key });
    return { key: input.key, deleted: rows.length };
  },
});
