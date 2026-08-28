// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Public proof built from the operational Project record (MASTER.md C8.01).
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/core/db";
import { ready } from "@/core/runtime";
import { assets } from "@/core/media/schema";
import { contacts } from "@/core/contacts/schema";
import { pages } from "@/modules/cms/schema";
import { createTaxCategory } from "@/modules/invoicing/tax-service";
import { activateProduct, createProduct } from "@/modules/catalog/service";
import {
  attachFile,
  createProject,
  setOutcome,
  updateProject,
} from "@/modules/projects/service";
import {
  addTestimonial,
  publicProjectsForService,
  publishCaseStudy,
  recordProjectConsent,
  saveCaseStudy,
  setTestimonialStatus,
} from "@/modules/projects/publishing-service";
import { projectTestimonials, projects } from "@/modules/projects/schema";
import { getService } from "@/core/service";
import { updateBusiness } from "@/core/settings/service";
import {
  ANONYMOUS,
  closeDb,
  failure,
  hasDatabase,
  OWNER,
  truncateSpine,
} from "../helpers/spine";

describe.runIf(hasDatabase)("project case studies", { timeout: 90_000 }, () => {
  beforeEach(async () => {
    await ready();
    await truncateSpine();
    await updateBusiness.call(
      {
        name: "Hearth & Pine",
        country: "CA",
        baseCurrency: "CAD",
        timezone: "America/Vancouver",
      },
      OWNER,
    );
  }, 60_000);
  afterAll(closeDb);

  async function contact(email = "client@example.test") {
    const resolved = (await getService("contacts.resolve").call(
      { email, name: "Rae Lane", source: "test" },
      { kind: "system" },
    )) as { contact: { id: string } };
    return resolved.contact.id;
  }

  async function service() {
    const tax = await createTaxCategory.call(
      { code: `standard_${crypto.randomUUID().slice(0, 6)}`, name: "Standard" },
      OWNER,
    );
    const draft = await createProduct.call(
      {
        name: "Kitchen renovation",
        slug: `kitchen-${crypto.randomUUID().slice(0, 8)}`,
        kind: "service",
        taxCategoryId: tax.id,
      },
      OWNER,
    );
    return activateProduct.call({ id: draft.id, expectedVersion: draft.version }, OWNER);
  }

  async function image(filename: string) {
    const [created] = await db()
      .insert(assets)
      .values({
        kind: "image",
        storageKey: `test/${crypto.randomUUID()}.jpg`,
        filename,
        mime: "image/jpeg",
        legacyBytes: 1024,
        bytes: 1024,
        altText: filename.replace(/\.jpg$/, ""),
      })
      .returning();
    return created!;
  }

  async function completeProject() {
    const clientId = await contact();
    const offering = await service();
    const created = await createProject.call(
      {
        title: `Henderson kitchen ${crypto.randomUUID().slice(0, 6)}`,
        contactId: clientId,
        clientDisplayName: "The Hendersons",
        serviceProductIds: [offering.id],
      },
      OWNER,
    );
    const complete = await updateProject.call(
      { id: created.id, status: "complete", summary: "A brighter working kitchen." },
      OWNER,
    );
    return { project: complete, clientId, offering };
  }

  it("refuses incomplete work, unnamed permission, unmeasured claims and half pairs", async () => {
    const clientId = await contact();
    const offering = await service();
    const draft = await createProject.call(
      { title: "Maple kitchen", contactId: clientId, serviceProductIds: [offering.id] },
      OWNER,
    );
    expect((await failure(publishCaseStudy.call({ id: draft.id }, OWNER))).message).toContain("Finish");

    await updateProject.call({ id: draft.id, status: "complete" }, OWNER);
    expect((await failure(publishCaseStudy.call({ id: draft.id }, OWNER))).message).toContain("permission");
    await recordProjectConsent.call({ id: draft.id, method: "email" }, OWNER);
    await setOutcome.call(
      { projectId: draft.id, label: "Prep time", value: "30", unit: "%" },
      OWNER,
    );
    expect((await failure(publishCaseStudy.call({ id: draft.id }, OWNER))).message).toContain("measured");

    const before = await image("before.jpg");
    await attachFile.call(
      { projectId: draft.id, assetId: before.id, role: "before", pairKey: "island" },
      OWNER,
    );
    // Remove the unmeasured claim directly only to isolate the pairing guard.
    const { projectOutcomes } = await import("@/modules/projects/schema");
    await db().delete(projectOutcomes).where(eq(projectOutcomes.projectId, draft.id));
    expect((await failure(publishCaseStudy.call({ id: draft.id }, OWNER))).message).toContain("exactly one before");
  });

  it("publishes a CMS snapshot with services, outcomes, paired media and contact-backed testimony", async () => {
    const { project, clientId, offering } = await completeProject();
    await recordProjectConsent.call({ id: project.id, method: "contract", note: "Clause 8" }, OWNER);
    await setOutcome.call(
      {
        projectId: project.id,
        label: "Prep time",
        value: "30",
        unit: "%",
        method: "Timed five comparable weekday meals before and after.",
      },
      OWNER,
    );
    const [before, after] = await Promise.all([image("Before kitchen.jpg"), image("After kitchen.jpg")]);
    await attachFile.call(
      { projectId: project.id, assetId: before.id, role: "before", pairKey: "island" },
      OWNER,
    );
    await attachFile.call(
      { projectId: project.id, assetId: after.id, role: "after", pairKey: "island" },
      OWNER,
    );
    const testimonial = await addTestimonial.call(
      {
        projectId: project.id,
        contactId: clientId,
        displayName: "Rae Lane",
        body: "The room finally works for us.",
        rating: 5,
        consentMethod: "email",
        displayLocations: ["project", "service"],
      },
      OWNER,
    );
    await setTestimonialStatus.call({ id: testimonial.id, status: "published" }, OWNER);

    const published = await publishCaseStudy.call({ id: project.id }, OWNER);
    expect(published.href).toMatch(/^\/portfolio\//);
    const [page] = await db().select().from(pages).where(eq(pages.id, published.pageId));
    expect(page).toMatchObject({ status: "published" });
    const detail = (page!.blocks as Array<{ type: string; props: Record<string, unknown> }>).find(
      (block) => block.type === "projectCaseStudy",
    );
    expect(detail?.props.services).toEqual([
      expect.objectContaining({ id: offering.id, name: "Kitchen renovation" }),
    ]);
    const outcomes = detail?.props.outcomes as Array<{ label: string; method: string }>;
    expect(outcomes).toHaveLength(1);
    expect(outcomes[0]?.label).toBe("Prep time");
    expect(outcomes[0]?.method).toContain("Timed");
    expect(detail?.props.media).toHaveLength(2);
    expect(detail?.props.testimonials).toEqual([
      expect.objectContaining({ id: testimonial.id, displayName: "Rae Lane" }),
    ]);

    const reciprocal = await publicProjectsForService.call(
      { productId: offering.id },
      ANONYMOUS,
    );
    expect(reciprocal).toEqual([
      expect.objectContaining({ id: project.id, href: published.href }),
    ]);
  });

  it("keeps later block edits private until the next explicit publish", async () => {
    const { project } = await completeProject();
    await recordProjectConsent.call({ id: project.id, method: "written" }, OWNER);
    const first = await publishCaseStudy.call({ id: project.id }, OWNER);
    const [before] = await db().select().from(pages).where(eq(pages.id, first.pageId));
    await saveCaseStudy.call(
      {
        id: project.id,
        expectedVersion: project.version + 2,
        blocks: [
          { id: "private-next-draft", type: "text", props: { body: "Not live yet", align: "start", measure: true } },
        ],
      },
      OWNER,
    );
    const [after] = await db().select().from(pages).where(eq(pages.id, first.pageId));
    expect(after!.blocks).toEqual(before!.blocks);
    expect(JSON.stringify(after!.blocks)).not.toContain("Not live yet");
  });

  it("removes withdrawn testimony from an already-live snapshot immediately", async () => {
    const { project, clientId } = await completeProject();
    await recordProjectConsent.call({ id: project.id, method: "email" }, OWNER);
    const quote = await addTestimonial.call(
      {
        projectId: project.id,
        contactId: clientId,
        displayName: "Rae Lane",
        body: "Publishable for now.",
        consentMethod: "email",
        displayLocations: ["project"],
      },
      OWNER,
    );
    await setTestimonialStatus.call({ id: quote.id, status: "published" }, OWNER);
    const published = await publishCaseStudy.call({ id: project.id }, OWNER);
    await setTestimonialStatus.call({ id: quote.id, status: "withdrawn" }, OWNER);
    const [page] = await db().select().from(pages).where(eq(pages.id, published.pageId));
    expect(JSON.stringify(page!.blocks)).not.toContain(quote.id);
    expect(page!.status).toBe("published");
  });

  it("privacy erasure takes named client work offline and deletes their testimonial", async () => {
    const { project, clientId } = await completeProject();
    await recordProjectConsent.call({ id: project.id, method: "email" }, OWNER);
    const quote = await addTestimonial.call(
      {
        projectId: project.id,
        contactId: clientId,
        displayName: "Rae Lane",
        body: "Personal words.",
        consentMethod: "email",
        displayLocations: ["project"],
      },
      OWNER,
    );
    await setTestimonialStatus.call({ id: quote.id, status: "published" }, OWNER);
    const published = await publishCaseStudy.call({ id: project.id }, OWNER);
    const { contactPrivacySources } = await import("@/core/privacy/service");
    for (const source of contactPrivacySources().filter((entry) => entry.scope.startsWith("contact.project"))) {
      await db().transaction((tx) => source.erase(tx, clientId, { requestId: "erase-test" }));
    }
    const [page] = await db().select().from(pages).where(eq(pages.id, published.pageId));
    const [row] = await db().select().from(projects).where(eq(projects.id, project.id));
    expect(page!.status).toBe("draft");
    expect(row).toMatchObject({ contactId: null, clientDisplayName: null, publicationStatus: "draft" });
    expect(await db().select().from(projectTestimonials)).toHaveLength(0);
    expect(await db().select().from(contacts).where(eq(contacts.id, clientId))).toHaveLength(1);
  });
});
