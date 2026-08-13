// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Moving blocks (MASTER.md §32).
//
// Tree surgery is obviously correct right up until somebody drops a container
// into its own child, so the refusals matter more here than the successes.
import { describe, expect, it } from "vitest";
import { moveBlock } from "@/modules/cms/blocks/move";
import type { BlockNode } from "@/modules/cms/blocks/types";

const leaf = (id: string): BlockNode => ({ id, type: "heading", props: {} });
const box = (id: string, children: BlockNode[]): BlockNode => ({
  id,
  type: "columns",
  props: {},
  children,
});

/** Ids in document order, so an assertion reads like the page does. */
function order(nodes: BlockNode[]): string[] {
  return nodes.flatMap((node) =>
    node.children ? [node.id, ...order(node.children)] : [node.id],
  );
}

describe("moveBlock()", () => {
  it("reorders within one level", () => {
    const tree = [leaf("a"), leaf("b"), leaf("c")];
    expect(order(moveBlock(tree, "c", "a", "before")!)).toEqual(["c", "a", "b"]);
    expect(order(moveBlock(tree, "a", "c", "after")!)).toEqual(["b", "c", "a"]);
  });

  it("moves a block into a container by dropping beside its children", () => {
    const tree = [box("row", [leaf("x")]), leaf("loose")];
    const moved = moveBlock(tree, "loose", "x", "after")!;
    expect(order(moved)).toEqual(["row", "x", "loose"]);
    expect(moved).toHaveLength(1);
  });

  it("moves a block out of a container", () => {
    const tree = [box("row", [leaf("x"), leaf("y")]), leaf("tail")];
    const moved = moveBlock(tree, "y", "tail", "after")!;
    expect(order(moved)).toEqual(["row", "x", "tail", "y"]);
    expect(moved[0]!.children).toHaveLength(1);
  });

  it("drops into an empty container", () => {
    const tree = [box("row", []), leaf("a")];
    const moved = moveBlock(tree, "a", "row", "inside")!;
    expect(order(moved)).toEqual(["row", "a"]);
    expect(moved[0]!.children).toHaveLength(1);
  });

  it("refuses to put a container inside its own subtree", () => {
    // The move that would detach the whole branch and lose it — the reason
    // this is a function with tests rather than a splice in a component.
    const tree = [box("outer", [box("inner", [leaf("deep")])])];
    expect(moveBlock(tree, "outer", "inner", "after")).toBeUndefined();
    expect(moveBlock(tree, "outer", "deep", "before")).toBeUndefined();
    expect(moveBlock(tree, "outer", "inner", "inside")).toBeUndefined();
  });

  it("refuses a no-op and an unknown id", () => {
    const tree = [leaf("a"), leaf("b")];
    expect(moveBlock(tree, "a", "a", "before")).toBeUndefined();
    expect(moveBlock(tree, "a", "ghost", "after")).toBeUndefined();
    expect(moveBlock(tree, "ghost", "a", "after")).toBeUndefined();
  });

  it("refuses to drop inside a block that holds nothing", () => {
    const tree = [leaf("a"), leaf("b")];
    expect(moveBlock(tree, "a", "b", "inside")).toBeUndefined();
  });

  it("keeps every block that was there", () => {
    // A move must never lose or duplicate a node, whatever the shape.
    const tree = [
      box("row", [leaf("x"), leaf("y")]),
      leaf("a"),
      box("row2", [leaf("z")]),
    ];
    const before = order(tree).sort();
    for (const [drag, target, position] of [
      ["x", "a", "after"],
      ["a", "z", "before"],
      ["row2", "x", "before"],
      ["z", "row", "inside"],
    ] as const) {
      const moved = moveBlock(tree, drag, target, position);
      expect(moved, `${drag} → ${position} ${target}`).toBeDefined();
      expect(order(moved!).sort()).toEqual(before);
    }
  });

  it("does not mutate the tree it was given", () => {
    const tree = [leaf("a"), leaf("b")];
    const snapshot = JSON.stringify(tree);
    moveBlock(tree, "a", "b", "after");
    expect(JSON.stringify(tree)).toBe(snapshot);
  });
});
