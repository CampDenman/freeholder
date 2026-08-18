// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Page/post/product/service/email templates (C2.13).
import { z } from "zod";
import { and, asc, eq } from "drizzle-orm";
import { defineService, ServiceError } from "@/core/service";
import instanceConfig from "../../../freeholder.config";
import { blockTreeSchema, parseBlockTree } from "./blocks/registry";
import { cloneTree } from "./section-instances";
import {
  contentTemplates,
  TEMPLATE_PRESETS,
  type TemplatePreset,
} from "./schema";
import { seedTemplates, slugFromTitle } from "./templates";

const presetSchema = z.enum(TEMPLATE_PRESETS);
const kindSchema = z.enum(["page", "post", "product", "service", "email"] as const);

function instancePreset(): TemplatePreset {
  return instanceConfig.preset;
}

export const listTemplates = defineService({
  name: "cms.listTemplates",
  summary: "Templates for this instance's business preset.",
  kind: "query",
  permission: "scoped",
  input: z.object({
    kind: kindSchema.optional(),
    preset: presetSchema.optional(),
    locale: z.string().default("en"),
  }),
  handler: async (input, ctx) => {
    const preset = input.preset ?? instancePreset();
    const rows = await ctx.tx
      .select()
      .from(contentTemplates)
      .where(
        and(
          eq(contentTemplates.preset, preset),
          eq(contentTemplates.locale, input.locale),
          input.kind ? eq(contentTemplates.kind, input.kind) : undefined,
        ),
      )
      .orderBy(asc(contentTemplates.kind), asc(contentTemplates.name));
    if (rows.length > 0 || preset === "everything") return rows;
    return ctx.tx
      .select()
      .from(contentTemplates)
      .where(
        and(
          eq(contentTemplates.preset, "everything"),
          eq(contentTemplates.locale, input.locale),
          input.kind ? eq(contentTemplates.kind, input.kind) : undefined,
        ),
      )
      .orderBy(asc(contentTemplates.kind), asc(contentTemplates.name));
  },
});

export const getTemplate = defineService({
  name: "cms.getTemplate",
  summary: "One template by key for a preset and locale.",
  kind: "query",
  permission: "scoped",
  input: z.object({
    key: z.string().min(1).max(80),
    preset: presetSchema.optional(),
    locale: z.string().default("en"),
  }),
  handler: async (input, ctx) => {
    const preset = input.preset ?? instancePreset();
    const [row] = await ctx.tx
      .select()
      .from(contentTemplates)
      .where(
        and(
          eq(contentTemplates.key, input.key),
          eq(contentTemplates.preset, preset),
          eq(contentTemplates.locale, input.locale),
        ),
      )
      .limit(1);
    if (row) return row;
    if (preset === "everything") return null;
    const [fallback] = await ctx.tx
      .select()
      .from(contentTemplates)
      .where(
        and(
          eq(contentTemplates.key, input.key),
          eq(contentTemplates.preset, "everything"),
          eq(contentTemplates.locale, input.locale),
        ),
      )
      .limit(1);
    return fallback ?? null;
  },
});

export const updateTemplate = defineService({
  name: "cms.updateTemplate",
  summary: "Save an owner's edits to a template.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({
    key: z.string().min(1).max(80),
    preset: presetSchema.optional(),
    locale: z.string().default("en"),
    name: z.string().trim().min(1).max(80).optional(),
    blocks: blockTreeSchema("page"),
  }),
  handler: async (input, ctx) => {
    const preset = input.preset ?? instancePreset();
    const [existing] = await ctx.tx
      .select()
      .from(contentTemplates)
      .where(
        and(
          eq(contentTemplates.key, input.key),
          eq(contentTemplates.preset, preset),
          eq(contentTemplates.locale, input.locale),
        ),
      )
      .limit(1);
    if (!existing) {
      throw new ServiceError("not_found", "That template is not on this site.");
    }
    const [updated] = await ctx.tx
      .update(contentTemplates)
      .set({
        name: input.name ?? existing.name,
        blocks: parseBlockTree(input.blocks, "page"),
        origin: "owner",
      })
      .where(eq(contentTemplates.id, existing.id))
      .returning();
    ctx.setSubject("template", updated!.id);
    ctx.queueEvent("cms.templateUpdated", { key: updated!.key, preset });
    return updated!;
  },
});

export const resetTemplate = defineService({
  name: "cms.resetTemplate",
  summary: "Restore a template to the seeded default for this preset.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({
    key: z.string().min(1).max(80),
    preset: presetSchema.optional(),
    locale: z.string().default("en"),
  }),
  handler: async (input, ctx) => {
    const preset = input.preset ?? instancePreset();
    const seed = seedTemplates(preset).find((row) => row.key === input.key);
    if (!seed) {
      throw new ServiceError("not_found", "There is no default for that template.");
    }
    const [existing] = await ctx.tx
      .select()
      .from(contentTemplates)
      .where(
        and(
          eq(contentTemplates.key, input.key),
          eq(contentTemplates.preset, preset),
          eq(contentTemplates.locale, input.locale),
        ),
      )
      .limit(1);
    if (!existing) {
      throw new ServiceError("not_found", "That template is not on this site.");
    }
    const [updated] = await ctx.tx
      .update(contentTemplates)
      .set({
        name: seed.name,
        blocks: parseBlockTree(seed.blocks, "page"),
        origin: "system",
      })
      .where(eq(contentTemplates.id, existing.id))
      .returning();
    ctx.setSubject("template", updated!.id);
    ctx.queueEvent("cms.templateReset", { key: updated!.key, preset });
    return updated!;
  },
});

export const createFromTemplate = defineService({
  name: "cms.createFromTemplate",
  summary: "Create a draft page (or return email blocks) from a template.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({
    key: z.string().min(1).max(80),
    title: z.string().trim().min(1).max(240),
    slug: z.string().optional(),
    preset: presetSchema.optional(),
    locale: z.string().default("en"),
  }),
  handler: async (input, ctx) => {
    const template = await ctx.call(getTemplate, {
      key: input.key,
      preset: input.preset,
      locale: input.locale,
    });
    if (!template) {
      throw new ServiceError("not_found", "That template is not on this site.");
    }
    const stamp = Math.random().toString(36).slice(2, 7);
    const blocks = cloneTree(parseBlockTree(template.blocks, "page"), stamp);
    if (template.kind === "email") {
      return {
        kind: "email" as const,
        templateKey: template.key,
        blocks,
        page: null,
      };
    }
    const slug = input.slug?.trim() ? input.slug : slugFromTitle(input.title);
    const { createPage } = await import("./service");
    const page = await ctx.call(createPage, {
      title: input.title,
      slug,
      locale: input.locale,
      blocks,
    });
    return {
      kind: template.kind,
      templateKey: template.key,
      blocks,
      page,
    };
  },
});

export const previewTemplate = defineService({
  name: "cms.previewTemplate",
  summary: "The stored tree for the editor canvas.",
  kind: "query",
  permission: "scoped",
  input: z.object({
    key: z.string().min(1).max(80),
    preset: presetSchema.optional(),
    locale: z.string().default("en"),
  }),
  handler: async (input, ctx) => {
    const template = await ctx.call(getTemplate, input);
    if (!template) {
      throw new ServiceError("not_found", "That template is not on this site.");
    }
    return {
      ...template,
      blocks: parseBlockTree(template.blocks, "page"),
    };
  },
});

export const ensureTemplates = defineService({
  name: "cms.ensureTemplates",
  summary: "Seed missing system templates for every business preset.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({ locale: z.string().default("en") }),
  handler: async (input, ctx) => {
    const created: string[] = [];
    for (const preset of TEMPLATE_PRESETS) {
      for (const seed of seedTemplates(preset)) {
        const inserted = await ctx.tx
          .insert(contentTemplates)
          .values({
            key: seed.key,
            kind: seed.kind,
            preset,
            name: seed.name,
            locale: input.locale,
            blocks: parseBlockTree(seed.blocks, "page"),
            origin: "system",
          })
          .onConflictDoNothing({
            target: [
              contentTemplates.key,
              contentTemplates.preset,
              contentTemplates.locale,
            ],
          })
          .returning({ key: contentTemplates.key });
        if (inserted.length > 0) created.push(`${preset}:${seed.key}`);
      }
    }
    return { created };
  },
});
