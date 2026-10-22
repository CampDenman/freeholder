// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Locale workflow on top of i18n (C2.16): machine drafts and SEO completeness.
import { z } from "zod";
import { and, eq, isNull } from "drizzle-orm";
import { listed, row, timestamp, uuid } from "@/core/contract";
import { createHash } from "node:crypto";
import {
  defineOrchestratedService,
  defineService,
  ServiceError,
  type ServiceContext,
} from "@/core/service";
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

interface DraftedValues {
  values: Record<string, string>;
  /**
   * True only when a translation model actually produced the values. The
   * caller records "machine" strictly on this flag: an identity seed written
   * because no adapter ran must surface as an untranslated draft, never as a
   * finished machine translation the owner believes is French.
   */
  machine: boolean;
}

async function draftValues(
  rows: { key: string; value: string }[],
  locale: string,
  entityId: string,
): Promise<DraftedValues> {
  const identity = Object.fromEntries(
    rows.map((row) => [row.key, `[draft] ${row.value}`]),
  );
  const { aiAdapters } = await import("@/adapters/ai");
  let adapter;
  try {
    adapter = aiAdapters.get(instanceConfig.adapters.ai);
  } catch {
    // The configured provider has no registered implementation. The seed
    // still works; it just must not claim a machine ran.
    return { values: identity, machine: false };
  }
  if (!adapter.status.available) return { values: identity, machine: false };
  try {
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
    if (!parsed) return { values: identity, machine: false };
    const out: Record<string, string> = {};
    for (const row of rows) {
      const value = parsed[row.key];
      out[row.key] = typeof value === "string" && value.trim() ? value : identity[row.key]!;
    }
    return { values: out, machine: true };
  } catch {
    return { values: identity, machine: false };
  }
}

const translationRow = row({
  id: uuid,
  entityType: z.string(),
  entityId: uuid,
  locale: z.string(),
  fields: z.unknown(),
  status: z.enum(["draft", "machine", "reviewed"]),
  translatedBy: z.string().nullable(),
  createdAt: timestamp,
  updatedAt: timestamp,
});
const translationReport = row({
  pageId: uuid,
  title: z.string(),
  slug: z.string(),
  status: z.enum(["draft", "machine", "reviewed", "missing"]),
  seoComplete: z.boolean(),
});

export function seoComplete(fields: {
  title?: string;
  seo?: PageSeoFields;
}): boolean {
  const title = fields.title?.trim() ?? "";
  const description = fields.seo?.description?.trim() ?? "";
  return title.length > 0 && description.length > 0;
}

const draftInput = z.object({
  pageId: z.string().uuid(),
  locale: z.string().min(2).max(20),
  replace: z.boolean().default(false),
});

async function draftablePage(ctx: ServiceContext, input: z.output<typeof draftInput>, lock: boolean) {
  const query = ctx.tx
    .select()
    .from(pages)
    .where(and(eq(pages.id, input.pageId), isNull(pages.trashedAt)))
    .limit(1);
  const [page] = lock ? await query.for("update") : await query;
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
  return { page, blocks, rows, identity: sourceIdentity(rows) };
}

function sourceIdentity(rows: { key: string; value: string }[]): string {
  return createHash("sha256").update(JSON.stringify(rows)).digest("hex");
}

const draftSourceService = defineService({
  name: "cms.draftPageTranslationSource",
  summary: "Authorize and snapshot a page's strings before a translation model runs.",
  kind: "query",
  permission: "scoped",
  external: false,
  input: draftInput,
  output: row({
    pageId: uuid,
    rows: z.array(z.object({ key: z.string(), value: z.string() })),
    identity: z.string(),
  }),
  handler: async (input, ctx) => {
    const source = await draftablePage(ctx, input, false);
    return { pageId: source.page.id, rows: source.rows, identity: source.identity };
  },
});

const applyDraftService = defineService({
  name: "cms.applyPageTranslationDraft",
  summary: "Revalidate a page and store a translation draft produced outside the transaction.",
  kind: "mutation",
  permission: "scoped",
  external: false,
  input: draftInput.extend({
    identity: z.string(),
    values: z.record(z.string(), z.string()),
    machine: z.boolean(),
  }),
  output: translationRow,
  handler: async (input, ctx) => {
    // The model ran with no transaction open. Re-lock the page and compare
    // its strings, so an edit made meanwhile is never overwritten by a draft
    // of the text it replaced.
    const source = await draftablePage(ctx, input, true);
    if (source.identity !== input.identity) {
      throw new ServiceError(
        "conflict",
        "The page changed while its translation was drafted. Nothing was saved; draft it again from the current text.",
      );
    }
    const blockValues: Record<string, string> = {};
    for (const [key, value] of Object.entries(input.values)) {
      if (key !== "title" && key !== "seo.description" && key !== "seo.title") {
        blockValues[key] = value;
      }
    }
    return ctx.call(setTranslation, {
      entityType: "page",
      entityId: source.page.id,
      locale: input.locale,
      status: input.machine ? "machine" : "draft",
      fields: {
        title: input.values.title,
        seo: {
          title: input.values["seo.title"],
          description: input.values["seo.description"],
        },
        blocks: applyTranslations(source.blocks, blockValues),
      },
    });
  },
});

/**
 * Seed a translation draft (C2.16). An orchestrator, because a translation
 * model can take many seconds and no service transaction may wait on it
 * (MASTER.md §11): snapshot, draft with nothing open, then re-lock and apply.
 */
export const draftPageTranslation = defineOrchestratedService({
  name: "cms.draftPageTranslation",
  summary:
    "Seed a translation draft — machine-translated only when an AI adapter actually ran. Never served publicly until reviewed.",
  kind: "mutation",
  permission: "scoped",
  input: draftInput,
  output: translationRow,
  handler: async (input, actor) => {
    const source = await draftSourceService.call(input, actor);
    const drafted = await draftValues(source.rows, input.locale, source.pageId);
    return applyDraftService.call(
      { ...input, identity: source.identity, values: drafted.values, machine: drafted.machine },
      actor,
    );
  },
});

export const pageTranslationReport = defineService({
  name: "cms.pageTranslationReport",
  summary: "Status and SEO completeness for each page in one locale.",
  kind: "query",
  permission: "scoped",
  input: z.object({ locale: z.string().min(2).max(20) }),
  output: listed(translationReport),
  handler: async (input, ctx) => {
    const pageRows = await ctx.tx
      .select({
        id: pages.id,
        title: pages.title,
        slug: pages.slug,
        seo: pages.seo,
      })
      .from(pages)
      .where(isNull(pages.trashedAt));
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

/** The short phases behind `cms.draftPageTranslation`, registered with it. */
export const draftPageTranslationPhases = [draftSourceService, applyDraftService];
