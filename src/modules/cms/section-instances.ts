// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Synced Section instances (C2.12).
//
// A reusable Section is a row. A page that uses it stores a `sectionInstance`
// node, not a copy of the tree. Detach replaces that node with a clone so the
// page can diverge. Deletion has to see every instance first.
import type { BlockNode } from "./blocks/types";

export const SECTION_INSTANCE_TYPE = "sectionInstance";

export function sectionKeyOf(node: BlockNode): string | null {
  if (node.type !== SECTION_INSTANCE_TYPE) return null;
  const key = node.props.sectionKey;
  return typeof key === "string" && key.trim() ? key : null;
}

export function collectSectionKeysFromUnknown(
  input: unknown,
  into = new Set<string>(),
): Set<string> {
  if (!Array.isArray(input)) return into;
  for (const item of input) {
    if (!item || typeof item !== "object") continue;
    const node = item as { type?: unknown; props?: unknown; children?: unknown };
    if (node.type === SECTION_INSTANCE_TYPE && node.props && typeof node.props === "object") {
      const key = (node.props as { sectionKey?: unknown }).sectionKey;
      if (typeof key === "string" && key.trim()) into.add(key);
    }
    collectSectionKeysFromUnknown(node.children, into);
  }
  return into;
}

export function collectSectionKeys(nodes: BlockNode[], into = new Set<string>()): Set<string> {
  for (const node of nodes) {
    const key = sectionKeyOf(node);
    if (key) into.add(key);
    if (node.children) collectSectionKeys(node.children, into);
  }
  return into;
}

export function replaceNodes(
  nodes: BlockNode[],
  ids: ReadonlySet<string>,
  replacement: BlockNode[],
): BlockNode[] {
  const result: BlockNode[] = [];
  let consumed = false;
  for (const node of nodes) {
    if (ids.has(node.id)) {
      if (!consumed) {
        result.push(...replacement);
        consumed = true;
      }
      continue;
    }
    result.push(
      node.children
        ? { ...node, children: replaceNodes(node.children, ids, replacement) }
        : node,
    );
  }
  return result;
}

export function cloneTree(nodes: BlockNode[], suffix: string): BlockNode[] {
  return nodes.map((node) => ({
    ...node,
    id: `${node.id}-${suffix}`,
    props: structuredClone(node.props),
    children: node.children ? cloneTree(node.children, suffix) : undefined,
  }));
}

export function findNode(nodes: BlockNode[], id: string): BlockNode | null {
  for (const node of nodes) {
    if (node.id === id) return node;
    if (node.children) {
      const found = findNode(node.children, id);
      if (found) return found;
    }
  }
  return null;
}

export function slugifySectionName(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return slug || "section";
}
