// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Template-backed portfolio browsing and collections (MASTER.md C8.02).
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/core/db";
import { ready } from "@/core/runtime";
import { assets } from "@/core/media/schema";
import { collectSitemapEntries } from "@/core/seo/sitemap";
import { updateBusiness } from "@/core/settings/service";
import { pages } from "@/modules/cms/schema";
import { activateProduct, createProduct } from "@/modules/catalog/service";
import { createTaxCategory } from "@/modules/invoicing/tax-service";
import { createProject, updateProject } from "@/modules/projects/service";
import {
  publishCaseStudy,
  updateCaseStudySettings,
} from "@/modules/projects/publishing-service";
import {
  addProjectToCollection,
  createCollection,
  getCollection,
  portfolioBrowse,
  publishCollection,
} from "@/modules/projects/portfolio-service";
import {
  ANONYMOUS,
  closeDb,
  failure,
  hasDatabase,
  OWNER,
  truncateSpine,
} from "../helpers/spine";

describe.runIf(hasDatabase)("project portfolios", { timeout: 90_000 }, () => {
  beforeEach(async () => {
    await ready();
    await truncateSpine();
    await updateBusiness.call(
      {
        name: "Northline Studio",
        country: "CA",
        baseCurrency: "CAD",
        timezone: "America/Vancouver",
      },
      OWNER,
    );
  }, 60_000);
  afterAll(closeDb);

  async function service(name: string) {
    const suffix = crypto.randomUUID().slice(0, 8);
    const tax = await createTaxCategory.call(
      { code: `portfolio_${suffix}`, name: `Portfolio ${suffix}` },
      OWNER,
    );
    const draft = await createProduct.call(
      { name, slug: `${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${suffix}`, kind: "service", taxCategoryId: tax.id },
      OWNER,
    );
    return activateProduct.call({ id: draft.id, expectedVersion: draft.version }, OWNER);
  }

  async function liveProject(title: string, serviceId: string) {
    const draft = await createProject.call(
      { title, summary: `${title} measured result`, serviceProductIds: [serviceId] },
      OWNER,
    );
    const complete = await updateProject.call(
      { id: draft.id, status: "complete", occurredOn: "2026-07-15" },
      OWNER,
    );
    const published = await publishCaseStudy.call({ id: complete.id }, OWNER);
    return { project: complete, published };
  }

  it("creates the RIBA portfolio index from a CMS template when the first project is published", async () => {
    const offering = await service("Architecture");
    const { project } = await liveProject("Courtyard studio", offering.id);
    const [index] = await db().select().from(pages).where(eq(pages.slug, "portfolio"));
    expect(index).toMatchObject({ title: "Portfolio", status: "published" });
    expect((index!.blocks as Array<{ type: string }>).map((block) => block.type)).toEqual(
      expect.arrayContaining(["heading", "portfolioIndex", "share"]),
    );
    await updateProject.call(
      { id: project.id, title: "Private rename", summary: "Private next summary" },
      OWNER,
    );
    await updateCaseStudySettings.call(
      { id: project.id, coverAssetId: null, featured: true, seo: {} },
      OWNER,
    );
    const browse = await portfolioBrowse.call({ limit: 100 }, ANONYMOUS);
    expect(browse.projects).toEqual([
      expect.objectContaining({
        id: project.id,
        title: "Courtyard studio",
        summary: "Courtyard studio measured result",
        featured: false,
      }),
    ]);
  });

  it("normalizes many-to-many curation and filters only live work", async () => {
    const architecture = await service("Architecture");
    const interiors = await service("Interiors");
    const courtyard = await liveProject("Courtyard studio", architecture.id);
    const loft = await liveProject("Harbour loft", interiors.id);
    const hospitality = await createCollection.call(
      { name: "Café spaces", kind: "industry", description: "Welcoming rooms", position: 1 },
      OWNER,
    );
    const featured = await createCollection.call(
      { name: "Featured work", kind: "portfolio", position: 2 },
      OWNER,
    );
    expect(hospitality.slug).toBe("cafe-spaces");
    await addProjectToCollection.call(
      { collectionId: hospitality.id, projectId: courtyard.project.id, position: 2 },
      OWNER,
    );
    await addProjectToCollection.call(
      { collectionId: featured.id, projectId: courtyard.project.id, position: 1 },
      OWNER,
    );
    await addProjectToCollection.call(
      { collectionId: featured.id, projectId: loft.project.id, position: 2 },
      OWNER,
    );
    expect((await getCollection.call({ id: featured.id }, OWNER))?.projects).toHaveLength(2);

    // Draft collections never become public facets.
    expect((await portfolioBrowse.call({ limit: 100 }, ANONYMOUS)).collections).toEqual([]);
    await publishCollection.call({ id: hospitality.id }, OWNER);
    await publishCollection.call({ id: featured.id }, OWNER);

    const byService = await portfolioBrowse.call({ service: architecture.slug, limit: 100 }, ANONYMOUS);
    expect(byService.projects.map((project) => project.id)).toEqual([courtyard.project.id]);
    const byCollection = await portfolioBrowse.call({ collection: featured.slug, limit: 100 }, ANONYMOUS);
    expect(byCollection.projects.map((project) => project.id).sort()).toEqual(
      [courtyard.project.id, loft.project.id].sort(),
    );
    const byText = await portfolioBrowse.call({ q: "harbour", limit: 100 }, ANONYMOUS);
    expect(byText.projects.map((project) => project.id)).toEqual([loft.project.id]);
  });

  it("publishes collection snapshots and classifies every public page in the sitemap", async () => {
    const offering = await service("Landscape design");
    const { project, published } = await liveProject("Rain garden", offering.id);
    const collection = await createCollection.call(
      { name: "Climate-ready", kind: "season", description: "Resilient outdoor work", position: 0 },
      OWNER,
    );
    await addProjectToCollection.call(
      { collectionId: collection.id, projectId: project.id, position: 0 },
      OWNER,
    );
    const result = await publishCollection.call({ id: collection.id }, OWNER);
    const [page] = await db().select().from(pages).where(eq(pages.id, result.pageId));
    expect(page).toMatchObject({ slug: "portfolio/collections-climate-ready", status: "published" });
    const types = (page!.blocks as Array<{ type: string }>).map((block) => block.type);
    expect(types).toEqual(expect.arrayContaining(["heading", "portfolioCollection", "share"]));

    const entries = await collectSitemapEntries("en");
    expect(entries).toEqual(expect.arrayContaining([
      expect.objectContaining({ slug: "portfolio", kind: "section" }),
      expect.objectContaining({ slug: published.href.slice(1), kind: "project" }),
      expect.objectContaining({ slug: result.href.slice(1), kind: "collection" }),
    ]));
  });

  it("refuses to expose a public image without useful alt text", async () => {
    const offering = await service("Architecture");
    const [cover] = await db().insert(assets).values({
      kind: "image",
      storageKey: `test/${crypto.randomUUID()}.jpg`,
      filename: "Unlabelled.jpg",
      mime: "image/jpeg",
      legacyBytes: 1024,
      bytes: 1024,
      altText: null,
    }).returning();
    const draft = await createProject.call(
      { title: "Hidden studio", serviceProductIds: [offering.id] },
      OWNER,
    );
    const complete = await updateProject.call(
      { id: draft.id, status: "complete" },
      OWNER,
    );
    await updateCaseStudySettings.call(
      { id: complete.id, coverAssetId: cover!.id, featured: false, seo: {} },
      OWNER,
    );
    expect((await failure(publishCaseStudy.call({ id: complete.id }, OWNER))).message).toContain("alt text");
  });
});
