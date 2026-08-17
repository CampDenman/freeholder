// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Pure editor operations (MASTER.md C2.06).
//
// Kept out of the React tree so undo, duplicate, clipboard and slash filter
// can be tested without a canvas. The component holds state; this decides
// what the next tree is.
import type { BlockNode } from "./types";

export const CLIPBOARD_KIND = "freeholder/blocks";

export interface BlockClipboard {
  kind: typeof CLIPBOARD_KIND;
  nodes: BlockNode[];
}

export function filterPalette<T extends { type: string; label: string }>(
  entries: T[],
  query: string,
): T[] {
  const needle = query.trim().toLowerCase().replace(/^\//, "");
  if (!needle) return entries;
  return entries.filter(
    (entry) =>
      entry.type.toLowerCase().includes(needle) ||
      entry.label.toLowerCase().includes(needle),
  );
}

function cloneNode(node: BlockNode, suffix: string): BlockNode {
  return {
    ...node,
    id: `${node.id}-${suffix}`,
    props: structuredClone(node.props),
    children: node.children?.map((child) => cloneNode(child, suffix)),
  };
}

export function duplicateNodes(nodes: BlockNode[], ids: ReadonlySet<string>): BlockNode[] {
  const result: BlockNode[] = [];
  const stamp = Math.random().toString(36).slice(2, 7);
  for (const node of nodes) {
    const children = node.children ? duplicateNodes(node.children, ids) : undefined;
    const copy = children ? { ...node, children } : node;
    result.push(copy);
    if (ids.has(node.id)) result.push(cloneNode(copy, stamp));
  }
  return result;
}

export function removeNodes(nodes: BlockNode[], ids: ReadonlySet<string>): BlockNode[] {
  const result: BlockNode[] = [];
  for (const node of nodes) {
    if (ids.has(node.id)) continue;
    result.push(
      node.children ? { ...node, children: removeNodes(node.children, ids) } : node,
    );
  }
  return result;
}

export function moveSiblings(
  nodes: BlockNode[],
  ids: ReadonlySet<string>,
  direction: -1 | 1,
): BlockNode[] {
  const selected = nodes
    .map((node, index) => ({ node, index }))
    .filter(({ node }) => ids.has(node.id));
  if (selected.length === 0) {
    return nodes.map((node) =>
      node.children
        ? { ...node, children: moveSiblings(node.children, ids, direction) }
        : node,
    );
  }
  const next = [...nodes];
  const ordered = direction === 1 ? [...selected].reverse() : selected;
  for (const { index } of ordered) {
    const target = index + direction;
    if (target < 0 || target >= next.length) continue;
    if (ids.has(next[target]!.id)) continue;
    const [moved] = next.splice(index, 1);
    next.splice(target, 0, moved!);
  }
  return next;
}

export function insertAfter(
  nodes: BlockNode[],
  afterId: string | undefined,
  incoming: BlockNode[],
): BlockNode[] {
  if (!afterId) return [...nodes, ...incoming];
  const result: BlockNode[] = [];
  let placed = false;
  for (const node of nodes) {
    const withChildren = node.children
      ? { ...node, children: insertAfter(node.children, afterId, incoming) }
      : node;
    result.push(withChildren);
    if (node.id === afterId) {
      result.push(...incoming);
      placed = true;
    }
  }
  return placed || result.some((node, i) => node !== nodes[i]) ? result : [...nodes, ...incoming];
}

export function readClipboard(raw: string): BlockNode[] | undefined {
  try {
    const parsed = JSON.parse(raw) as BlockClipboard;
    if (parsed.kind !== CLIPBOARD_KIND || !Array.isArray(parsed.nodes)) return undefined;
    return parsed.nodes;
  } catch {
    return undefined;
  }
}

export function writeClipboard(nodes: BlockNode[]): string {
  return JSON.stringify({ kind: CLIPBOARD_KIND, nodes } satisfies BlockClipboard);
}

export function collectById(nodes: BlockNode[], ids: ReadonlySet<string>): BlockNode[] {
  const found: BlockNode[] = [];
  for (const node of nodes) {
    if (ids.has(node.id)) found.push(node);
    if (node.children) found.push(...collectById(node.children, ids));
  }
  return found;
}

export class EditorHistory {
  private past: BlockNode[][] = [];
  private future: BlockNode[][] = [];

  constructor(private readonly limit = 50) {}

  push(current: BlockNode[]): void {
    this.past.push(structuredClone(current));
    if (this.past.length > this.limit) this.past.shift();
    this.future = [];
  }

  undo(current: BlockNode[]): BlockNode[] | undefined {
    const previous = this.past.pop();
    if (!previous) return undefined;
    this.future.push(structuredClone(current));
    return previous;
  }

  redo(current: BlockNode[]): BlockNode[] | undefined {
    const next = this.future.pop();
    if (!next) return undefined;
    this.past.push(structuredClone(current));
    return next;
  }
}
