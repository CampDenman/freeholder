// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Per-page accessibility hints (C2.20).
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { analyzeAccessibility, publishA11yMessage } from "@/modules/cms/a11y-hints";
import { createPage, pageAccessibilityReport, publishPage } from "@/modules/cms/service";
import { closeDb, failure, hasDatabase, OWNER, truncateSpine } from "../helpers/spine";
import type { BlockNode } from "@/modules/cms/blocks/types";

const heading = (id: string, text: string, level: 1 | 2 | 3 | 4): BlockNode => ({
  id,
  type: "heading",
  props: { text, level, align: "start" },
});

describe("page accessibility hints", () => {
  it("requires exactly one H1 on a page", () => {
    expect(analyzeAccessibility([]).map((hint) => hint.code)).toContain("missingH1");
    expect(
      analyzeAccessibility([heading("a", "One", 1), heading("b", "Two", 1)]).map(
        (hint) => hint.code,
      ),
    ).toContain("multipleH1");
    expect(analyzeAccessibility([heading("a", "One", 1)]).filter((h) => h.severity === "error")).toEqual(
      [],
    );
  });

  it("warns on heading skips, vague links, missing alt and raw HTML images", () => {
    const hints = analyzeAccessibility([
      heading("h", "Title", 1),
      heading("skip", "Skipped", 3),
      {
        id: "btn",
        type: "button",
        props: { label: "Click here", href: "#", variant: "solid" },
      },
      { id: "img", type: "image", props: { decorative: false } },
      { id: "html", type: "html", props: { markup: "<p><img src='/x.jpg'></p>" } },
    ]);
    const codes = hints.map((hint) => hint.code);
    expect(codes).toEqual(
      expect.arrayContaining([
        "headingOrder",
        "vagueLink",
        "emptyHref",
        "imageMissing",
        "htmlImage",
        "htmlLandmarks",
      ]),
    );
  });

  it("accepts a decorative image without a description", () => {
    const hints = analyzeAccessibility([
      heading("h", "Title", 1),
      {
        id: "img",
        type: "image",
        props: { assetId: "11111111-1111-1111-1111-111111111111", decorative: true },
      },
    ]);
    expect(hints.map((hint) => hint.code)).not.toContain("imageAltUnset");
  });

  it("skips the H1 rule for email and chrome", () => {
    expect(analyzeAccessibility([], { context: "email" })).toEqual([]);
    expect(analyzeAccessibility([], { context: "chrome" })).toEqual([]);
  });
});

describe.runIf(hasDatabase)("publish refuses a page that fails the H1 rule", { timeout: 30_000 }, () => {
  beforeEach(truncateSpine, 30_000);
  afterAll(closeDb);

  it("blocks publish without an H1 and reports the tree", async () => {
    const created = await createPage.call({ slug: "bare", title: "Bare", blocks: [] }, OWNER);
    const blocked = await failure(publishPage.call({ id: created.id, published: true }, OWNER));
    expect(blocked.code).toBe("validation");
    expect(blocked.message).toBe(publishA11yMessage(analyzeAccessibility([])));

    const report = await pageAccessibilityReport.call({ id: created.id }, OWNER);
    expect(report.hints.map((hint) => hint.code)).toContain("missingH1");

    await createPage.call(
      {
        slug: "ready",
        title: "Ready",
        blocks: [heading("h", "Ready", 1)],
      },
      OWNER,
    ).then(async (page) => {
      const live = await publishPage.call({ id: page.id, published: true }, OWNER);
      expect(live.status).toBe("published");
    });
  });
});
