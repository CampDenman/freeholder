// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Plain text from a block tree, for the retrieval index (C9.22).
//
// The body of a page is a typed tree, not a column. Copying it into a second
// string that has to be kept in sync would be a shadow store. Walking the
// tree at index time cannot go stale, and at help-centre scale it is cheap.

const SKIP = new Set(["href", "src", "id", "code", "assetId", "url"]);

export function textFromBlocks(blocks: unknown): string {
  const parts: string[] = [];
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) {
      for (const each of node) walk(each);
      return;
    }
    if (!node || typeof node !== "object") return;
    const bag = node as Record<string, unknown>;
    if (bag.props && typeof bag.props === "object") {
      for (const [key, value] of Object.entries(bag.props as Record<string, unknown>)) {
        if (SKIP.has(key)) continue;
        if (typeof value === "string") {
          const trimmed = value.trim();
          if (trimmed) parts.push(trimmed);
        } else {
          walk(value);
        }
      }
    }
    if (Array.isArray(bag.children)) walk(bag.children);
    if (Array.isArray(bag.blocks)) walk(bag.blocks);
  };
  walk(blocks);
  return parts.join("\n");
}

export function clip(text: string, max = 4_000): string {
  const trimmed = text.replace(/\s+/g, " ").trim();
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max - 1).trimEnd()}…`;
}
