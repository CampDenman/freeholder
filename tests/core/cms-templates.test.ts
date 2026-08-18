// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Page/post/product/service/email templates (C2.13).
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { seedTemplates } from "@/modules/cms/templates";
import {
  createFromTemplate,
  ensureTemplates,
  getTemplate,
  listTemplates,
  resetTemplate,
  updateTemplate,
} from "@/modules/cms/template-service";
import { updateBusiness } from "@/core/settings/service";
import { closeDb, failure, hasDatabase, OWNER, truncateSpine } from "../helpers/spine";

describe("template seeds", () => {
  it("ships page, post, product, service and email trees per preset", () => {
    const keys = seedTemplates("everything").map((row) => row.key);
    expect(keys).toEqual([
      "page.blank",
      "page.landing",
      "post.article",
      "product.default",
      "service.default",
      "email.transactional",
    ]);
    const shop = seedTemplates("shop");
    expect(shop.find((row) => row.key === "page.landing")?.blocks.some((block) => block.type === "productsIndex")).toBe(
      true,
    );
    const service = seedTemplates("service-business");
    expect(
      service.find((row) => row.key === "page.landing")?.blocks.some((block) => block.type === "booking"),
    ).toBe(true);
  });
});

describe.runIf(hasDatabase)("cms templates", { timeout: 30_000 }, () => {
  beforeEach(truncateSpine, 30_000);
  afterAll(closeDb);

  async function seed() {
    await updateBusiness.call(
      {
        name: "Studio",
        country: "CA",
        baseCurrency: "CAD",
        timezone: "America/Vancouver",
        schemaType: "Photographer",
      },
      OWNER,
    );
    await ensureTemplates.call({}, OWNER);
  }

  it("creates a page from a template and resets an edited tree", async () => {
    await seed();
    const listed = await listTemplates.call({ kind: "page" }, OWNER);
    expect(listed.some((row) => row.key === "page.landing")).toBe(true);

    const created = await createFromTemplate.call(
      { key: "page.landing", title: "Launch", slug: "launch" },
      OWNER,
    );
    expect(created.page?.slug).toBe("launch");
    expect(created.page?.title).toBe("Launch");
    expect(created.blocks.some((block) => block.type === "heading")).toBe(true);
    expect(created.blocks[0]?.id).not.toBe("everything-landing-h1");

    const email = await createFromTemplate.call(
      { key: "email.transactional", title: "Receipt" },
      OWNER,
    );
    expect(email.kind).toBe("email");
    expect(email.page).toBeNull();
    expect(email.blocks.some((block) => block.type === "text")).toBe(true);

    const template = await getTemplate.call({ key: "page.landing" }, OWNER);
    expect(template?.origin).toBe("system");
    await updateTemplate.call(
      {
        key: "page.landing",
        blocks: [{ id: "custom", type: "heading", props: { text: "Custom", level: 1 } }],
      },
      OWNER,
    );
    const edited = await getTemplate.call({ key: "page.landing" }, OWNER);
    expect(edited?.origin).toBe("owner");
    expect((edited?.blocks as { id: string }[])[0]?.id).toBe("custom");

    const reset = await resetTemplate.call({ key: "page.landing" }, OWNER);
    expect(reset.origin).toBe("system");
    expect((reset.blocks as { type: string }[]).some((block) => block.type === "button")).toBe(true);
  });

  it("refuses to reset a key that has no seed", async () => {
    await seed();
    const missing = await failure(resetTemplate.call({ key: "page.imaginary" }, OWNER));
    expect(missing.code).toBe("not_found");
  });
});
