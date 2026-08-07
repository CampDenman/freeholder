// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: AGPL-3.0-only
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
import { getSection, resolvePage } from "./service";

const ANONYMOUS = { kind: "anonymous" } as const;

/** A published page by path, fetched at most once per request per path. */
export const publishedPage = cache((slug: string, locale: string) =>
  resolvePage.call({ slug, locale }, ANONYMOUS),
);

/** Site chrome (header, footer) by key, fetched at most once per request. */
export const publishedSection = cache((key: string, locale: string) =>
  getSection.call({ key, locale }, ANONYMOUS),
);
