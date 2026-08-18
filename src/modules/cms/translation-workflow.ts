// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Locale workflow on top of i18n (C2.16): machine drafts and SEO completeness.
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { defineService, ServiceError } from "@/core/service";
import { getTranslation, setTranslation } from "@/core/i18n/service";
import { entityTranslations } from "@/core/i18n/schema";
import { pages } from "./schema";
import { parseBlockTree } from "./blocks/registry";
import { applyTranslations, pathKey, translatableStrings } from "./translate";
import type { BlockNode } from "./blocks/types";
import instanceConfig from "../../../freeholder.config";

export interface PageSeoFields {
  title?: string;
  description?: string;
  ogImage?: string;
}

function pageSeo(value: unknown): PageSeoFields {
  if (!value || typeof value !== "object") return {};
  const seo = value as PageSeoFields;
  return {
    title: typeof seo.title === "string" ? seo.title : undefined,
    description: typeof seo.description === "string" ? seo.description : undefined,
    ogImage: typeof seo.ogImage === "string" ? seo.ogImage : undefined,
  };
}

function sourceStrings(title: string, seo: PageSeoFields, blocks: BlockNode[]) {
  const rows: { key: string; value: string }[] = [];
  if (title.trim()) rows.push({ key: "title", value: title });
  if (seo.description?.trim()) rows.push({ key: "seo.description", value: seo.description });
  if (seo.title?.trim()) rows.push({ key: "seo.title", value: seo.title });
  for (const row of translatableStrings(blocks)) {
    rows.push({ key: pathKey(row.path), value: row.value });
  }
  return rows;
}

async function draftValues(
  rows: { key: string; value: string }[],
  locale: string,
  entityId: string,
): Promise<Record<string, string>> {
  const identity = Object.fromEntries(
    rows.map((row) => [row.key, `[draft] ${row.value}`]),
  );
  try {
    const { aiAdapters } = await import("@/adapters/ai");
    const adapter = aiAdapters.get(instanceConfig.adapters.ai);
    if (!adapter.status.available) return identity;
    const result = await adapter.generate({
      purpose: "translation",
      system:
        `Translate each string into ${locale}. Return a JSON object using the same keys. Do not add markup.`,
      input: JSON.stringify(Object.fromEntries(rows.map((row) => [row.key, row.value]))),
      maxOutputTokens: 4000,
      idempotencyKey: `i18n.draft:${entityId}:${locale}`,
    });
    const parsed =
      result.structured && typeof result.structured === "object"
        ? (result.structured as Record<string, unknown>)
        : result.text
          ? (JSON.parse(result.text) as Record<string, unknown>)
          : null;
    if (!parsed) return identity;
    const out: Record<string, string> = {};
    for (const row of rows) {
      const value = parsed[row.key];
      out[row.key] = typeof value === "string" && value.trim() ? value : identity[row.key]!;
    }
    return out;
  } catch {
    return identity;
  }
}

export function seoComplete(fields: {
  title?: string;
  seo?: PageSeoFields;
}): boolean {
  const title = fields.title?.trim() ?? "";
  const description = fields.seo?.description?.trim() ?? "";
  return title.length > 0 && description.length > 0;
}

export const draftPageTranslation = defineService({
  name: "cms.draftPageTranslation",
  summary: "Seed a machine draft. It is never served publicly until reviewed.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({
    pageId: z.string().uuid(),
    locale: z.string().min(2).max(20),
    replace: z.boolean().default(false),
  }),
  handler: async (input, ctx) => {
    const [page] = await ctx.tx.select().from(pages).where(eq(pages.id, input.pageId)).limit(1);
    if (!page) throw new ServiceError("not_found", "That page is not on this site.");
    const existing = await ctx.call(getTranslation, {
      entityType: "page",
      entityId: page.id,
      locale: input.locale,
      includeUnreviewed: true,
    });
    if (existing?.status === "reviewed" && !input.replace) {
      throw new ServiceError(
        "conflict",
        "That translation is already reviewed. Replace it explicitly to draft over it.",
      );
    }
    const blocks = parseBlockTree(page.workingBlocks ?? page.blocks, "page");
    const seo = pageSeo(page.workingSeo ?? page.seo);
    const title = page.workingTitle ?? page.title;
    const rows = sourceStrings(title, seo, blocks);
    const drafted = await draftValues(rows, input.locale, page.id);
    const blockValues: Record<string, string> = {};
    for (const [key, value] of Object.entries(drafted)) {
      if (key !== "title" && key !== "seo.description" && key !== "seo.title") {
        blockValues[key] = value;
      }
    }
    return ctx.call(setTranslation, {
      entityType: "page",
      entityId: page.id,
      locale: input.locale,
      status: "machine",
      fields: {
        title: drafted.title,
        seo: {
          title: drafted["seo.title"],
          description: drafted["seo.description"],
        },
        blocks: applyTranslations(blocks, blockValues),
      },
    });
  },
});

export const pageTranslationReport = defineService({
  name: "cms.pageTranslationReport",
  summary: "Status and SEO completeness for each page in one locale.",
  kind: "query",
  permission: "scoped",
  input: z.object({ locale: z.string().min(2).max(20) }),
  handler: async (input, ctx) => {
    const pageRows = await ctx.tx
      .select({
        id: pages.id,
        title: pages.title,
        slug: pages.slug,
        seo: pages.seo,
      })
      .from(pages);
    const rows = await ctx.tx
      .select({
        entityId: entityTranslations.entityId,
        status: entityTranslations.status,
        fields: entityTranslations.fields,
      })
      .from(entityTranslations)
      .where(
        and(
          eq(entityTranslations.entityType, "page"),
          eq(entityTranslations.locale, input.locale),
        ),
      );
    const byId = new Map(rows.map((row) => [row.entityId, row]));
    return pageRows.map((page) => {
      const translation = byId.get(page.id);
      const fields = (translation?.fields ?? {}) as {
        title?: string;
        seo?: PageSeoFields;
      };
      const sourceSeo = pageSeo(page.seo);
      return {
        pageId: page.id,
        title: page.title,
        slug: page.slug,
        status: translation?.status ?? "missing",
        seoComplete: translation
          ? seoComplete(fields)
          : Boolean(page.title.trim() && sourceSeo.description?.trim()),
      };
    });
  },
});
