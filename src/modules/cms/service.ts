// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// CMS services (MASTER.md §11, §32).
//
// The module's only entry points. The public route, the admin, the REST API
// and MCP all arrive here, which is what makes "structure is a database write"
// safe: an agent rearranging a page goes through the same validation,
// permission check, audit row and revision history a human does.
import { z } from "zod";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { actorString, defineService, ServiceError } from "@/core/service";
import { isUniqueViolation } from "@/core/db";
import { businessProfile } from "@/core/settings/schema";
import { getTranslation, translatedIds } from "@/core/i18n/service";
import { recordRedirect } from "@/core/seo/service";
import { queueIndexNow } from "@/core/seo/indexnow";
import { kindFromSlug, priorityFromSlug } from "@/core/seo/classify";
import { contentRevisions, pages, sections } from "./schema";
import {
  applyDueSchedules,
  compareRevisions,
  createPreviewLink,
  decideApproval,
  describeConflict,
  listPreviewLinks,
  nameRevision,
  releaseEditLease,
  reloadWorkingDraft,
  requestApproval,
  resolvePreviewLink,
  revokePreviewLink,
  schedulePage,
  snapshotRevision,
  touchEditLease,
} from "./lifecycle";
import {
  addComment,
  decideReview,
  expireStalePresence,
  heartbeatPresence,
  leavePresence,
  listComments,
  listPresence,
  reopenThread,
  requestReview,
  resolveThread,
} from "./collaboration";
import {
  submitQuoteRequest,
  submitSiteChat,
  submitTipIntent,
} from "./inbound";
export {
  createSection,
  deleteSection,
  detachSection,
  listSectionUsages,
  saveAsSection,
} from "./section-service";
import {
  createSection,
  deleteSection,
  detachSection,
  listSectionUsages,
  saveAsSection,
} from "./section-service";
export {
  createFromTemplate,
  ensureTemplates,
  getTemplate,
  listTemplates,
  previewTemplate,
  resetTemplate,
  updateTemplate,
} from "./template-service";
import {
  createFromTemplate,
  ensureTemplates,
  getTemplate,
  listTemplates,
  previewTemplate,
  resetTemplate,
  updateTemplate,
} from "./template-service";
export {
  attachLayout,
  detachLayout,
  getLayout,
  rejoinLayout,
} from "./layout-service";
import {
  attachLayout,
  detachLayout,
  getLayout,
  rejoinLayout,
} from "./layout-service";
export { draftPageTranslation, pageTranslationReport } from "./translation-workflow";
import { draftPageTranslation, pageTranslationReport } from "./translation-workflow";
export { previewEmail, testSendEmail } from "./email-service";
import { previewEmail, testSendEmail } from "./email-service";
import { analyzeAccessibility, publishA11yMessage } from "./a11y-hints";
import { BlockValidationError, blockTreeSchema, parseBlockTree } from "./blocks/registry";
import type { BlockNode } from "./blocks/types";
import {
  defaultAnnouncement,
  defaultFooter,
  defaultHeader,
  defaultHome,
  defaultNav,
  ANNOUNCEMENT_KEY,
  FOOTER_KEY,
  HEADER_KEY,
  NAV_KEY,
} from "./defaults";
import { extractNavBlocks, navHasLinks } from "./chrome-nav";
import {
  demoHandlerInputSchema,
  demoLoadResultSchema,
  demoPurgeResultSchema,
  demoVerifyResultSchema,
} from "@/core/onboarding/contract";
import { requireDemoHandlerRun } from "@/core/demo/handler";

/** No leading or trailing slash; the home page is the empty string. */
const slug = z
  .string()
  .trim()
  .transform((value) => value.replace(/^\/+|\/+$/g, ""))
  .refine((value) => !value.includes("//"), "a path cannot contain //")
  .refine(
    (value) => value === "" || /^[a-z0-9]+(?:[-/][a-z0-9]+)*$/.test(value),
    "use lowercase words separated by hyphens or slashes",
  );

/**
 * The read side takes any string.
 *
 * `slug` above is the *write* rule, and it is right to be strict there. Using
 * it for lookups was wrong: a visitor's URL is untrusted input, so a request
 * for `/favicon.ico` or `/wp-admin.php` failed validation and answered 500
 * where the honest answer is "no such page". Any string is a legitimate
 * question; the answer is simply null.
 */
const lookupSlug = z
  .string()
  .transform((value) => value.replace(/^\/+|\/+$/g, ""));

const seo = z
  .object({
    title: z.string().max(60).optional(),
    description: z.string().max(155).optional(),
    ogImage: z.string().url().optional(),
  })
  .default({});

/* ------------------------------------------------------------------ pages */

/**
 * The page behind a path, for the public surface.
 *
 * Public, and *only* published rows — a draft must not be readable by URL,
 * because "unlisted" is not a permission model. The admin preview path reads
 * through `cms.getPage`, which is staff-only and can see drafts.
 */
export const resolvePage = defineService({
  name: "cms.resolvePage",
  summary: "The published page at a path, or null.",
  kind: "query",
  permission: "public",
  input: z.object({ slug: lookupSlug, locale: z.string().default("en") }),
  handler: async (input, ctx) => {
    // Pages are stored in the site's own language and *translated*, not
    // duplicated (§4.9). So the lookup is by slug in the source language, and
    // the requested locale decides which words come back — which is what makes
    // /fr/services the same page as /services rather than a parallel one
    // somebody has to remember to keep in step.
    const [source] = await ctx.tx
      .select({
        page: pages,
        defaultLocale: businessProfile.defaultLocale,
      })
      .from(pages)
      .leftJoin(businessProfile, sql`true`)
      .where(and(eq(pages.slug, input.slug), eq(pages.status, "published")))
      .limit(1);

    const page = source?.page;
    if (!page) return null;

    const sourceLocale = source?.defaultLocale ?? page.locale;
    if (input.locale === sourceLocale) return page;

    const translation = await ctx.callAsSystem(getTranslation, {
      entityType: "page",
      entityId: page.id,
      locale: input.locale,
    });
    if (!translation) {
      // No reviewed translation: the page is served in the site's own
      // language rather than not at all. A visitor who followed a French link
      // to an untranslated page should read the English one, not a 404 — and
      // hreflang only ever advertises the locales that do have one.
      return page;
    }

    const fields = translation.fields as {
      title?: string;
      blocks?: unknown;
      seo?: unknown;
    };
    return {
      ...page,
      title: fields.title ?? page.title,
      blocks: fields.blocks ?? page.blocks,
      seo: fields.seo ?? page.seo,
    };
  },
});

export const getPage = defineService({
  name: "cms.getPage",
  summary: "One page by id, including drafts.",
  kind: "query",
  permission: "scoped",
  input: z.object({ id: z.string().uuid() }),
  handler: async (input, ctx) => {
    const [page] = await ctx.tx
      .select()
      .from(pages)
      .where(eq(pages.id, input.id))
      .limit(1);
    if (!page) throw new ServiceError("not_found", `no page with id ${input.id}`);
    return page;
  },
});

export const listPages = defineService({
  name: "cms.listPages",
  summary: "Every page, newest first.",
  kind: "query",
  permission: "scoped",
  input: z.object({}),
  handler: (_input, ctx) =>
    ctx.tx.select().from(pages).orderBy(desc(pages.updatedAt)),
});

/**
 * Published pages as paths — the sitemap source this module contributes (§5).
 *
 * Public because a sitemap is public. It returns only what is already readable
 * at a URL, so it cannot leak a draft.
 */
export const publishedPaths = defineService({
  name: "cms.publishedPaths",
  summary: "Every published page's path, for sitemaps and navigation.",
  kind: "query",
  permission: "public",
  input: z.object({ locale: z.string().default("en") }),
  handler: async (input, ctx) => {
    const published = await ctx.tx
      .select({
        id: pages.id,
        slug: pages.slug,
        title: pages.title,
        seo: pages.seo,
        updatedAt: pages.updatedAt,
      })
      .from(pages)
      .where(eq(pages.status, "published"))
      .orderBy(pages.slug);

    const [business] = await ctx.tx
      .select({ defaultLocale: businessProfile.defaultLocale })
      .from(businessProfile)
      .limit(1);

    const toEntry = (
      slug: string,
      page: (typeof published)[number],
    ) => {
      const fields = (page.seo ?? {}) as {
        title?: string;
        description?: string;
        ogImage?: string;
      };
      return {
        slug,
        title: fields.title ?? page.title,
        description: fields.description,
        imageUrl: fields.ogImage ?? null,
        kind: kindFromSlug(page.slug),
        priority: priorityFromSlug(page.slug),
        updatedAt: page.updatedAt,
      };
    };

    if (!business || input.locale === business.defaultLocale) {
      return published.map((page) => toEntry(page.slug, page));
    }

    // A locale's sitemap lists what that locale actually has (§5). A page with
    // no reviewed translation is served in the site's own language, and
    // listing it under /fr/ would advertise a French page that is in English.
    const translated = new Set(
      await ctx.callAsSystem(translatedIds, {
        entityType: "page",
        locale: input.locale,
        ids: published.map((page) => page.id),
      }),
    );

    return published
      .filter((page) => translated.has(page.id))
      .map((page) =>
        toEntry(
          // The prefix belongs in the sitemap because it is the address a
          // crawler should fetch.
          page.slug === "" ? input.locale : `${input.locale}/${page.slug}`,
          page,
        ),
      );
  },
});

const duplicateSlug = (slugValue: string) =>
  new ServiceError(
    "conflict",
    slugValue === ""
      ? "There is already a home page for this language."
      : `Another page already lives at /${slugValue}.`,
  );

export const createPage = defineService({
  name: "cms.createPage",
  summary: "Add a page.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({
    slug,
    locale: z.string().default("en"),
    title: z.string().min(1),
    blocks: blockTreeSchema("page").default([]),
    seo,
  }),
  handler: async (input, ctx) => {
    const [page] = await ctx.tx
      .insert(pages)
      .values(input)
      .returning()
      .catch((error: unknown) => {
        if (isUniqueViolation(error, "pages_slug_locale_idx")) {
          throw duplicateSlug(input.slug);
        }
        throw error;
      });
    ctx.setSubject("page", page!.id);
    ctx.queueEvent("cms.pageCreated", { pageId: page!.id, slug: page!.slug });
    return page!;
  },
});

/**
 * Remove one draft page.
 *
 * Kept deliberately narrower than a generic delete: published content must be
 * taken offline in a separate, auditable action first. The builder uses this
 * only to make rolling back a proposal-created page restore the true prior
 * state (non-existence), not leave an invisible draft behind.
 */
export const deleteDraftPage = defineService({
  name: "cms.deleteDraftPage",
  summary: "Permanently remove one draft page.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({ id: z.string().uuid() }),
  handler: async (input, ctx) => {
    const [page] = await ctx.tx
      .select()
      .from(pages)
      .where(eq(pages.id, input.id))
      .limit(1);
    if (!page) throw new ServiceError("not_found", `no page with id ${input.id}`);
    if (page.status !== "draft") {
      throw new ServiceError(
        "conflict",
        "A published page must be taken offline before it can be removed.",
      );
    }
    await ctx.tx.delete(contentRevisions).where(
      and(
        eq(contentRevisions.subjectType, "page"),
        eq(contentRevisions.subjectId, page.id),
      ),
    );
    await ctx.tx.delete(pages).where(eq(pages.id, page.id));
    ctx.setSubject("page", page.id);
    ctx.queueEvent("cms.pageDeleted", { pageId: page.id, slug: page.slug });
    return { id: page.id, slug: page.slug };
  },
});

const DEMO_PAGE = {
  en: {
    title: "[Demo] A clear first project",
    body: "This isolated example page is safe to edit, reload, reset or purge from Demo scenarios.",
  },
  fr: {
    title: "[Demo] Un premier projet clair",
    body: "Cette page exemple isolee peut etre modifiee, rechargee, reinitialisee ou purgee.",
  },
  es: {
    title: "[Demo] Un primer proyecto claro",
    body: "Esta pagina de ejemplo aislada se puede editar, recargar, reiniciar o purgar.",
  },
} as const;

export const loadDemoCms = defineService({
  name: "cms.loadDemoFixture",
  summary: "Load the CMS contribution for a tracked demo run.",
  kind: "mutation",
  permission: "scoped",
  input: demoHandlerInputSchema,
  handler: async (input, ctx) => {
    await requireDemoHandlerRun(
      ctx.tx,
      input,
      { key: "cms.current-modules", version: 1 },
      "load",
    );
    const copy = DEMO_PAGE[input.locale as keyof typeof DEMO_PAGE];
    if (!copy) throw new ServiceError("validation", "Unsupported demo locale.");
    const page = await ctx.callAsSystem(createPage, {
      slug: "freeholder-demo-project",
      locale: input.locale,
      title: copy.title,
      blocks: [
        {
          id: "demo-project-heading",
          type: "heading",
          props: { text: copy.title, level: 1, align: "start" },
        },
        {
          id: "demo-project-intro",
          type: "text",
          props: { body: copy.body, align: "start", measure: true },
        },
      ],
      seo: {},
    });
    return demoLoadResultSchema.parse({
      records: [
        {
          fixtureKey: "project-page",
          subjectType: "page",
          subjectId: page.id,
          label: page.title,
        },
      ],
    });
  },
});

export const purgeDemoCms = defineService({
  name: "cms.purgeDemoFixture",
  summary: "Purge only pages proven to belong to a tracked demo run.",
  kind: "mutation",
  permission: "scoped",
  input: demoHandlerInputSchema,
  handler: async (input, ctx) => {
    await requireDemoHandlerRun(
      ctx.tx,
      input,
      { key: "cms.current-modules", version: 1 },
      "purge",
    );
    const purged: Array<{ subjectType: string; subjectId: string }> = [];
    for (const record of input.records) {
      if (record.fixtureKey !== "project-page" || record.subjectType !== "page") {
        throw new ServiceError("validation", "Unexpected CMS demo provenance.");
      }
      const [page] = await ctx.tx
        .select({ id: pages.id, status: pages.status })
        .from(pages)
        .where(eq(pages.id, record.subjectId))
        .limit(1);
      if (page?.status === "published") {
        await ctx.callAsSystem(publishPage, { id: page.id, published: false });
      }
      if (page) await ctx.callAsSystem(deleteDraftPage, { id: page.id });
      purged.push({ subjectType: record.subjectType, subjectId: record.subjectId });
    }
    return demoPurgeResultSchema.parse({ purged });
  },
});

export const verifyDemoCms = defineService({
  name: "cms.verifyDemoFixture",
  summary: "Verify the visible CMS outcome for a tracked demo run.",
  kind: "query",
  permission: "scoped",
  input: demoHandlerInputSchema,
  handler: async (input, ctx) => {
    await requireDemoHandlerRun(
      ctx.tx,
      input,
      { key: "cms.current-modules", version: 1 },
      "verify",
    );
    const ids = input.records
      .filter((record) => record.subjectType === "page")
      .map((record) => record.subjectId);
    const [page] = ids.length
      ? await ctx.tx
          .select({ id: pages.id, slug: pages.slug, title: pages.title })
          .from(pages)
          .where(eq(pages.id, ids[0]!))
          .limit(1)
      : [];
    return demoVerifyResultSchema.parse({
      outcomes: [
        {
          key: "cms.current-modules.visible",
          achieved:
            page?.slug === "freeholder-demo-project" &&
            page.title.startsWith("[Demo]"),
          detail: page?.title,
        },
      ],
    });
  },
});

/**
 * Save a page, keeping the previous version.
 *
 * The revision is written *before* the update, inside the same transaction, so
 * "restore" always has somewhere to go back to and a failed save cannot leave a
 * revision describing a state that never existed (§2 principle 12).
 */
export const updatePage = defineService({
  name: "cms.updatePage",
  summary: "Change a page's content or settings.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({
    id: z.string().uuid(),
    expectedVersion: z.number().int().positive().optional(),
    slug: slug.optional(),
    title: z.string().min(1).optional(),
    blocks: blockTreeSchema("page").optional(),
    seo: seo.optional(),
  }),
  handler: async (input, ctx) => {
    const { id, expectedVersion, ...changes } = input;
    if (Object.keys(changes).length === 0) {
      throw new ServiceError("validation", "cms.updatePage: nothing to change");
    }

    const [before] = await ctx.tx
      .select()
      .from(pages)
      .where(eq(pages.id, id))
      .limit(1);
    if (!before) throw new ServiceError("not_found", `no page with id ${id}`);
    if (expectedVersion !== undefined && before.version !== expectedVersion) {
      throw new ServiceError(
        "conflict",
        "This page changed after you opened it. Reload before saving again.",
      );
    }

    await ctx.tx.insert(contentRevisions).values({
      subjectType: "page",
      subjectId: before.id,
      title: before.workingTitle ?? before.title,
      blocks: before.workingBlocks ?? before.blocks,
      seo: before.workingSeo ?? before.seo,
      kind: "autosave",
      actor: actorString(ctx.actor),
    });

    const nextWorkingTitle = changes.title ?? before.workingTitle ?? before.title;
    const nextWorkingBlocks = changes.blocks ?? before.workingBlocks ?? before.blocks;
    const nextWorkingSeo = changes.seo ?? before.workingSeo ?? before.seo;
    const publishedContentEdit =
      before.status === "published" &&
      (changes.title !== undefined || changes.blocks !== undefined || changes.seo !== undefined);

    const [page] = await ctx.tx
      .update(pages)
      .set({
        ...(changes.slug !== undefined ? { slug: changes.slug } : {}),
        ...(publishedContentEdit
          ? {}
          : {
              ...(changes.title !== undefined ? { title: changes.title } : {}),
              ...(changes.blocks !== undefined ? { blocks: changes.blocks } : {}),
              ...(changes.seo !== undefined ? { seo: changes.seo } : {}),
            }),
        workingTitle: nextWorkingTitle,
        workingBlocks: nextWorkingBlocks,
        workingSeo: nextWorkingSeo,
        version: before.version + 1,
      })
      .where(eq(pages.id, id))
      .returning()
      .catch((error: unknown) => {
        if (changes.slug !== undefined && isUniqueViolation(error, "pages_slug_locale_idx")) {
          throw duplicateSlug(changes.slug);
        }
        throw error;
      });

    // §5: "automatic redirect creation on slug change — slugs never silently
    // break". Renaming a page is a normal editorial act; every link anyone
    // ever shared to the old address breaking is not, and the platform is the
    // only party that can see the rename happen.
    //
    // Elevated because an owner renaming a page has not asked for a redirect
    // and should not have to; it rides the same transaction, so a page that
    // moved and a redirect that records it commit together or not at all.
    if (changes.slug !== undefined && changes.slug !== before.slug) {
      await ctx.callAsSystem(recordRedirect, {
        fromPath: before.slug,
        toPath: page!.slug,
        locale: before.locale,
        source: "slug-change",
      });
      if (page!.status === "published") {
        await queueIndexNow(
          ctx,
          [before.slug, page!.slug],
          `indexnow:${page!.id}:rename:${before.slug}:${page!.slug}`,
        );
      }
    }

    if (changes.blocks !== undefined) {
      await ctx.call(detachLayout, { pageId: page!.id }).catch((error: unknown) => {
        if (error instanceof ServiceError && error.code === "not_found") return;
        throw error;
      });
    }

    ctx.setSubject("page", page!.id);
    ctx.queueEvent("cms.pageUpdated", { pageId: page!.id, slug: page!.slug });
    return page!;
  },
});

/**
 * Apply a reviewed merge of a stale edit (C2.03).
 *
 * The editor has already seen `cms.describeConflict`. This write is the same
 * working-copy update as `cms.updatePage`, but only after the caller names the
 * current server version — "keep mine" is explicit, not a silent overwrite.
 */
export const mergePage = defineService({
  name: "cms.mergePage",
  summary: "Write a reviewed merge onto the working draft at the current version.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({
    id: z.string().uuid(),
    expectedVersion: z.number().int().positive(),
    title: z.string().min(1).optional(),
    blocks: blockTreeSchema("page").optional(),
    seo: seo.optional(),
  }),
  handler: async (input, ctx) => ctx.call(updatePage, input),
});

export const pageAccessibilityReport = defineService({
  name: "cms.pageAccessibilityReport",
  summary: "Heading, alt, link and landmark hints for one page.",
  kind: "query",
  permission: "scoped",
  input: z.object({ id: z.string().uuid() }),
  handler: async (input, ctx) => {
    const page = await ctx.call(getPage, { id: input.id });
    const blocks = page.workingBlocks ?? page.blocks;
    return {
      hints: analyzeAccessibility(Array.isArray(blocks) ? (blocks as BlockNode[]) : [], {
        context: "page",
      }),
    };
  },
});

export const publishPage = defineService({
  name: "cms.publishPage",
  summary: "Make a page live, or take it back to draft.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({ id: z.string().uuid(), published: z.boolean() }),
  handler: async (input, ctx) => {
    const [before] = await ctx.tx.select().from(pages).where(eq(pages.id, input.id)).limit(1);
    if (!before) throw new ServiceError("not_found", `no page with id ${input.id}`);
    if (input.published && before.approvalState === "pending") {
      throw new ServiceError(
        "conflict",
        "This page is waiting for approval. Approve it before publishing.",
      );
    }
    const title = before.workingTitle ?? before.title;
    const blocks = before.workingBlocks ?? before.blocks;
    const seo = before.workingSeo ?? before.seo;
    if (input.published) {
      const blocked = publishA11yMessage(
        analyzeAccessibility(Array.isArray(blocks) ? (blocks as BlockNode[]) : [], {
          context: "page",
        }),
      );
      if (blocked) throw new ServiceError("validation", blocked);
    }
    if (input.published) {
      await ctx.tx.insert(contentRevisions).values({
        subjectType: "page",
        subjectId: before.id,
        title,
        blocks,
        seo,
        kind: "publish",
        name: "Published",
        actor: actorString(ctx.actor),
      });
    }
    const [page] = await ctx.tx
      .update(pages)
      .set({
        status: input.published ? "published" : "draft",
        publishedAt: input.published ? sql`now()` : null,
        ...(input.published
          ? {
              title,
              blocks,
              seo,
              workingTitle: title,
              workingBlocks: blocks,
              workingSeo: seo,
              scheduledPublishAt: null,
              approvalState: "none",
              approvalNote: null,
              approvedBy: null,
              approvedAt: null,
            }
          : { scheduledUnpublishAt: null }),
        version: before.version + 1,
      })
      .where(eq(pages.id, input.id))
      .returning();
    if (!page) throw new ServiceError("not_found", `no page with id ${input.id}`);
    ctx.setSubject("page", page.id);
    ctx.queueEvent(input.published ? "cms.pagePublished" : "cms.pageUnpublished", {
      pageId: page.id,
      slug: page.slug,
    });
    await queueIndexNow(
      ctx,
      [page.slug],
      `indexnow:${page.id}:${input.published ? "published" : "unpublished"}`,
    );
    return page;
  },
});

/* --------------------------------------------------------------- sections */

/**
 * A chrome section by key, for the layout. Public: the header and footer are
 * on every page a visitor can already see.
 */
export const getSection = defineService({
  name: "cms.getSection",
  summary: "One section by key — the header, the footer, a saved arrangement.",
  kind: "query",
  permission: "public",
  input: z.object({
    key: z.string().min(1),
    locale: z.string().default("en"),
    fallback: z.boolean().default(true),
  }),
  handler: async (input, ctx) => {
    const [section] = await ctx.tx
      .select()
      .from(sections)
      .where(and(eq(sections.key, input.key), eq(sections.locale, input.locale)))
      .limit(1);
    if (section || !input.fallback) return section ?? null;

    // Missing translated chrome falls back as one coherent header/footer,
    // just as an untranslated page falls back to its source content. It must
    // not disappear around an otherwise usable translated page.
    const [business] = await ctx.tx
      .select({ defaultLocale: businessProfile.defaultLocale })
      .from(businessProfile)
      .limit(1);
    const [source] = business ? await ctx.tx
      .select()
      .from(sections)
      .where(
        and(
          eq(sections.key, input.key),
          eq(sections.locale, business.defaultLocale),
        ),
      )
      .limit(1) : [];
    if (source) return source;

    // A business may change its default after the original seed. Until the
    // owner creates that new variant, keep the last complete chrome row rather
    // than turning the whole shell blank.
    const [existing] = await ctx.tx
      .select()
      .from(sections)
      .where(eq(sections.key, input.key))
      .orderBy(asc(sections.locale))
      .limit(1);
    return existing ?? null;
  },
});

export const listSections = defineService({
  name: "cms.listSections",
  summary: "Every section, chrome first.",
  kind: "query",
  permission: "scoped",
  input: z.object({}),
  handler: (_input, ctx) =>
    ctx.tx.select().from(sections).orderBy(sections.kind, sections.name),
});

export const updateSection = defineService({
  name: "cms.updateSection",
  summary: "Change a section's content.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({
    key: z.string().min(1),
    locale: z.string().default("en"),
    name: z.string().min(1).optional(),
    blocks: z.unknown(),
  }),
  handler: async (input, ctx) => {
    const [before] = await ctx.tx
      .select()
      .from(sections)
      .where(and(eq(sections.key, input.key), eq(sections.locale, input.locale)))
      .limit(1);
    if (!before) {
      throw new ServiceError("not_found", `no section named "${input.key}"`);
    }
    const context = before.kind === "chrome" ? "chrome" : "page";
    let blocks: BlockNode[];
    try {
      blocks = parseBlockTree(input.blocks, context);
    } catch (error) {
      if (error instanceof BlockValidationError) {
        throw new ServiceError("validation", error.message);
      }
      throw error;
    }

    await ctx.tx.insert(contentRevisions).values({
      subjectType: "section",
      subjectId: before.id,
      title: before.name,
      blocks: before.blocks,
      actor: actorString(ctx.actor),
    });

    const [section] = await ctx.tx
      .update(sections)
      .set({ blocks, ...(input.name ? { name: input.name } : {}) })
      .where(eq(sections.id, before.id))
      .returning();

    ctx.setSubject("section", section!.id);
    ctx.queueEvent("cms.sectionUpdated", { key: section!.key });
    return section!;
  },
});

/**
 * Start one translated chrome row from the source section. The copy is data,
 * visible in the ordinary section editor and removable/editable by the owner;
 * there is no hidden hardcoded multilingual header in the layout.
 */
export const createSectionLocale = defineService({
  name: "cms.createSectionLocale",
  summary: "Create an editable locale variant of one site-chrome section.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({
    key: z.string().min(1),
    locale: z.string().min(2).max(35),
  }),
  handler: async (input, ctx) => {
    const [business] = await ctx.tx
      .select({
        defaultLocale: businessProfile.defaultLocale,
        enabledLocales: businessProfile.enabledLocales,
      })
      .from(businessProfile)
      .limit(1);
    if (!business?.enabledLocales.includes(input.locale)) {
      throw new ServiceError("validation", "Choose a locale this site publishes.");
    }
    const [existing] = await ctx.tx
      .select({ id: sections.id })
      .from(sections)
      .where(and(eq(sections.key, input.key), eq(sections.locale, input.locale)))
      .limit(1);
    if (existing) {
      throw new ServiceError("conflict", "That locale variant already exists.");
    }
    const [defaultSource] = await ctx.tx
      .select()
      .from(sections)
      .where(
        and(
          eq(sections.key, input.key),
          eq(sections.locale, business.defaultLocale),
        ),
      )
      .limit(1);
    const [anySource] = defaultSource ? [] : await ctx.tx
      .select()
      .from(sections)
      .where(eq(sections.key, input.key))
      .orderBy(asc(sections.locale))
      .limit(1);
    const source = defaultSource ?? anySource;
    if (!source) throw new ServiceError("not_found", `no section named "${input.key}"`);
    try {
      const [created] = await ctx.tx
        .insert(sections)
        .values({
          key: source.key,
          locale: input.locale,
          name: source.name,
          kind: source.kind,
          blocks: parseBlockTree(source.blocks, "chrome"),
        })
        .returning();
      ctx.setSubject("section", created!.id);
      ctx.queueEvent("cms.sectionLocalized", {
        key: source.key,
        locale: input.locale,
      });
      return created!;
    } catch (error) {
      if (isUniqueViolation(error, "sections_key_locale_idx")) {
        throw new ServiceError("conflict", "That locale variant already exists.");
      }
      throw error;
    }
  },
});

/* -------------------------------------------------------------- revisions */

export const listRevisions = defineService({
  name: "cms.listRevisions",
  summary: "Earlier versions of a page or section.",
  kind: "query",
  permission: "scoped",
  input: z.object({
    subjectType: z.enum(["page", "section"]),
    subjectId: z.string().uuid(),
    limit: z.number().int().min(1).max(50).default(20),
  }),
  handler: (input, ctx) =>
    ctx.tx
      .select()
      .from(contentRevisions)
      .where(
        and(
          eq(contentRevisions.subjectType, input.subjectType),
          eq(contentRevisions.subjectId, input.subjectId),
        ),
      )
      .orderBy(desc(contentRevisions.createdAt))
      .limit(input.limit),
});

/**
 * Put a page or section back to an earlier version.
 *
 * Restoring is itself a change, so it writes a revision of the *current* state
 * first — §37 requires every change to be "reversible within one action", and
 * an undo you cannot undo only half satisfies that.
 */
export const restoreRevision = defineService({
  name: "cms.restoreRevision",
  summary: "Put a page or section back to an earlier version.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({ revisionId: z.string().uuid() }),
  handler: async (input, ctx) => {
    const [revision] = await ctx.tx
      .select()
      .from(contentRevisions)
      .where(eq(contentRevisions.id, input.revisionId))
      .limit(1);
    if (!revision) {
      throw new ServiceError("not_found", "that version no longer exists");
    }

    const actor = actorString(ctx.actor);

    if (revision.subjectType === "page") {
      const [before] = await ctx.tx
        .select()
        .from(pages)
        .where(eq(pages.id, revision.subjectId))
        .limit(1);
      if (!before) throw new ServiceError("not_found", "that page is gone");

      await ctx.tx.insert(contentRevisions).values({
        subjectType: "page",
        subjectId: before.id,
        title: before.workingTitle ?? before.title,
        blocks: before.workingBlocks ?? before.blocks,
        seo: before.workingSeo ?? before.seo,
        kind: "autosave",
        actor,
      });
      const restoredTitle = revision.title ?? before.title;
      const restoredBlocks = parseBlockTree(revision.blocks, "page");
      const restoredSeo = revision.seo ?? before.seo;
      // Restore always writes the working copy. A published page's live row
      // stays put until someone publishes again (C2.01, C2.02 restore-as-draft).
      const published = before.status === "published";
      const [page] = await ctx.tx
        .update(pages)
        .set({
          workingTitle: restoredTitle,
          workingBlocks: restoredBlocks,
          workingSeo: restoredSeo,
          ...(published
            ? {}
            : { title: restoredTitle, blocks: restoredBlocks, seo: restoredSeo }),
          version: before.version + 1,
        })
        .where(eq(pages.id, before.id))
        .returning();
      ctx.setSubject("page", page!.id);
      return { subjectType: "page" as const, id: page!.id, version: page!.version };
    }

    const [before] = await ctx.tx
      .select()
      .from(sections)
      .where(eq(sections.id, revision.subjectId))
      .limit(1);
    if (!before) throw new ServiceError("not_found", "that section is gone");

    await ctx.tx.insert(contentRevisions).values({
      subjectType: "section",
      subjectId: before.id,
      title: before.name,
      blocks: before.blocks,
      actor,
    });
    const [section] = await ctx.tx
      .update(sections)
      .set({ blocks: parseBlockTree(revision.blocks, "chrome") })
      .where(eq(sections.id, before.id))
      .returning();
    ctx.setSubject("section", section!.id);
    return { subjectType: "section" as const, id: section!.id };
  },
});

/* ---------------------------------------------------------------- defaults */

/**
 * Give a fresh instance a site (§32: "day one still looks designed").
 *
 * Idempotent by construction — every insert is `onConflictDoNothing` against
 * the natural key — so it is safe to call on every setup completion, on a
 * re-run, and from an admin button that repairs a site somebody emptied.
 *
 * Owner-permission, because creating a site's chrome is not a routine staff
 * edit. The setup-completion listener is not a user and has nobody to act as,
 * so it calls as `system` — which `permits()` allows past every check. That is
 * the one elevation in this module, it is named `onSetupCompleted`, and it is
 * greppable, which is the whole reason elevation is spelled out rather than
 * implied (§11).
 */
export const ensureDefaults = defineService({
  name: "cms.ensureDefaults",
  summary: "Create the starting chrome sections and home page if absent.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({ locale: z.string().default("en") }),
  handler: async (input, ctx) => {
    const [business] = await ctx.tx
      .select({ name: businessProfile.name, tagline: businessProfile.tagline })
      .from(businessProfile)
      .limit(1);
    const name = business?.name ?? "Freeholder";

    const created: string[] = [];

    const chrome: Array<{ key: string; name: string; blocks: BlockNode[] }> = [
      { key: ANNOUNCEMENT_KEY, name: "Announcement", blocks: defaultAnnouncement() },
      { key: HEADER_KEY, name: "Header", blocks: defaultHeader() },
      { key: NAV_KEY, name: "Navigation", blocks: defaultNav() },
      { key: FOOTER_KEY, name: "Footer", blocks: defaultFooter(name) },
    ];
    for (const piece of chrome) {
      const inserted = await ctx.tx
        .insert(sections)
        .values({
          key: piece.key,
          locale: input.locale,
          name: piece.name,
          kind: "chrome",
          blocks: parseBlockTree(piece.blocks, "chrome"),
        })
        .onConflictDoNothing({ target: [sections.key, sections.locale] })
        .returning({ key: sections.key });
      if (inserted.length > 0) created.push(`section:${piece.key}`);
    }

    const [headerRow] = await ctx.tx
      .select()
      .from(sections)
      .where(and(eq(sections.key, HEADER_KEY), eq(sections.locale, input.locale)))
      .limit(1);
    const [navRow] = await ctx.tx
      .select()
      .from(sections)
      .where(and(eq(sections.key, NAV_KEY), eq(sections.locale, input.locale)))
      .limit(1);
    if (headerRow && navRow) {
      const pulled = extractNavBlocks(headerRow.blocks as BlockNode[]);
      if (pulled.nav.length > 0) {
        await ctx.tx
          .update(sections)
          .set({ blocks: parseBlockTree(pulled.rest, "chrome") })
          .where(eq(sections.id, headerRow.id));
        if (!navHasLinks(navRow.blocks as BlockNode[])) {
          await ctx.tx
            .update(sections)
            .set({ blocks: parseBlockTree(pulled.nav, "chrome") })
            .where(eq(sections.id, navRow.id));
        }
        created.push("section:nav-migrated");
      }
    }

    const home = defaultHome({ name, tagline: business?.tagline ?? null });
    const insertedHome = await ctx.tx
      .insert(pages)
      .values({
        slug: "",
        locale: input.locale,
        title: home.title,
        blocks: parseBlockTree(home.blocks, "page"),
        status: "published",
        publishedAt: sql`now()`,
      })
      .onConflictDoNothing({ target: [pages.slug, pages.locale] })
      .returning({ id: pages.id });
    if (insertedHome.length > 0) created.push("page:home");

    const templates = await ctx.call(ensureTemplates, { locale: input.locale });
    created.push(...templates.created);

    ctx.setSubject("module", "cms");
    return { created };
  },
});

/**
 * Seed the site the moment setup finishes.
 *
 * The first module event listener in the codebase, and the reason the bus
 * exists: core's settings module announces that a business now exists, and cms
 * responds without either module importing the other (§11 — "modules
 * communicate only via the event bus and core services").
 */
export {
  onLocationCreated,
  onLocationDeleted,
  onLocationUpdated,
} from "./locations";

export async function onSetupCompleted(): Promise<void> {
  await ensureDefaults.call({}, { kind: "system" });
}

export default [
  resolvePage,
  getPage,
  listPages,
  publishedPaths,
  createPage,
  deleteDraftPage,
  loadDemoCms,
  purgeDemoCms,
  verifyDemoCms,
  updatePage,
  pageAccessibilityReport,
  publishPage,
  getSection,
  listSections,
  updateSection,
  createSection,
  createSectionLocale,
  saveAsSection,
  detachSection,
  listSectionUsages,
  deleteSection,
  listTemplates,
  getTemplate,
  updateTemplate,
  resetTemplate,
  createFromTemplate,
  previewTemplate,
  ensureTemplates,
  getLayout,
  attachLayout,
  detachLayout,
  rejoinLayout,
  draftPageTranslation,
  pageTranslationReport,
  previewEmail,
  testSendEmail,
  listRevisions,
  restoreRevision,
  createPreviewLink,
  listPreviewLinks,
  revokePreviewLink,
  resolvePreviewLink,
  schedulePage,
  applyDueSchedules,
  requestApproval,
  decideApproval,
  snapshotRevision,
  nameRevision,
  compareRevisions,
  describeConflict,
  reloadWorkingDraft,
  mergePage,
  touchEditLease,
  releaseEditLease,
  heartbeatPresence,
  listPresence,
  leavePresence,
  expireStalePresence,
  addComment,
  listComments,
  resolveThread,
  reopenThread,
  requestReview,
  decideReview,
  submitQuoteRequest,
  submitSiteChat,
  submitTipIntent,
  ensureDefaults,
];
