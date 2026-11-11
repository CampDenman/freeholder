// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// One flat editable list, with bounded semantic parentage (C2.11/C3.22).
export const MAX_NAV_DEPTH = 4;
export type NavigationLink = { label: string; href: string; depth?: number; id?: string };
export type NavigationNode = { link: Omit<NavigationLink, "depth">; children: NavigationNode[] };

export function navigationTree(links: readonly NavigationLink[]): NavigationNode[] {
  const roots: NavigationNode[] = [];
  const ancestors: NavigationNode[] = [];
  for (const { depth: requested = 0, ...link } of links) {
    const depth = Math.min(Number.isInteger(requested) ? Math.max(0, requested) : 0, MAX_NAV_DEPTH, ancestors.length);
    const node: NavigationNode = { link, children: [] };
    if (depth > 0) ancestors[depth - 1]!.children.push(node);
    else roots.push(node);
    ancestors[depth] = node;
    ancestors.length = depth + 1;
  }
  return roots;
}

export function flattenNavigation(nodes: readonly NavigationNode[], depth = 0): NavigationLink[] {
  return nodes.flatMap(node => [{ ...node.link, ...(depth ? { depth } : {}) }, ...flattenNavigation(node.children, depth + 1)]);
}

/** Keep the owner's labels/order; merge only siblings, so parents never drift. */
export function mergeNavigation(existing: readonly NavigationLink[], incoming: readonly NavigationLink[], key: (link: NavigationLink) => string = link => link.href): { links: NavigationLink[]; added: NavigationLink[] } {
  const roots = navigationTree(existing);
  const fresh = new Set<NavigationNode>();
  const mark = (node: NavigationNode) => { fresh.add(node); node.children.forEach(mark); };
  const merge = (target: NavigationNode[], source: NavigationNode[]) => {
    for (const node of source) {
      const matching = target.find(candidate => key(candidate.link) === key(node.link));
      if (matching) merge(matching.children, node.children);
      else { target.push(node); mark(node); }
    }
  };
  merge(roots, navigationTree(incoming));
  const added: NavigationLink[] = [];
  const collect = (nodes: NavigationNode[], depth: number) => {
    for (const node of nodes) {
      if (fresh.has(node)) added.push({ ...node.link, ...(depth ? { depth } : {}) });
      collect(node.children, depth + 1);
    }
  };
  collect(roots, 0);
  return { links: flattenNavigation(roots), added };
}

/** Owner-added descendants survive rollback, promoted under the nearest survivor. */
export function removeNavigation(links: readonly NavigationLink[], owned: readonly NavigationLink[]): NavigationLink[] {
  const remove = (nodes: NavigationNode[]): NavigationNode[] => nodes.flatMap(node => {
    const children = remove(node.children);
    const isOwned = owned.some(link => link.id ? link.id === node.link.id : !node.link.id && link.label === node.link.label && link.href === node.link.href);
    return isOwned ? children : [{ ...node, children }];
  });
  return flattenNavigation(remove(navigationTree(links)));
}
