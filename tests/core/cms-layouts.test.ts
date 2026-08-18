// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Per-entity layout detach / rejoin (C2.14).
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { applyLayoutBindings, ensureBoundEntityBlock } from "@/modules/cms/layout-service";
import {
  attachLayout,
  detachLayout,
  ensureTemplates,
  getLayout,
  rejoinLayout,
  updatePage,
} from "@/modules/cms/service";
import { createFromTemplate } from "@/modules/cms/template-service";
import { updateBusiness } from "@/core/settings/service";
import { closeDb, hasDatabase, OWNER, truncateSpine } from "../helpers/spine";

describe("layout bindings", () => {
  it("writes the entity name onto the H1 and keeps a product bind block", () => {
    const bound = applyLayoutBindings(
      [{ id: "h", type: "heading", props: { text: "Template", level: 1 } }],
      { title: "Prints" },
    );
    expect(bound[0]?.props.text).toBe("Prints");
    const withProduct = ensureBoundEntityBlock(bound, "product", {
      productId: "00000000-0000-4000-8000-000000000099",
      slug: "prints",
    });
    expect(withProduct.some((node) => node.type === "productDetail")).toBe(true);
  });
});

describe.runIf(hasDatabase)("cms entity layouts", { timeout: 30_000 }, () => {
  beforeEach(truncateSpine, 30_000);
  afterAll(closeDb);

  it("detaches when the page is edited and rejoins the template", async () => {
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
    const created = await createFromTemplate.call(
      { key: "page.landing", title: "About us", slug: "about-us" },
      OWNER,
    );
    expect(created.page).not.toBeNull();
    const pageId = created.page!.id;

    await attachLayout.call(
      {
        pageId,
        entityType: "page",
        entityId: pageId,
        templateKey: "page.landing",
        detached: false,
      },
      OWNER,
    );

    await updatePage.call(
      {
        id: pageId,
        blocks: [{ id: "custom", type: "heading", props: { text: "Bespoke", level: 1 } }],
      },
      OWNER,
    );
    const detached = await getLayout.call({ pageId }, OWNER);
    expect(detached?.detached).toBe(true);

    const joined = await rejoinLayout.call({ pageId, bindings: { title: "About us" } }, OWNER);
    expect(joined.layout.detached).toBe(false);
    expect(joined.blocks.some((block) => block.type === "button")).toBe(true);

    await detachLayout.call({ pageId }, OWNER);
    const again = await getLayout.call({ pageId }, OWNER);
    expect(again?.detached).toBe(true);
  });
});
