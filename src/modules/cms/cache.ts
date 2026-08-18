// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Draft vs published cache invalidation (C2.22).
//
// A working-draft save must not evict the public page. Publish, unpublish
// and chrome edits do. Experiment assignment is part of the cache key so a
// later edge cache can Vary without a client-side swap.
import { experimentCacheKey } from "./experiments";

export type CacheKind = "draft" | "published" | "chrome" | "adminOnly";

export interface InvalidationTarget {
  path: string;
  type?: "page" | "layout";
}

export function publicPathForSlug(slug: string): string {
  return slug === "" ? "/" : `/${slug}`;
}

export function invalidationPlan(input: {
  kind: CacheKind;
  pageId?: string;
  slug?: string;
}): InvalidationTarget[] {
  if (input.kind === "draft") {
    const targets: InvalidationTarget[] = [];
    if (input.pageId) {
      targets.push({ path: `/admin/pages/${input.pageId}` });
      targets.push({ path: `/preview/page/${input.pageId}` });
    }
    return targets;
  }
  if (input.kind === "adminOnly") {
    return input.pageId ? [{ path: `/admin/pages/${input.pageId}` }] : [];
  }
  if (input.kind === "chrome") {
    return [{ path: "/", type: "layout" }];
  }
  const targets: InvalidationTarget[] = [{ path: "/", type: "layout" }];
  if (input.slug !== undefined) {
    targets.unshift({ path: publicPathForSlug(input.slug), type: "page" });
  }
  return targets;
}

export function pageCacheVary(assignments: Readonly<Record<string, string>>): string {
  return experimentCacheKey(assignments);
}
