// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Draft/published cache, page budgets and no client swap (C2.22).
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { invalidationPlan, pageCacheVary, publicPathForSlug } from "@/modules/cms/cache";
import {
  PAGE_BLOCK_BUDGET,
  PAGE_IMAGE_BUDGET,
  budgetMessage,
  measurePageBudget,
} from "@/modules/cms/budgets";
import { selectAssignedVariants } from "@/modules/cms/experiments";
import { createPage, publishPage, updatePage } from "@/modules/cms/service";
import { closeDb, failure, hasDatabase, OWNER, truncateSpine } from "../helpers/spine";
import type { BlockNode } from "@/modules/cms/blocks/types";

const heading = (id: string, text: string): BlockNode => ({
  id,
  type: "heading",
  props: { text, level: 1, align: "start" },
});

describe("cache invalidation", () => {
  it("keeps a draft save off the public page", () => {
    const draft = invalidationPlan({ kind: "draft", pageId: "page-1", slug: "about" });
    expect(draft.map((row) => row.path)).toEqual([
      "/admin/pages/page-1",
      "/preview/page/page-1",
    ]);
    expect(draft.some((row) => row.path === "/about" || row.path === "/")).toBe(false);
  });

  it("busts the public slug on publish and the chrome on a section edit", () => {
    expect(publicPathForSlug("")).toBe("/");
    expect(publicPathForSlug("about")).toBe("/about");
    const published = invalidationPlan({ kind: "published", slug: "about" });
    expect(published.map((row) => row.path)).toEqual(["/about", "/"]);
    expect(invalidationPlan({ kind: "chrome" })).toEqual([{ path: "/", type: "layout" }]);
  });

  it("includes experiment assignment in the cache vary key", () => {
    expect(pageCacheVary({ hero: "control" })).toBe("hero=control");
    expect(pageCacheVary({ hero: "treatment" })).not.toBe(pageCacheVary({ hero: "control" }));
  });
});

describe("page budgets", () => {
  it("counts blocks and images and names the first overrun", () => {
    const images: BlockNode[] = Array.from({ length: PAGE_IMAGE_BUDGET + 1 }, (_, i) => ({
      id: `img-${i}`,
      type: "image",
      props: {},
    }));
    expect(measurePageBudget([heading("h", "Title"), ...images]).images).toBe(
      PAGE_IMAGE_BUDGET + 1,
    );
    expect(budgetMessage(images)).toMatch(/images/);
    const many: BlockNode[] = Array.from({ length: PAGE_BLOCK_BUDGET + 1 }, (_, i) =>
      heading(`h-${i}`, `H ${i}`),
    );
    expect(budgetMessage(many)).toMatch(/blocks/);
  });

  it("measures an in-budget tree quickly", () => {
    const tree: BlockNode[] = Array.from({ length: 40 }, (_, i) => heading(`h-${i}`, `H ${i}`));
    const start = performance.now();
    for (let i = 0; i < 200; i += 1) measurePageBudget(tree);
    expect(performance.now() - start).toBeLessThan(50);
    expect(budgetMessage(tree)).toBeNull();
  });
});

describe("zero client-side layout swap", () => {
  it("returns only the assigned variant for the public surface", () => {
    const children: BlockNode[] = [
      {
        id: "a",
        type: "variant",
        props: { name: "control", weight: 50 },
        children: [heading("c", "Control")],
      },
      {
        id: "b",
        type: "variant",
        props: { name: "treatment", weight: 50 },
        children: [heading("t", "Treatment")],
      },
    ];
    const publicChosen = selectAssignedVariants("hero", children, { hero: "control" }, null, false);
    expect(publicChosen).toHaveLength(1);
    expect(publicChosen[0]?.props.name).toBe("control");
    const editor = selectAssignedVariants("hero", children, { hero: "control" }, null, true);
    expect(editor).toHaveLength(2);
  });
});

describe.runIf(hasDatabase)("over-budget writes are refused", { timeout: 30_000 }, () => {
  beforeEach(truncateSpine, 30_000);
  afterAll(closeDb);

  it("will not save or publish a page past the block budget", async () => {
    const tooMany: BlockNode[] = Array.from({ length: PAGE_BLOCK_BUDGET + 1 }, (_, i) =>
      heading(`h-${i}`, `Heading ${i}`),
    );
    const created = await failure(
      createPage.call({ slug: "huge", title: "Huge", blocks: tooMany }, OWNER),
    );
    expect(created.code).toBe("validation");

    const page = await createPage.call(
      { slug: "ok", title: "Ok", blocks: [heading("h", "Ok")] },
      OWNER,
    );
    const blocked = await failure(
      updatePage.call({ id: page.id, blocks: tooMany }, OWNER),
    );
    expect(blocked.code).toBe("validation");
    const live = await publishPage.call({ id: page.id, published: true }, OWNER);
    expect(live.status).toBe("published");
  });
});
