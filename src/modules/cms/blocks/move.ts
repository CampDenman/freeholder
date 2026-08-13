// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Moving a block within a tree (MASTER.md §32).
//
// Kept here, pure and framework-free, rather than inside the editor component
// — this is tree surgery, and tree surgery is the kind of thing that is
// obviously correct right up until somebody drops a container into its own
// child. It is testable in isolation because it has no idea a canvas exists.
//
// The canvas reports an *intent* ("put A after B"); this decides whether that
// intent is legal and what the tree looks like afterwards. The editor holds
// the result. Nothing here touches the DOM.
import type { BlockNode } from "./types";

export type DropPosition = "before" | "after" | "inside";

/** Every id in a subtree, including the root's own. */
function idsWithin(node: BlockNode): Set<string> {
  const ids = new Set<string>([node.id]);
  const walk = (nodes: BlockNode[]) => {
    for (const child of nodes) {
      ids.add(child.id);
      if (child.children) walk(child.children);
    }
  };
  if (node.children) walk(node.children);
  return ids;
}

/** Find a node anywhere in the tree. */
function find(nodes: BlockNode[], id: string): BlockNode | undefined {
  for (const node of nodes) {
    if (node.id === id) return node;
    if (node.children) {
      const hit = find(node.children, id);
      if (hit) return hit;
    }
  }
  return undefined;
}

/** The tree with one node taken out of it, wherever it was. */
function without(nodes: BlockNode[], id: string): BlockNode[] {
  const result: BlockNode[] = [];
  for (const node of nodes) {
    if (node.id === id) continue;
    result.push(
      node.children ? { ...node, children: without(node.children, id) } : node,
    );
  }
  return result;
}

/** The tree with `moving` inserted relative to `targetId`. */
function insert(
  nodes: BlockNode[],
  targetId: string,
  position: DropPosition,
  moving: BlockNode,
): BlockNode[] {
  const result: BlockNode[] = [];
  for (const node of nodes) {
    if (node.id === targetId && position === "before") result.push(moving);

    if (node.id === targetId && position === "inside") {
      // Only containers have a children array at all, so this cannot
      // accidentally give a leaf block children it has no renderer for.
      result.push({ ...node, children: [...(node.children ?? []), moving] });
    } else if (node.children) {
      result.push({
        ...node,
        children: insert(node.children, targetId, position, moving),
      });
    } else {
      result.push(node);
    }

    if (node.id === targetId && position === "after") result.push(moving);
  }
  return result;
}

/**
 * Move a block, or refuse.
 *
 * Returns `undefined` when the move makes no sense, and the caller leaves the
 * tree alone. Three ways it can:
 *
 * - the block or its target is not in the tree;
 * - a block is dropped onto itself, which is a no-op dressed as a change;
 * - **a container is dropped inside its own subtree** — the move that would
 *   detach that whole branch from the document and lose it. This is the reason
 *   this function exists rather than a splice in a component.
 */
export function moveBlock(
  nodes: BlockNode[],
  dragId: string,
  targetId: string,
  position: DropPosition,
): BlockNode[] | undefined {
  if (dragId === targetId) return undefined;

  const moving = find(nodes, dragId);
  const target = find(nodes, targetId);
  if (!moving || !target) return undefined;

  if (idsWithin(moving).has(targetId)) return undefined;
  if (position === "inside" && !moving.children && !target.children) {
    // Dropping into something that holds nothing.
    return undefined;
  }
  if (position === "inside" && !target.children) return undefined;

  return insert(without(nodes, dragId), targetId, position, moving);
}
