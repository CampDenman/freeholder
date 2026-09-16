// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Public portfolio indexes and curated collections (MASTER.md C8.02).
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { assets } from "@/core/media/schema";
import { listed, row, timestamp, uuid } from "@/core/contract";
import { isUniqueViolation } from "@/core/db";
import { defineService, getService, ServiceError, type Actor, type ServiceContext } from "@/core/service";
import { getBusiness } from "@/core/settings/service";
import { addNavLink, NAV_SECTION_KEYS } from "@/modules/cms/chrome-nav";
import { parseBlockTree } from "@/modules/cms/blocks/registry";
import type { BlockNode } from "@/modules/cms/blocks/types";
import { cloneTree } from "@/modules/cms/section-instances";
import { pages } from "@/modules/cms/schema";
import {
  createPage,
  getSection,
  publishPage,
  updatePage,
  updateSection,
} from "@/modules/cms/service";
import { ensureTemplates, getTemplate } from "@/modules/cms/template-service";
import {
  PROJECT_COLLECTION_KINDS,
  PROJECT_COLLECTION_STATUSES,
  projectCollectionItems,
  projectCollections,
  projects,
} from "./schema";

const id = z.string().uuid();
const slug = z.string().trim().toLowerCase().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/).max(120);

function requirePerson(actor: Actor): void {
  if (actor.kind !== "user" && actor.kind !== "system") {
    throw new ServiceError("permission", "Sign in to manage portfolio collections.");
  }
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 100) || "collection";
}

const collectionRow = row({
  id: uuid,
  name: z.string(),
  slug: z.string(),
  kind: z.enum(PROJECT_COLLECTION_KINDS),
  description: z.string().nullable(),
  coverAssetId: uuid.nullable(),
  position: z.number().int(),
  publicationStatus: z.enum(PROJECT_COLLECTION_STATUSES),
  publishedAt: timestamp.nullable(),
  publicPageId: uuid.nullable(),
});

const itemRow = row({
  id: uuid,
  collectionId: uuid,
  projectId: uuid,
  position: z.number().int(),
});

const projectCard = row({
  id: uuid,
  title: z.string(),
  slug: z.string(),
  href: z.string(),
  summary: z.string().nullable(),
  coverAssetId: uuid.nullable(),
  occurredOn: z.string().nullable(),
  featured: z.boolean(),
  serviceProductIds: z.array(uuid),
});

const collectionCard = row({
  id: uuid,
  name: z.string(),
  slug: z.string(),
  href: z.string(),
  kind: z.enum(PROJECT_COLLECTION_KINDS),
  description: z.string().nullable(),
  coverAssetId: uuid.nullable(),
});

const serviceFacet = row({ id: uuid, name: z.string(), slug: z.string() });

const publicSnapshot = z.object({
  projectId: uuid,
  summary: z.string().nullable().default(null),
  occurredOn: z.string().date().nullable().default(null),
  coverAssetId: uuid.nullable().default(null),
  featured: z.boolean().default(false),
  services: z.array(z.object({ id: uuid, name: z.string(), slug: z.string() })).default([]),
  media: z.array(z.object({ assetId: uuid, role: z.string() })).default([]),
});

type PublicProduct = {
  id: string;
  name: string;
  slug: string;
  kind: string;
};

async function localeOf(ctx: ServiceContext): Promise<string> {
  const business = await ctx.callAsSystem(getBusiness, {});
  return business?.defaultLocale ?? "en";
}

async function templateTree(
  ctx: ServiceContext,
  key: "portfolio.index" | "portfolio.collection" | "project.case-study",
  locale: string,
): Promise<BlockNode[]> {
  await ctx.callAsSystem(ensureTemplates, { locale });
  const template = await ctx.callAsSystem(getTemplate, { key, locale });
  if (!template) throw new ServiceError("internal", `The ${key} CMS template is missing.`);
  return cloneTree(parseBlockTree(template.blocks, "page"), crypto.randomUUID().slice(0, 8));
}

/** Bind a reviewed project snapshot into the owner-editable case-study template. */
export async function projectTemplateSnapshot(
  ctx: ServiceContext,
  input: {
    locale: string;
    title: string;
    facts: Record<string, unknown>;
    authored: BlockNode[];
  },
): Promise<BlockNode[]> {
  let foundFacts = false;
  let foundHeading = false;
  const tree = (await templateTree(ctx, "project.case-study", input.locale)).map((block) => {
    if (block.type === "heading" && block.props.level === 1 && !foundHeading) {
      foundHeading = true;
      return { ...block, props: { ...block.props, text: input.title } };
    }
    if (block.type === "projectCaseStudy") {
      foundFacts = true;
      return { ...block, props: input.facts };
    }
    return block;
  });
  if (!foundHeading) {
    tree.unshift({ id: "project-title", type: "heading", props: { text: input.title, level: 1, align: "start" } });
  }
  if (!foundFacts) {
    tree.push({ id: "project-facts", type: "projectCaseStudy", props: input.facts });
  }
  const share = tree.findIndex((block) => block.type === "share");
  tree.splice(share < 0 ? tree.length : share, 0, ...input.authored);
  return tree;
}

async function pageAt(ctx: ServiceContext, path: string, locale: string) {
  const [page] = await ctx.tx
    .select()
    .from(pages)
    .where(and(eq(pages.slug, path), eq(pages.locale, locale)))
    .limit(1);
  return page ?? null;
}

async function linkFromNav(ctx: ServiceContext, locale: string): Promise<void> {
  for (const key of NAV_SECTION_KEYS) {
    const section = await ctx.callAsSystem(getSection, { key, locale });
    if (!section) continue;
    const blocks = structuredClone(section.blocks) as BlockNode[];
    if (addNavLink(blocks, "Portfolio", "/portfolio")) {
      await ctx.callAsSystem(updateSection, { key, locale, blocks });
    }
    return;
  }
}

/** RIBA root: publishing any work guarantees the section index exists. */
export async function ensurePortfolioIndex(ctx: ServiceContext): Promise<string> {
  const locale = await localeOf(ctx);
  const existing = await pageAt(ctx, "portfolio", locale);
  if (existing) {
    if (existing.status !== "published") {
      await ctx.callAsSystem(publishPage, { id: existing.id, published: true });
    }
    await linkFromNav(ctx, locale);
    return existing.id;
  }
  const blocks = await templateTree(ctx, "portfolio.index", locale);
  if (!blocks.some((block) => block.type === "portfolioIndex")) {
    blocks.push({ id: "portfolio-index", type: "portfolioIndex", props: {} });
  }
  const page = await ctx.callAsSystem(createPage, {
    slug: "portfolio",
    locale,
    title: "Portfolio",
    blocks,
    seo: { description: "Selected work, outcomes and case studies." },
  });
  await ctx.callAsSystem(publishPage, { id: page.id, published: true });
  await linkFromNav(ctx, locale);
  return page.id;
}

export const createCollection = defineService({
  name: "projects.createCollection",
  summary: "Create a curated portfolio collection.",
  kind: "mutation",
  permission: "scoped",
  writeClass: "write",
  input: z.object({
    name: z.string().trim().min(1).max(160),
    slug: slug.optional(),
    kind: z.enum(PROJECT_COLLECTION_KINDS),
    description: z.string().trim().max(2_000).nullish(),
    coverAssetId: id.nullish(),
    position: z.number().int().min(0).max(100_000).default(0),
  }),
  output: collectionRow,
  handler: async (input, ctx) => {
    requirePerson(ctx.actor);
    try {
      const [created] = await ctx.tx
        .insert(projectCollections)
        .values({
          name: input.name,
          slug: input.slug ?? slugify(input.name),
          kind: input.kind,
          description: input.description ?? null,
          coverAssetId: input.coverAssetId ?? null,
          position: input.position,
        })
        .returning();
      ctx.setSubject("project_collection", created!.id);
      return created!;
    } catch (error) {
      if (isUniqueViolation(error, "project_collections_slug_idx")) {
        throw new ServiceError("conflict", "Another collection already uses that web address.");
      }
      throw error;
    }
  },
});

export const updateCollection = defineService({
  name: "projects.updateCollection",
  summary: "Change a collection without silently changing its public address.",
  kind: "mutation",
  permission: "scoped",
  writeClass: "write",
  input: z.object({
    id,
    name: z.string().trim().min(1).max(160),
    kind: z.enum(PROJECT_COLLECTION_KINDS),
    description: z.string().trim().max(2_000).nullish(),
    coverAssetId: id.nullish(),
    position: z.number().int().min(0).max(100_000),
  }),
  output: collectionRow,
  handler: async (input, ctx) => {
    requirePerson(ctx.actor);
    const [updated] = await ctx.tx
      .update(projectCollections)
      .set({
        name: input.name,
        kind: input.kind,
        description: input.description ?? null,
        coverAssetId: input.coverAssetId ?? null,
        position: input.position,
        updatedAt: sql`now()`,
      })
      .where(eq(projectCollections.id, input.id))
      .returning();
    if (!updated) throw new ServiceError("not_found", "That collection is not here.");
    ctx.setSubject("project_collection", updated.id);
    return updated;
  },
});

export const addProjectToCollection = defineService({
  name: "projects.addToCollection",
  summary: "Put one project in a curated collection.",
  kind: "mutation",
  permission: "scoped",
  writeClass: "write",
  input: z.object({ collectionId: id, projectId: id, position: z.number().int().min(0).max(100_000).default(0) }),
  output: itemRow,
  handler: async (input, ctx) => {
    requirePerson(ctx.actor);
    const [created] = await ctx.tx
      .insert(projectCollectionItems)
      .values(input)
      .onConflictDoUpdate({
        target: [projectCollectionItems.collectionId, projectCollectionItems.projectId],
        set: { position: input.position, updatedAt: sql`now()` },
      })
      .returning();
    ctx.setSubject("project_collection", input.collectionId);
    return created!;
  },
});

export const removeProjectFromCollection = defineService({
  name: "projects.removeFromCollection",
  summary: "Remove one project from a collection without changing the project.",
  kind: "mutation",
  permission: "scoped",
  writeClass: "destructive",
  input: z.object({ id }),
  output: row({ id: uuid, collectionId: uuid }),
  handler: async (input, ctx) => {
    requirePerson(ctx.actor);
    const [removed] = await ctx.tx
      .delete(projectCollectionItems)
      .where(eq(projectCollectionItems.id, input.id))
      .returning({ id: projectCollectionItems.id, collectionId: projectCollectionItems.collectionId });
    if (!removed) throw new ServiceError("not_found", "That collection item is not here.");
    ctx.setSubject("project_collection", removed.collectionId);
    return removed;
  },
});

export const listCollections = defineService({
  name: "projects.listCollections",
  summary: "Portfolio collections and their project counts.",
  kind: "query",
  permission: "scoped",
  input: z.object({}),
  output: listed(collectionRow.extend({ projectCount: z.number().int() })),
  handler: (_input, ctx) =>
    ctx.tx
      .select({
        collection: projectCollections,
        projectCount: sql<number>`count(${projectCollectionItems.id})::int`,
      })
      .from(projectCollections)
      .leftJoin(projectCollectionItems, eq(projectCollectionItems.collectionId, projectCollections.id))
      .groupBy(projectCollections.id)
      .orderBy(asc(projectCollections.position), asc(projectCollections.name))
      .then((rows) => rows.map(({ collection, projectCount }) => ({ ...collection, projectCount }))),
});

export const getCollection = defineService({
  name: "projects.getCollection",
  summary: "One collection and its ordered projects.",
  kind: "query",
  permission: "scoped",
  input: z.object({ id }),
  output: collectionRow.extend({
    projects: listed(itemRow.extend({ title: z.string(), publicationStatus: z.enum(["draft", "published"]) })),
  }).nullable(),
  handler: async (input, ctx) => {
    const [collection] = await ctx.tx
      .select()
      .from(projectCollections)
      .where(eq(projectCollections.id, input.id))
      .limit(1);
    if (!collection) return null;
    const items = await ctx.tx
      .select({
        id: projectCollectionItems.id,
        collectionId: projectCollectionItems.collectionId,
        projectId: projectCollectionItems.projectId,
        position: projectCollectionItems.position,
        title: projects.title,
        publicationStatus: projects.publicationStatus,
      })
      .from(projectCollectionItems)
      .innerJoin(projects, eq(projects.id, projectCollectionItems.projectId))
      .where(eq(projectCollectionItems.collectionId, input.id))
      .orderBy(asc(projectCollectionItems.position), asc(projects.title));
    return { ...collection, projects: items };
  },
});

async function visibleProducts(ctx: ServiceContext): Promise<PublicProduct[]> {
  return (await ctx.call(getService("catalog.listVisibleProducts"), { limit: 500 })) as PublicProduct[];
}

function snapshotOf(blocks: unknown): z.infer<typeof publicSnapshot> | null {
  if (!Array.isArray(blocks)) return null;
  const block = blocks.find(
    (candidate) =>
      typeof candidate === "object" &&
      candidate !== null &&
      (candidate as { type?: unknown }).type === "projectCaseStudy",
  ) as { props?: unknown } | undefined;
  const parsed = publicSnapshot.safeParse(block?.props);
  return parsed.success ? parsed.data : null;
}

async function liveProjectCards(ctx: ServiceContext): Promise<Array<z.infer<typeof projectCard>>> {
  const rows = await ctx.tx
    .select({
      id: projects.id,
      slug: projects.slug,
      title: pages.title,
      pageSlug: pages.slug,
      blocks: pages.blocks,
    })
    .from(projects)
    .innerJoin(pages, eq(pages.id, projects.publicPageId))
    .where(and(eq(projects.publicationStatus, "published"), eq(pages.status, "published")))
    .orderBy(asc(pages.title));
  return rows
    .map((row) => {
      const snapshot = snapshotOf(row.blocks);
      if (!snapshot || snapshot.projectId !== row.id) return null;
      return {
        id: row.id,
        title: row.title,
        slug: row.slug,
        href: `/${row.pageSlug}`,
        summary: snapshot.summary,
        coverAssetId: snapshot.coverAssetId,
        occurredOn: snapshot.occurredOn,
        featured: snapshot.featured,
        serviceProductIds: snapshot.services.map((service) => service.id),
      };
    })
    .filter((project): project is z.infer<typeof projectCard> => project !== null)
    .sort((a, b) =>
      Number(b.featured) - Number(a.featured) ||
      (b.occurredOn ?? "").localeCompare(a.occurredOn ?? "") ||
      a.title.localeCompare(b.title),
    );
}

export const portfolioBrowse = defineService({
  name: "projects.portfolioBrowse",
  summary: "Public projects, collections and service facets from one relation model.",
  kind: "query",
  permission: "public",
  input: z.object({
    service: slug.optional(),
    collection: slug.optional(),
    q: z.string().trim().max(100).optional(),
    limit: z.number().int().min(1).max(200).default(100),
  }),
  output: z.object({
    projects: listed(projectCard),
    collections: listed(collectionCard),
    services: listed(serviceFacet),
    active: z.object({ service: z.string().nullable(), collection: z.string().nullable(), q: z.string().nullable() }),
  }),
  handler: async (input, ctx) => {
    const [allProjects, allProducts, collections] = await Promise.all([
      liveProjectCards(ctx),
      visibleProducts(ctx),
      ctx.tx
        .select({ collection: projectCollections })
        .from(projectCollections)
        .innerJoin(pages, eq(pages.id, projectCollections.publicPageId))
        .where(and(eq(projectCollections.publicationStatus, "published"), eq(pages.status, "published")))
        .orderBy(asc(projectCollections.position), asc(projectCollections.name)),
    ]);
    const publicServices = allProducts.filter((product) => product.kind === "service");
    const liveProjectIds = allProjects.map((project) => project.id);
    const liveMemberships = liveProjectIds.length
      ? await ctx.tx
          .select({ collectionId: projectCollectionItems.collectionId })
          .from(projectCollectionItems)
          .where(inArray(projectCollectionItems.projectId, liveProjectIds))
      : [];
    const collectionIdsWithLiveWork = new Set(liveMemberships.map((item) => item.collectionId));
    const publicCollections = collections.filter(({ collection }) =>
      collectionIdsWithLiveWork.has(collection.id),
    );
    const selectedService = input.service
      ? publicServices.find((service) => service.slug === input.service)
      : undefined;
    let allowedByCollection: Set<string> | undefined;
    if (input.collection) {
      const selected = publicCollections.find(({ collection }) => collection.slug === input.collection);
      if (!selected) allowedByCollection = new Set();
      else {
        const rows = await ctx.tx
          .select({ projectId: projectCollectionItems.projectId })
          .from(projectCollectionItems)
          .where(eq(projectCollectionItems.collectionId, selected.collection.id));
        allowedByCollection = new Set(rows.map((row) => row.projectId));
      }
    }
    const needle = input.q?.toLocaleLowerCase();
    const filtered = allProjects
      .filter((project) => !selectedService || project.serviceProductIds.includes(selectedService.id))
      .filter((project) => !allowedByCollection || allowedByCollection.has(project.id))
      .filter((project) => !needle || `${project.title} ${project.summary ?? ""}`.toLocaleLowerCase().includes(needle))
      .slice(0, input.limit);
    const usedServiceIds = new Set(allProjects.flatMap((project) => project.serviceProductIds));
    return {
      projects: filtered,
      collections: publicCollections.map(({ collection }) => ({
        id: collection.id,
        name: collection.name,
        slug: collection.slug,
        href: `/portfolio/collections-${collection.slug}`,
        kind: collection.kind,
        description: collection.description,
        coverAssetId: collection.coverAssetId,
      })),
      services: publicServices
        .filter((service) => usedServiceIds.has(service.id))
        .map(({ id, name, slug }) => ({ id, name, slug })),
      active: {
        service: input.service ?? null,
        collection: input.collection ?? null,
        q: input.q ?? null,
      },
    };
  },
});

async function collectionSnapshot(ctx: ServiceContext, collectionId: string) {
  const collection = await ctx.call(getCollection, { id: collectionId });
  if (!collection) throw new ServiceError("not_found", "That collection is not here.");
  const live = await liveProjectCards(ctx);
  const byId = new Map(live.map((project) => [project.id, project]));
  const cards = collection.projects
    .map((item) => byId.get(item.projectId))
    .filter((project): project is NonNullable<typeof project> => Boolean(project));
  if (!cards.length) {
    throw new ServiceError("validation", "Publish at least one project in this collection first.");
  }
  return { collection, cards };
}

export const publishCollection = defineService({
  name: "projects.publishCollection",
  summary: "Publish a curated collection through its CMS template.",
  kind: "mutation",
  permission: "scoped",
  writeClass: "write",
  input: z.object({ id }),
  output: row({ id: uuid, href: z.string(), pageId: uuid }),
  handler: async (input, ctx) => {
    requirePerson(ctx.actor);
    const { collection, cards } = await collectionSnapshot(ctx, input.id);
    if (collection.coverAssetId) {
      const [cover] = await ctx.tx
        .select({ kind: assets.kind, status: assets.status, altText: assets.altText })
        .from(assets)
        .where(eq(assets.id, collection.coverAssetId))
        .limit(1);
      if (!cover || cover.kind !== "image" || cover.status !== "ready" || !cover.altText?.trim()) {
        throw new ServiceError("validation", "A public collection cover needs a ready image with alt text.");
      }
    }
    await ensurePortfolioIndex(ctx);
    const locale = await localeOf(ctx);
    let foundHeading = false;
    let foundCollection = false;
    const blocks = (await templateTree(ctx, "portfolio.collection", locale)).map((block) => {
      if (block.type === "heading" && block.props.level === 1 && !foundHeading) {
        foundHeading = true;
        return { ...block, props: { ...block.props, text: collection.name } };
      }
      if (block.type === "portfolioCollection") {
        foundCollection = true;
        return {
          ...block,
          props: {
            collectionId: collection.id,
            description: collection.description,
            projects: cards,
          },
        };
      }
      return block;
    });
    if (!foundCollection) {
      blocks.push({
        id: "portfolio-collection",
        type: "portfolioCollection",
        props: { collectionId: collection.id, description: collection.description, projects: cards },
      });
    }
    const path = `portfolio/collections-${collection.slug}`;
    let pageId = collection.publicPageId;
    if (pageId) {
      await ctx.callAsSystem(updatePage, {
        id: pageId,
        slug: path,
        title: collection.name,
        blocks,
        seo: { description: collection.description ?? `Selected ${collection.name} work.` },
      });
    } else {
      const page = await ctx.callAsSystem(createPage, {
        slug: path,
        locale,
        title: collection.name,
        blocks,
        seo: { description: collection.description ?? `Selected ${collection.name} work.` },
      });
      pageId = page.id;
    }
    const page = await ctx.callAsSystem(publishPage, { id: pageId, published: true });
    await ctx.tx
      .update(projectCollections)
      .set({
        publicationStatus: "published",
        publishedAt: collection.publishedAt ?? page.publishedAt ?? new Date(),
        publicPageId: pageId,
        updatedAt: sql`now()`,
      })
      .where(eq(projectCollections.id, collection.id));
    ctx.setSubject("project_collection", collection.id);
    return { id: collection.id, href: `/${path}`, pageId };
  },
});

export const unpublishCollection = defineService({
  name: "projects.unpublishCollection",
  summary: "Take a collection page offline without deleting its curation.",
  kind: "mutation",
  permission: "scoped",
  writeClass: "write",
  input: z.object({ id }),
  output: row({ id: uuid }),
  handler: async (input, ctx) => {
    requirePerson(ctx.actor);
    const [collection] = await ctx.tx
      .select()
      .from(projectCollections)
      .where(eq(projectCollections.id, input.id))
      .limit(1);
    if (!collection) throw new ServiceError("not_found", "That collection is not here.");
    if (collection.publicPageId) {
      await ctx.callAsSystem(publishPage, { id: collection.publicPageId, published: false });
    }
    await ctx.tx
      .update(projectCollections)
      .set({ publicationStatus: "draft", publishedAt: null, updatedAt: sql`now()` })
      .where(eq(projectCollections.id, collection.id));
    ctx.setSubject("project_collection", collection.id);
    return { id: collection.id };
  },
});

export const resolvePublicProject = defineService({
  name: "projects.resolvePublicProject",
  summary: "Published project facts for CreativeWork structured data.",
  kind: "query",
  permission: "public",
  input: z.object({ slug }),
  output: z.object({
    project: projectCard,
    services: listed(serviceFacet),
    images: listed(row({ src: z.string(), altText: z.string(), role: z.string() })),
  }).nullable(),
  handler: async (input, ctx) => {
    const all = await liveProjectCards(ctx);
    const project = all.find((candidate) => candidate.slug === input.slug);
    if (!project) return null;
    const products = await visibleProducts(ctx);
    const services = products
      .filter((product) => product.kind === "service" && project.serviceProductIds.includes(product.id))
      .map(({ id, name, slug }) => ({ id, name, slug }));
    const [page] = await ctx.tx
      .select({ blocks: pages.blocks })
      .from(projects)
      .innerJoin(pages, eq(pages.id, projects.publicPageId))
      .where(eq(projects.id, project.id))
      .limit(1);
    const snapshot = snapshotOf(page?.blocks);
    if (!snapshot) return null;
    const files = snapshot.media.map((file) => ({ assetId: file.assetId, role: file.role }));
    if (snapshot.coverAssetId && !files.some((file) => file.assetId === snapshot.coverAssetId)) {
      files.unshift({ assetId: snapshot.coverAssetId, role: "hero" });
    }
    const images = [] as Array<{ src: string; altText: string; role: string }>;
    const resolveImage = getService("media.resolveImage");
    for (const file of files) {
      const image = (await ctx.call(resolveImage, { id: file.assetId })) as {
        src: string;
        altText: string | null;
      } | null;
      if (image?.altText) images.push({ src: image.src, altText: image.altText, role: file.role });
    }
    return { project, services, images };
  },
});

export default [
  createCollection,
  updateCollection,
  addProjectToCollection,
  removeProjectFromCollection,
  listCollections,
  getCollection,
  publishCollection,
  unpublishCollection,
  portfolioBrowse,
  resolvePublicProject,
];
