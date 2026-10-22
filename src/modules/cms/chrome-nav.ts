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

type NavLink = { label: string; href: string };

/**
 * Index pages the platform links from the menu on its own (§5's "no orphan
 * pages"): the first location, product and event each add their index.
 * A menu holding only these has never been arranged by a person.
 */
export const PLATFORM_NAV_HREFS = new Set(["/locations", "/products", "/events"]);

/**
 * One spelling per destination, for de-duplication only: no trailing slash,
 * no locale prefix ("/fr-CA/about" and "/about/" are both "/about"). The
 * stored href is never rewritten.
 */
export function normalizeNavHref(href: string): string {
  const path = href.trim().split(/[?#]/)[0] ?? "";
  // Only a locale-shaped first segment: a catalog language (en, fr, es, ar)
  // or a language-region pair. A page that happens to be called /go is not a
  // locale prefix.
  const unprefixed = path.replace(/^\/(?:(?:en|fr|es|ar)(?:-[A-Za-z]{2,4})?|[a-z]{2}-[A-Za-z]{2,4})(?=\/|$)/, "");
  const trimmed = unprefixed.replace(/\/+$/, "");
  return trimmed === "" ? "/" : trimmed.toLowerCase();
}

function firstNav(nodes: BlockNode[]): BlockNode | null {
  for (const node of nodes) {
    if (node.type === "nav") return node;
    const inner = node.children ? firstNav(node.children) : null;
    if (inner) return inner;
  }
  return null;
}

/**
 * Fold a header's menu into the nav section's first nav block.
 *
 * Used when the header's own nav moves into a nav section that already has
 * links. Discarding the header's menu there is what left a whole site with
 * "Locations" as its only link. The nav section's order is the owner's and
 * is kept: header links that are new are appended. The one exception is a
 * nav section holding nothing but links the platform added itself — then the
 * header's menu is the only menu anybody arranged, so it leads, and its
 * presentation (screen-reader name, mobile collapse) comes with it.
 */
export function mergeNavLinks(target: BlockNode[], source: BlockNode[]): boolean {
  const into = firstNav(target);
  if (!into) return false;
  const existing = (into.props.links ?? []) as NavLink[];
  const incoming = navLinks(source);
  const from = firstNav(source);
  const platformOnly = existing.every((link) => PLATFORM_NAV_HREFS.has(normalizeNavHref(link.href)));
  const ordered = platformOnly ? [...incoming, ...existing] : [...existing, ...incoming];
  const seen = new Set<string>();
  into.props.links = ordered.filter((link) => {
    const key = normalizeNavHref(link.href);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  if (platformOnly && from) {
    if (from.props.ariaLabelKey !== undefined) into.props.ariaLabelKey = from.props.ariaLabelKey;
    if (from.props.collapseOnMobile !== undefined) into.props.collapseOnMobile = from.props.collapseOnMobile;
  }
  return true;
}

export function navLinks(blocks: BlockNode[]): NavLink[] {
  const out: NavLink[] = [];
  for (const node of blocks) {
    if (node.type === "nav") out.push(...((node.props.links ?? []) as NavLink[]));
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
