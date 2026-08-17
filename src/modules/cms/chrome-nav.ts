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
