// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Server-side experiment assignment (C2.17).
import { describe, expect, it } from "vitest";
import {
  assignVariant,
  assignmentsFor,
  bucket,
  collectExperiments,
  experimentCacheKey,
  selectAssignedVariants,
} from "@/modules/cms/experiments";
import { parseBlockTree } from "@/modules/cms/blocks/registry";
import type { BlockNode } from "@/modules/cms/blocks/types";

const tree: BlockNode[] = [
  {
    id: "exp",
    type: "experiment",
    props: { experimentKey: "hero" },
    children: [
      {
        id: "a",
        type: "variant",
        props: { name: "control", weight: 50 },
        children: [{ id: "h1", type: "heading", props: { text: "Control", level: 1 } }],
      },
      {
        id: "b",
        type: "variant",
        props: { name: "treatment", weight: 50 },
        children: [{ id: "h2", type: "heading", props: { text: "Treatment", level: 1 } }],
      },
    ],
  },
];

describe("experiment assignment", () => {
  it("is sticky for one visitor and deterministic", () => {
    const first = assignVariant(
      "hero",
      [
        { name: "control", weight: 50 },
        { name: "treatment", weight: 50 },
      ],
      "visitor-1",
    );
    const second = assignVariant(
      "hero",
      [
        { name: "control", weight: 50 },
        { name: "treatment", weight: 50 },
      ],
      "visitor-1",
    );
    expect(first).toBe(second);
    expect(bucket("visitor-1", "hero", 100)).toBe(bucket("visitor-1", "hero", 100));
  });

  it("gives crawlers the control", () => {
    expect(
      assignVariant(
        "hero",
        [
          { name: "control", weight: 1 },
          { name: "treatment", weight: 99 },
        ],
        null,
      ),
    ).toBe("control");
  });

  it("collects experiments and builds a cache key", () => {
    const collected = collectExperiments(parseBlockTree(tree, "page"));
    expect(collected).toEqual([
      {
        key: "hero",
        variants: [
          { name: "control", weight: 50 },
          { name: "treatment", weight: 50 },
        ],
      },
    ]);
    const assigned = assignmentsFor(parseBlockTree(tree, "page"), "visitor-9");
    expect(experimentCacheKey(assigned)).toMatch(/^hero=/);
  });

  it("keeps only the assigned variant on the public surface", () => {
    const parsed = parseBlockTree(tree, "page");
    const publicChildren = selectAssignedVariants(
      "hero",
      parsed[0]!.children!,
      { hero: "treatment" },
      "visitor-1",
      false,
    );
    expect(publicChildren).toHaveLength(1);
    expect(publicChildren[0]?.props.name).toBe("treatment");

    const editorChildren = selectAssignedVariants(
      "hero",
      parsed[0]!.children!,
      { hero: "treatment" },
      "visitor-1",
      true,
    );
    expect(editorChildren).toHaveLength(2);
  });
});
