// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// The publishing half of the operational Project record (MASTER.md C8.01).
//
// A publish copies normalized project facts and the owner-authored block tree
// into a CMS page. The public page is therefore a snapshot: editing tomorrow's
// draft cannot alter today's site until the owner publishes again.
import { and, asc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { assets } from "@/core/media/schema";
import { contacts } from "@/core/contacts/schema";
import { listed, row, timestamp, uuid } from "@/core/contract";
import { defineService, getService, ServiceError, type Actor, type ServiceContext } from "@/core/service";
import { getBusiness } from "@/core/settings/service";
import { blockTreeSchema } from "@/modules/cms/blocks/registry";
import type { BlockNode } from "@/modules/cms/blocks/types";
import { createPage, getPage, publishPage, updatePage } from "@/modules/cms/service";
import { pages } from "@/modules/cms/schema";
import {
  PROJECT_CONSENT_METHODS,
  TESTIMONIAL_STATUSES,
  projectFiles,
  projectOutcomes,
  projectTestimonials,
  projects,
} from "./schema";
import { ensurePortfolioIndex, projectTemplateSnapshot } from "./portfolio-service";

const id = z.string().uuid();
const consentMethod = z.enum(PROJECT_CONSENT_METHODS);

function requirePerson(actor: Actor): void {
  if (actor.kind !== "user" && actor.kind !== "system") {
    throw new ServiceError("permission", "Sign in to publish projects.");
  }
}

const testimonialRow = row({
  id: uuid,
  projectId: uuid,
  contactId: uuid,
  displayName: z.string(),
  role: z.string().nullable(),
  body: z.string(),
  rating: z.number().int().nullable(),
  assetId: uuid.nullable(),
  consentGivenAt: timestamp,
  consentMethod,
  consentNote: z.string().nullable(),
  status: z.enum(TESTIMONIAL_STATUSES),
  displayLocations: z.array(z.string()),
});

const publicProjectRow = row({
  id: uuid,
  title: z.string(),
  slug: z.string(),
  summary: z.string().nullable(),
  href: z.string(),
  featured: z.boolean(),
  occurredOn: z.string().nullable(),
});

type ProductBundle = {
  product: {
    id: string;
    name: string;
    slug: string;
    kind: string;
    status: string;
    visibility: string;
  };
};

async function projectForUpdate(ctx: ServiceContext, projectId: string) {
  const [project] = await ctx.tx
    .select()
    .from(projects)
    .where(eq(projects.id, projectId))
    .for("update");
  if (!project) throw new ServiceError("not_found", "That project is not here.");
  return project;
}

async function serviceSnapshots(ctx: ServiceContext, productIds: string[]) {
  const found = [] as Array<{ id: string; name: string; slug: string }>;
  for (const productId of productIds) {
    let bundle: ProductBundle;
    try {
      bundle = (await ctx.callAsSystem(getService("catalog.getProduct"), {
        id: productId,
      })) as ProductBundle;
    } catch {
      throw new ServiceError("validation", "Every case-study service must still exist in the catalog.");
    }
    const product = bundle.product;
    if (product.kind !== "service" || product.status !== "active" || product.visibility !== "public") {
      throw new ServiceError(
        "validation",
        `${product.name} must be an active public service before this case study can link to it.`,
      );
    }
    found.push({ id: product.id, name: product.name, slug: product.slug });
  }
  return found;
}

async function publicationFacts(ctx: ServiceContext, projectId: string) {
  const [outcomes, files, testimonials] = await Promise.all([
    ctx.tx
      .select()
      .from(projectOutcomes)
      .where(eq(projectOutcomes.projectId, projectId))
      .orderBy(asc(projectOutcomes.position)),
    ctx.tx
      .select({
        file: projectFiles,
        kind: assets.kind,
        status: assets.status,
        altText: assets.altText,
      })
      .from(projectFiles)
      .innerJoin(assets, eq(assets.id, projectFiles.assetId))
      .where(eq(projectFiles.projectId, projectId))
      .orderBy(asc(projectFiles.position)),
    ctx.tx
      .select()
      .from(projectTestimonials)
      .where(
        and(
          eq(projectTestimonials.projectId, projectId),
          eq(projectTestimonials.status, "published"),
        ),
      )
      .orderBy(asc(projectTestimonials.createdAt)),
  ]);
  return { outcomes, files, testimonials };
}

function assertPairs(files: Array<{ file: typeof projectFiles.$inferSelect }>): void {
  const pairs = new Map<string, { before: number; after: number }>();
  for (const { file } of files) {
    if (file.role !== "before" && file.role !== "after") continue;
    const count = pairs.get(file.pairKey!) ?? { before: 0, after: 0 };
    count[file.role] += 1;
    pairs.set(file.pairKey!, count);
  }
  for (const [pair, count] of pairs) {
    if (count.before !== 1 || count.after !== 1) {
      throw new ServiceError(
        "validation",
        `Before/after pair "${pair}" needs exactly one before and one after image.`,
      );
    }
  }
}

async function snapshotBlocks(
  ctx: ServiceContext,
  project: typeof projects.$inferSelect,
): Promise<BlockNode[]> {
  const facts = await publicationFacts(ctx, project.id);
  assertPairs(facts.files);
  const unusable = facts.files.find(
    ({ file, kind, status, altText }) =>
      file.role !== "document" &&
      (kind !== "image" || status !== "ready" || !altText?.trim()),
  );
  if (unusable) {
    throw new ServiceError(
      "validation",
      "Every public project image must be ready and have useful alt text.",
    );
  }
  if (project.coverAssetId) {
    const [cover] = await ctx.tx
      .select({ kind: assets.kind, status: assets.status, altText: assets.altText })
      .from(assets)
      .where(eq(assets.id, project.coverAssetId))
      .limit(1);
    if (!cover || cover.kind !== "image" || cover.status !== "ready" || !cover.altText?.trim()) {
      throw new ServiceError(
        "validation",
        "The public project cover must be ready and have useful alt text.",
      );
    }
  }
  const unmeasured = facts.outcomes.find((outcome) => !outcome.method?.trim());
  if (unmeasured) {
    throw new ServiceError(
      "validation",
      `Explain how "${unmeasured.label}" was measured before publishing it.`,
    );
  }
  const services = await serviceSnapshots(ctx, project.serviceProductIds);
  if (services.length === 0) {
    throw new ServiceError("validation", "Link at least one active public service before publishing.");
  }
  return projectTemplateSnapshot(ctx, {
    locale: await defaultLocale(ctx),
    title: project.title,
    facts: {
      projectId: project.id,
      summary: project.summary,
      clientDisplayName: project.clientDisplayName,
      occurredOn: project.occurredOn,
      coverAssetId: project.coverAssetId,
      featured: project.featured,
      services,
      outcomes: facts.outcomes.map((outcome) => ({
        label: outcome.label,
        value: outcome.value,
        unit: outcome.unit,
        method: outcome.method!,
      })),
      media: facts.files
        .filter(({ file }) => file.role !== "document")
        .map(({ file }) => ({
          assetId: file.assetId,
          role: file.role,
          pairKey: file.pairKey,
          caption: file.caption,
          position: file.position,
        })),
      testimonials: facts.testimonials.map((testimonial) => ({
        id: testimonial.id,
        displayName: testimonial.displayName,
        role: testimonial.role,
        body: testimonial.body,
        rating: testimonial.rating,
      })),
    },
    authored: project.blocks,
  });
}

async function defaultLocale(ctx: ServiceContext): Promise<string> {
  const business = await ctx.callAsSystem(getBusiness, {});
  return business?.defaultLocale ?? "en";
}

export const saveCaseStudy = defineService({
  name: "projects.saveCaseStudy",
  summary: "Save the next case-study draft without changing the public page.",
  kind: "mutation",
  permission: "scoped",
  writeClass: "blocks",
  input: z.object({
    id,
    expectedVersion: z.number().int().positive(),
    blocks: blockTreeSchema("page"),
    coverAssetId: id.nullish().optional(),
    featured: z.boolean().optional(),
    seo: z.object({
      title: z.string().trim().max(60).optional(),
      description: z.string().trim().max(155).optional(),
    }).optional(),
  }),
  output: row({ id: uuid, version: z.number().int(), blocks: z.unknown() }),
  handler: async (input, ctx) => {
    requirePerson(ctx.actor);
    const project = await projectForUpdate(ctx, input.id);
    if (project.version !== input.expectedVersion) {
      throw new ServiceError(
        "conflict",
        "This project changed after you opened it. Reload before saving again.",
      );
    }
    const [updated] = await ctx.tx
      .update(projects)
      .set({
        blocks: input.blocks,
        ...(input.coverAssetId !== undefined
          ? { coverAssetId: input.coverAssetId ?? null }
          : {}),
        ...(input.featured !== undefined ? { featured: input.featured } : {}),
        ...(input.seo !== undefined ? { seo: input.seo } : {}),
        version: project.version + 1,
        updatedAt: sql`now()`,
      })
      .where(and(eq(projects.id, project.id), eq(projects.version, project.version)))
      .returning({ id: projects.id, version: projects.version, blocks: projects.blocks });
    if (!updated) throw new ServiceError("conflict", "This project changed while it was being saved.");
    ctx.setSubject("project", project.id);
    return updated;
  },
});

export const updateCaseStudySettings = defineService({
  name: "projects.updateCaseStudySettings",
  summary: "Change cover, featured placement and search copy for the next publish.",
  kind: "mutation",
  permission: "scoped",
  writeClass: "write",
  input: z.object({
    id,
    coverAssetId: id.nullish(),
    featured: z.boolean(),
    seo: z.object({
      title: z.string().trim().max(60).optional(),
      description: z.string().trim().max(155).optional(),
    }),
  }),
  output: row({ id: uuid, version: z.number().int() }),
  handler: async (input, ctx) => {
    requirePerson(ctx.actor);
    const project = await projectForUpdate(ctx, input.id);
    if (input.coverAssetId) {
      const [cover] = await ctx.tx
        .select({ kind: assets.kind, status: assets.status })
        .from(assets)
        .where(eq(assets.id, input.coverAssetId))
        .limit(1);
      if (!cover || cover.kind !== "image" || cover.status !== "ready") {
        throw new ServiceError("validation", "Choose a ready image from the media library as the cover.");
      }
    }
    const [updated] = await ctx.tx
      .update(projects)
      .set({
        coverAssetId: input.coverAssetId ?? null,
        featured: input.featured,
        seo: input.seo,
        version: project.version + 1,
        updatedAt: sql`now()`,
      })
      .where(eq(projects.id, project.id))
      .returning({ id: projects.id, version: projects.version });
    ctx.setSubject("project", project.id);
    return updated!;
  },
});

export const recordProjectConsent = defineService({
  name: "projects.recordConsent",
  summary: "Record the permission that allows client work to be published.",
  kind: "mutation",
  permission: "scoped",
  writeClass: "write",
  input: z.object({
    id,
    method: consentMethod,
    note: z.string().trim().max(1_000).nullish(),
  }),
  output: row({ id: uuid, givenAt: timestamp, method: consentMethod }),
  handler: async (input, ctx) => {
    requirePerson(ctx.actor);
    const project = await projectForUpdate(ctx, input.id);
    if (!project.contactId) {
      throw new ServiceError("validation", "Internal work does not need client publication consent.");
    }
    const [updated] = await ctx.tx
      .update(projects)
      .set({
        clientConsentGivenAt: sql`now()`,
        clientConsentMethod: input.method,
        clientConsentNote: input.note ?? null,
        version: project.version + 1,
        updatedAt: sql`now()`,
      })
      .where(eq(projects.id, project.id))
      .returning({
        id: projects.id,
        givenAt: projects.clientConsentGivenAt,
        method: projects.clientConsentMethod,
      });
    ctx.setSubject("project", project.id);
    return { id: updated!.id, givenAt: updated!.givenAt!, method: updated!.method! };
  },
});

export const addTestimonial = defineService({
  name: "projects.addTestimonial",
  summary: "Attach consented, contact-backed praise to the work it describes.",
  kind: "mutation",
  permission: "scoped",
  writeClass: "write",
  input: z.object({
    projectId: id,
    contactId: id,
    displayName: z.string().trim().min(1).max(200),
    role: z.string().trim().max(200).nullish(),
    body: z.string().trim().min(1).max(5_000),
    rating: z.number().int().min(1).max(5).nullish(),
    assetId: id.nullish(),
    consentMethod,
    consentNote: z.string().trim().max(1_000).nullish(),
    displayLocations: z
      .array(z.enum(["project", "service", "portfolio"]))
      .min(1)
      .max(3)
      .default(["project"]),
  }),
  output: testimonialRow,
  handler: async (input, ctx) => {
    requirePerson(ctx.actor);
    const [[project], [contact]] = await Promise.all([
      ctx.tx.select({ id: projects.id }).from(projects).where(eq(projects.id, input.projectId)).limit(1),
      ctx.tx.select({ id: contacts.id }).from(contacts).where(eq(contacts.id, input.contactId)).limit(1),
    ]);
    if (!project) throw new ServiceError("not_found", "That project is not here.");
    if (!contact) throw new ServiceError("not_found", "That contact is not here.");
    const [created] = await ctx.tx
      .insert(projectTestimonials)
      .values({
        projectId: input.projectId,
        contactId: input.contactId,
        displayName: input.displayName,
        role: input.role ?? null,
        body: input.body,
        rating: input.rating ?? null,
        assetId: input.assetId ?? null,
        consentGivenAt: new Date(),
        consentMethod: input.consentMethod,
        consentNote: input.consentNote ?? null,
        displayLocations: input.displayLocations,
      })
      .returning();
    ctx.setSubject("project", input.projectId);
    return created!;
  },
});

export const setTestimonialStatus = defineService({
  name: "projects.setTestimonialStatus",
  summary: "Publish or withdraw a project testimonial.",
  kind: "mutation",
  permission: "scoped",
  writeClass: "write",
  input: z.object({ id, status: z.enum(TESTIMONIAL_STATUSES) }),
  output: testimonialRow,
  handler: async (input, ctx) => {
    requirePerson(ctx.actor);
    const [updated] = await ctx.tx
      .update(projectTestimonials)
      .set({ status: input.status, updatedAt: sql`now()` })
      .where(eq(projectTestimonials.id, input.id))
      .returning();
    if (!updated) throw new ServiceError("not_found", "That testimonial is not here.");
    if (input.status === "withdrawn") {
      await removeTestimonialFromSnapshot(ctx, updated.projectId, updated.id);
    }
    ctx.setSubject("project", updated.projectId);
    return updated;
  },
});

async function removeTestimonialFromSnapshot(
  ctx: ServiceContext,
  projectId: string,
  testimonialId: string,
): Promise<void> {
  const [project] = await ctx.tx
    .select({ publicPageId: projects.publicPageId, publicationStatus: projects.publicationStatus })
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);
  if (!project?.publicPageId || project.publicationStatus !== "published") return;
  const page = await ctx.callAsSystem(getPage, { id: project.publicPageId });
  const draft = (page.workingBlocks ?? page.blocks) as BlockNode[];
  const next = draft.map((block) => {
    if (block.type !== "projectCaseStudy") return block;
    const testimonials = Array.isArray(block.props.testimonials)
      ? block.props.testimonials.filter(
          (entry) =>
            typeof entry !== "object" ||
            entry === null ||
            (entry as { id?: string }).id !== testimonialId,
        )
      : [];
    return { ...block, props: { ...block.props, testimonials } };
  });
  await ctx.callAsSystem(updatePage, { id: page.id, blocks: next });
  await ctx.callAsSystem(publishPage, { id: page.id, published: true });
}

export const removeOutcome = defineService({
  name: "projects.removeOutcome",
  summary: "Remove an outcome from the next case-study draft.",
  kind: "mutation",
  permission: "scoped",
  writeClass: "destructive",
  input: z.object({ id }),
  output: row({ id: uuid, projectId: uuid }),
  handler: async (input, ctx) => {
    requirePerson(ctx.actor);
    const [removed] = await ctx.tx
      .delete(projectOutcomes)
      .where(eq(projectOutcomes.id, input.id))
      .returning({ id: projectOutcomes.id, projectId: projectOutcomes.projectId });
    if (!removed) throw new ServiceError("not_found", "That outcome is not here.");
    ctx.setSubject("project", removed.projectId);
    return removed;
  },
});

export const detachFile = defineService({
  name: "projects.detachFile",
  summary: "Remove a media attachment from the next case-study draft.",
  kind: "mutation",
  permission: "scoped",
  writeClass: "destructive",
  input: z.object({ id }),
  output: row({ id: uuid, projectId: uuid }),
  handler: async (input, ctx) => {
    requirePerson(ctx.actor);
    const [removed] = await ctx.tx
      .delete(projectFiles)
      .where(eq(projectFiles.id, input.id))
      .returning({ id: projectFiles.id, projectId: projectFiles.projectId });
    if (!removed) throw new ServiceError("not_found", "That file is not attached here.");
    ctx.setSubject("project", removed.projectId);
    return removed;
  },
});

export const publishCaseStudy = defineService({
  name: "projects.publish",
  summary: "Publish a reviewed project as a CMS-backed case study.",
  kind: "mutation",
  permission: "scoped",
  writeClass: "write",
  input: z.object({ id }),
  output: row({ id: uuid, href: z.string(), pageId: uuid, publishedAt: timestamp }),
  handler: async (input, ctx) => {
    requirePerson(ctx.actor);
    const project = await projectForUpdate(ctx, input.id);
    if (project.status !== "complete") {
      throw new ServiceError("validation", "Finish this project before publishing its case study.");
    }
    if (project.contactId && !project.clientConsentGivenAt) {
      throw new ServiceError(
        "validation",
        "Record the client's publication permission before publishing their work.",
      );
    }
    const blocks = await snapshotBlocks(ctx, project);
    await ensurePortfolioIndex(ctx);
    const locale = await defaultLocale(ctx);
    const path = `portfolio/${project.slug}`;
    let pageId = project.publicPageId;
    if (pageId) {
      await ctx.callAsSystem(updatePage, {
        id: pageId,
        slug: path,
        title: project.title,
        blocks,
        seo: project.seo,
      });
    } else {
      const page = await ctx.callAsSystem(createPage, {
        slug: path,
        locale,
        title: project.title,
        blocks,
        seo: project.seo,
      });
      pageId = page.id;
    }
    const page = await ctx.callAsSystem(publishPage, { id: pageId, published: true });
    const [updated] = await ctx.tx
      .update(projects)
      .set({
        publicationStatus: "published",
        publishedAt: project.publishedAt ?? page.publishedAt ?? new Date(),
        publicPageId: pageId,
        version: project.version + 1,
        updatedAt: sql`now()`,
      })
      .where(eq(projects.id, project.id))
      .returning({ id: projects.id, publishedAt: projects.publishedAt });
    ctx.setSubject("project", project.id);
    ctx.queueEvent("project.published", { id: project.id, pageId, path });
    return { id: updated!.id, href: `/${path}`, pageId, publishedAt: updated!.publishedAt! };
  },
});

export const unpublishCaseStudy = defineService({
  name: "projects.unpublish",
  summary: "Take a case study offline while keeping its project and draft.",
  kind: "mutation",
  permission: "scoped",
  writeClass: "write",
  input: z.object({ id }),
  output: row({ id: uuid }),
  handler: async (input, ctx) => {
    requirePerson(ctx.actor);
    const project = await projectForUpdate(ctx, input.id);
    if (project.publicPageId) {
      await ctx.callAsSystem(publishPage, { id: project.publicPageId, published: false });
    }
    await ctx.tx
      .update(projects)
      .set({
        publicationStatus: "draft",
        publishedAt: null,
        version: project.version + 1,
        updatedAt: sql`now()`,
      })
      .where(eq(projects.id, project.id));
    ctx.setSubject("project", project.id);
    ctx.queueEvent("project.unpublished", { id: project.id, pageId: project.publicPageId });
    return { id: project.id };
  },
});

export const revokeProjectConsent = defineService({
  name: "projects.revokeConsent",
  summary: "Withdraw client publication permission and immediately take the case study offline.",
  kind: "mutation",
  permission: "scoped",
  writeClass: "destructive",
  input: z.object({ id }),
  output: row({ id: uuid }),
  handler: async (input, ctx) => {
    requirePerson(ctx.actor);
    const project = await projectForUpdate(ctx, input.id);
    if (project.publicPageId && project.publicationStatus === "published") {
      await ctx.callAsSystem(publishPage, { id: project.publicPageId, published: false });
    }
    await ctx.tx
      .update(projects)
      .set({
        clientConsentGivenAt: null,
        clientConsentMethod: null,
        clientConsentNote: null,
        publicationStatus: "draft",
        publishedAt: null,
        version: project.version + 1,
        updatedAt: sql`now()`,
      })
      .where(eq(projects.id, project.id));
    ctx.setSubject("project", project.id);
    return { id: project.id };
  },
});

export const publicProjectsForService = defineService({
  name: "projects.publicForService",
  summary: "Published work proving one catalog service.",
  kind: "query",
  permission: "public",
  input: z.object({ productId: id, limit: z.number().int().min(1).max(50).default(12) }),
  output: listed(publicProjectRow),
  handler: (input, ctx) =>
    ctx.tx
      .select({
        id: projects.id,
        title: projects.title,
        slug: projects.slug,
        summary: projects.summary,
        featured: projects.featured,
        occurredOn: projects.occurredOn,
      })
      .from(projects)
      .innerJoin(pages, eq(pages.id, projects.publicPageId))
      .where(
        and(
          eq(projects.publicationStatus, "published"),
          eq(pages.status, "published"),
          sql`${input.productId}::uuid = any(${projects.serviceProductIds})`,
        ),
      )
      .orderBy(sql`${projects.featured} desc`, sql`${projects.occurredOn} desc nulls last`)
      .limit(input.limit)
      .then((rows) => rows.map((project) => ({
        ...project,
        href: `/portfolio/${project.slug}`,
      }))),
});

export default [
  saveCaseStudy,
  updateCaseStudySettings,
  recordProjectConsent,
  revokeProjectConsent,
  addTestimonial,
  setTestimonialStatus,
  removeOutcome,
  detachFile,
  publishCaseStudy,
  unpublishCaseStudy,
  publicProjectsForService,
];
