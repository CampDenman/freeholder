// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Request-scoped reads of published content.
//
// The public route resolves the same page twice on every request — once in
// `generateMetadata` to build the title, canonical and Open Graph tags, and
// once in the component to render it. Both are right to ask; Next runs them as
// separate functions precisely so metadata can stream ahead of the body.
//
// So the deduplication belongs here rather than in either caller. See
// core/settings/read.ts for the same argument at more length.
import { cache } from "react";
import { getSection, resolvePageForRender } from "./service";

const ANONYMOUS = { kind: "anonymous" } as const;

/** A published page by path, fetched at most once per request per path. */
export const publishedPage = cache((slug: string, locale: string) =>
  // Server-only entry: no HTTP, MCP or API key can request the raw gated tree.
  // renderBlocks still evaluates every gate against the actual viewer.
  resolvePageForRender.call({ slug, locale }, { kind: "system" }),
);

/** Site chrome (header, footer) by key, fetched at most once per request. */
export const publishedSection = cache((key: string, locale: string) =>
  getSection.call({ key, locale }, ANONYMOUS),
);

/** A blog category, tag or author archive at a path, once per request. */
export const blogArchiveAt = cache(async (path: string) => {
  const { resolveBlogArchive } = await import("./blog-service");
  return resolveBlogArchive.call({ path }, ANONYMOUS);
});

/** A published post's byline and terms, once per request. */
export const postMetaFor = cache(async (slug: string) => {
  const { postMetaAt } = await import("./blog-service");
  return postMetaAt.call({ slug }, ANONYMOUS);
});

/** The blog's archive settings, once per request. */
export const blogSettingsCached = cache(async () => {
  const { getBlogSettings } = await import("./blog-service");
  return getBlogSettings.call({}, ANONYMOUS);
});
