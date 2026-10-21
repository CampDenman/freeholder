// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Install a published business preset through ordinary services (C3.15).
import { z } from "zod";
import { defineService, ServiceError } from "@/core/service";
import { listed } from "@/core/contract";
import {
  cmsPageSlug,
  designExtras,
  emailTemplateKey,
  entityTemplateKey,
  listPresets,
  preset,
  type PresetKey,
} from "@freeholder/templates";
import { updateDesign } from "@/core/design/service";
import { createProduct, listProducts } from "@/modules/catalog/service";
import {
  attachLayout,
  createFromTemplate,
  createPage,
  ensureTemplates,
  getTemplate,
  listPages,
  listTemplates,
  updatePage,
} from "@/modules/cms/service";
import { createForm } from "@/modules/forms/service";

const PRESET_KEYS = listPresets();
const presetKey = z.enum(PRESET_KEYS as [PresetKey, ...PresetKey[]]);

export const installPreset = defineService({
  name: "seed.installPreset",
  summary: "Install Bench tokens, pages, entities and emails for a business preset.",
  kind: "mutation",
  permission: "scoped",
  writeClass: "write",
  input: z.object({
    preset: presetKey,
    locale: z.string().default("en"),
  }),
  output: z.object({
    preset: presetKey,
    pages: listed(z.string()),
    entities: listed(z.string()),
    emails: listed(z.string()),
    tokensApplied: z.boolean(),
  }),
  handler: async (input, ctx) => {
    const pack = preset(input.preset);
    const extras = designExtras(pack.tokens);
    await ctx.call(updateDesign, {
      colors: {
        light: {
          paper: pack.tokens.paper,
          ink: pack.tokens.ink,
          accent: pack.tokens.accent,
        },
      },
      radius: extras.radius as "0.25rem" | "0.375rem" | "0.5rem" | "0.75rem",
      measure: extras.measure as "36rem" | "48rem" | "56rem",
    });

    await ctx.call(ensureTemplates, { locale: input.locale });

    for (const form of pack.forms) {
      try {
        await ctx.call(createForm, {
          slug: form.slug,
          name: form.name,
          submitLabel: form.submitLabel,
          successMessage: form.successMessage,
          fields: form.fields,
        });
      } catch (error) {
        if (!(error instanceof ServiceError) || error.code !== "conflict") throw error;
      }
    }

    const existingPages = new Map(
      (await ctx.call(listPages, {})).map((page) => [page.slug, page]),
    );
    const pages: string[] = [];
    for (const page of pack.pages) {
      const slug = cmsPageSlug(page.slug);
      const prior = existingPages.get(slug);
      if (prior) {
        await ctx.call(updatePage, {
          id: prior.id,
          title: page.title,
          blocks: page.blocks,
        });
        pages.push(slug);
        continue;
      }
      const created = await ctx.call(createPage, {
        slug,
        locale: input.locale,
        title: page.title,
        blocks: page.blocks,
      });
      pages.push(created.slug);
    }

    const existingProducts = new Map(
      (await ctx.call(listProducts, { limit: 500 })).map((product) => [product.slug, product]),
    );
    const pagesAfter = new Map(
      (await ctx.call(listPages, {})).map((page) => [page.slug, page]),
    );
    const entities: string[] = [];
    for (const entity of pack.entities) {
      let product = existingProducts.get(entity.slug);
      if (!product) {
        product = await ctx.call(createProduct, {
          name: entity.name,
          slug: entity.slug,
          kind: entity.kind,
          description: entity.description,
        });
      }
      const templateKey = entityTemplateKey(entity.template);
      const entityPageSlug = `${entity.slug}-page`;
      let entityPage = pagesAfter.get(entityPageSlug);
      if (!entityPage) {
        const fromTemplate = await ctx.call(createFromTemplate, {
          key: templateKey,
          title: entity.name,
          slug: entityPageSlug,
          locale: input.locale,
        });
        entityPage = fromTemplate.page ?? undefined;
      }
      if (entityPage) {
        await ctx.call(attachLayout, {
          pageId: entityPage.id,
          entityType: entity.type === "service" ? "service" : "product",
          entityId: product.id,
          templateKey,
          detached: false,
        });
      }
      entities.push(entity.slug);
    }

    const emails: string[] = [];
    for (const email of pack.emails) {
      const key = emailTemplateKey(email.key);
      const stored = await ctx.call(getTemplate, {
        key,
        preset: input.preset,
        locale: input.locale,
      });
      if (!stored) {
        throw new ServiceError(
          "not_found",
          `The ${pack.name} email template ${key} was not seeded.`,
        );
      }
      emails.push(key);
    }

    const listedEmails = await ctx.call(listTemplates, {
      kind: "email",
      preset: input.preset,
      locale: input.locale,
    });
    if (listedEmails.length === 0) {
      throw new ServiceError("not_found", "No email templates were installed for this preset.");
    }

    return {
      preset: input.preset,
      pages,
      entities,
      emails,
      tokensApplied: true,
    };
  },
});
