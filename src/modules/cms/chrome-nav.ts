// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Menu rows live on nav blocks; chrome looks in the nav section first (C2.11).
import type { BlockNode } from "./blocks/types";
import { HEADER_KEY, NAV_KEY } from "./defaults";

export const NAV_SECTION_KEYS = [NAV_KEY, HEADER_KEY] as const;

export function addNavLink(blocks: BlockNode[], label: string, href: string): boolean {
  for (const node of blocks) {
    if (node.type === "nav") {
      const links = (node.props.links ?? []) as Array<{ label: string; href: string }>;
      if (links.some((link) => link.href === href)) return false;
      node.props.links = [...links, { label, href }];
      return true;
    }
    if (node.children && addNavLink(node.children, label, href)) return true;
  }
  return false;
}

/**
 * Fold menu links into the first nav block of a tree, header links first.
 *
 * Used when the header's own nav moves into the nav section and that section
 * already has links of its own — typically a `/locations` link the platform
 * appended when the first location was created. Discarding the header's
 * menu there is what left a whole site with "Locations" as its only header
 * link; merging keeps every link the owner chose and every one the platform
 * added, once each.
 */
export function mergeNavLinks(
  target: BlockNode[],
  links: Array<{ label: string; href: string }>,
): boolean {
  for (const node of target) {
    if (node.type === "nav") {
      const existing = (node.props.links ?? []) as Array<{ label: string; href: string }>;
      const seen = new Set<string>();
      node.props.links = [...links, ...existing].filter((link) => {
        if (seen.has(link.href)) return false;
        seen.add(link.href);
        return true;
      });
      return true;
    }
    if (node.children && mergeNavLinks(node.children, links)) return true;
  }
  return false;
}

export function navLinks(blocks: BlockNode[]): Array<{ label: string; href: string }> {
  const out: Array<{ label: string; href: string }> = [];
  for (const node of blocks) {
    if (node.type === "nav") out.push(...((node.props.links ?? []) as Array<{ label: string; href: string }>));
    if (node.children) out.push(...navLinks(node.children));
  }
  return out;
}

export function extractNavBlocks(blocks: BlockNode[]): {
  nav: BlockNode[];
  rest: BlockNode[];
} {
  const nav: BlockNode[] = [];
  const rest: BlockNode[] = [];
  for (const node of blocks) {
    if (node.type === "nav") {
      nav.push(node);
      continue;
    }
    if (node.children) {
      const inner = extractNavBlocks(node.children);
      nav.push(...inner.nav);
      rest.push({ ...node, children: inner.rest });
      continue;
    }
    rest.push(node);
  }
  return { nav, rest };
}

export function navHasLinks(blocks: BlockNode[]): boolean {
  for (const node of blocks) {
    if (node.type === "nav") {
      const links = (node.props.links ?? []) as unknown[];
      if (links.length > 0) return true;
    }
    if (node.children && navHasLinks(node.children)) return true;
  }
  return false;
}
