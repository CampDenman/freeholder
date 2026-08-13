// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// The block registry (MASTER.md §32).
//
// These run without a database, because the property under test is the one
// that makes jsonb safe: a stored tree is only ever a tree the registry
// accepted. If validation is wrong, the database is full of shapes the
// renderer cannot draw, and the failure surfaces on a visitor's screen rather
// than at the write that caused it.
import { describe, expect, it } from "vitest";
import {
  BlockValidationError,
  blockTypes,
  collectJsonLd,
  getBlock,
  paletteFor,
  parseBlockTree,
} from "@/modules/cms/blocks/registry";
import { t } from "@/core/i18n";

describe("the registry", () => {
  it("registers the v1 vocabulary", () => {
    expect(blockTypes()).toEqual(
      expect.arrayContaining(["heading", "text", "button", "columns", "faq", "nav", "brand"]),
    );
  });

  it("names every block in the default catalog", () => {
    // The palette is generated from the registry, so a block added without a
    // catalog entry would render its own key as a label in the editor.
    for (const type of blockTypes()) {
      const key = getBlock(type)!.labelKey;
      expect(t("en", key), `${type} has no catalog entry`).not.toBe(key);
    }
  });

  it("offers each context only the blocks that belong in it", () => {
    const chrome = paletteFor("chrome").map((b) => b.type);
    const page = paletteFor("page").map((b) => b.type);
    expect(chrome).toContain("nav");
    expect(chrome).not.toContain("faq");
    expect(page).toContain("faq");
    expect(page).not.toContain("nav");
  });
});

describe("parseBlockTree()", () => {
  it("applies schema defaults, so an older tree reads with new props", () => {
    // Adding an optional prop to a block must not be a data migration. The
    // stored node predates `align`; parsing supplies it.
    const [node] = parseBlockTree(
      [{ id: "a", type: "heading", props: { text: "Hello" } }],
      "page",
    );
    expect(node!.props).toMatchObject({ text: "Hello", level: 2, align: "start" });
  });

  it("refuses an unknown block type rather than dropping it", () => {
    // Dropping would be worse than failing: the next save writes the tree back
    // without the node, so disabling a plugin would permanently delete the
    // sections it drew.
    expect(() =>
      parseBlockTree([{ id: "a", type: "gift-registry", props: {} }], "page"),
    ).toThrow(BlockValidationError);
    expect(() =>
      parseBlockTree([{ id: "a", type: "gift-registry", props: {} }], "page"),
    ).toThrow(/not installed/);
  });

  it("refuses a block used in the wrong context", () => {
    expect(() => parseBlockTree([{ id: "a", type: "nav", props: {} }], "page")).toThrow(
      /cannot be used in page/,
    );
  });

  it("refuses props that do not satisfy the block's schema", () => {
    expect(() =>
      parseBlockTree([{ id: "a", type: "heading", props: { text: "" } }], "page"),
    ).toThrow(BlockValidationError);
    expect(() =>
      parseBlockTree([{ id: "a", type: "button", props: { label: "Go" } }], "page"),
    ).toThrow(/href/);
  });

  it("refuses children on a block that does not hold them", () => {
    expect(() =>
      parseBlockTree(
        [{ id: "a", type: "divider", props: {}, children: [] }],
        "page",
      ),
    ).toThrow(/does not hold other blocks/);
  });

  it("validates children of containers, to any depth", () => {
    const tree = parseBlockTree(
      [
        {
          id: "row",
          type: "columns",
          props: {},
          children: [
            { id: "h", type: "heading", props: { text: "Left" } },
            {
              id: "inner",
              type: "columns",
              props: { count: 3 },
              children: [{ id: "t", type: "text", props: { body: "Deep" } }],
            },
          ],
        },
      ],
      "page",
    );
    expect(tree[0]!.children).toHaveLength(2);
    expect(tree[0]!.children![1]!.children![0]!.props).toMatchObject({ body: "Deep" });

    expect(() =>
      parseBlockTree(
        [
          {
            id: "row",
            type: "columns",
            props: {},
            children: [{ id: "bad", type: "heading", props: { text: "" } }],
          },
        ],
        "page",
      ),
    ).toThrow(/children\[0\]/);
  });

  it("names the offending node, so an error is actionable", () => {
    expect(() =>
      parseBlockTree(
        [
          { id: "ok", type: "divider", props: {} },
          { id: "bad", type: "heading", props: {} },
        ],
        "page",
      ),
    ).toThrow(/blocks\[1\] \(heading\)/);
  });

  it("rejects anything that is not an array of blocks", () => {
    expect(() => parseBlockTree({ type: "heading" }, "page")).toThrow(/expected an array/);
    expect(() => parseBlockTree(["not a block"], "page")).toThrow(/expected a block object/);
  });
});

describe("collectJsonLd()", () => {
  it("gathers structured data from the blocks that emit it", () => {
    // §5: an FAQ block on the page is what puts FAQPage in the markup, so the
    // SEO layer never has to infer what the content means.
    const tree = parseBlockTree(
      [
        { id: "h", type: "heading", props: { text: "Questions" } },
        {
          id: "f",
          type: "faq",
          props: {
            items: [{ question: "Do you travel?", answer: "Yes, anywhere on the coast." }],
          },
        },
      ],
      "page",
    );
    const found = collectJsonLd(tree);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({
      "@type": "FAQPage",
      mainEntity: [{ "@type": "Question", name: "Do you travel?" }],
    });
  });

  it("finds emitters nested inside containers", () => {
    const tree = parseBlockTree(
      [
        {
          id: "row",
          type: "columns",
          props: {},
          children: [
            { id: "f", type: "faq", props: { items: [{ question: "Q", answer: "A" }] } },
          ],
        },
      ],
      "page",
    );
    expect(collectJsonLd(tree)).toHaveLength(1);
  });

  it("returns nothing for a page with no structured content", () => {
    const tree = parseBlockTree([{ id: "d", type: "divider", props: {} }], "page");
    expect(collectJsonLd(tree)).toEqual([]);
  });
});
