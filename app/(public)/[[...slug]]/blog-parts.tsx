// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// The blog's share of the public route (C2.27, C2.28): archive pages for a
// category, tag or author, and the byline a post carries.
//
// An archive is not a stored page, so it is rendered from a block tree built
// here — a heading, the description, and the same `blogIndex` block the blog
// page uses, filtered — which keeps one listing implementation and lets the
// archive inherit everything that block already does (pagination, locale
// links, dates).
import type { BlockNode } from "@/modules/cms/blocks/types";
import type { Translate } from "@/core/i18n";

export type BlogArchive = {
  kind: "category" | "tag" | "author";
  id: string;
  slug: string;
  path: string;
  name: string;
  description: string | null;
  seo: { title?: string; description?: string; noindex?: boolean };
  trail: Array<{ name: string; path: string }>;
  posts: number;
};

export type PostMeta = {
  pageId: string;
  author: { name: string; path: string; bio: string | null } | null;
  categories: Array<{ name: string; path: string }>;
  tags: Array<{ name: string; path: string }>;
  commentsEnabled: boolean;
  publishedAt: Date | null;
  modifiedAt: Date | null;
};

export function archiveBlocks(archive: BlogArchive, postsPerPage: number): BlockNode[] {
  return [
    { id: "archive-heading", type: "heading", props: { text: archive.name, level: 1, align: "start" } },
    ...(archive.description
      ? [{ id: "archive-description", type: "text", props: { body: archive.description } }]
      : []),
    {
      id: "archive-posts",
      type: "blogIndex",
      props: {
        prefix: "blog",
        limit: postsPerPage,
        ...(archive.kind === "category" ? { category: archive.slug } : {}),
        ...(archive.kind === "tag" ? { tag: archive.slug } : {}),
        ...(archive.kind === "author" ? { author: archive.slug } : {}),
      },
    },
  ];
}

export function archiveEyebrow(archive: BlogArchive, t: Translate): string {
  return t(`blog.archive.${archive.kind}`);
}

/** Byline under a post's title: author, dates, categories. */
export function PostByline({
  meta,
  t,
  locale,
  href,
}: {
  meta: PostMeta;
  t: Translate;
  locale: string;
  href: (path: string) => string;
}) {
  const format = (date: Date) => new Intl.DateTimeFormat(locale, { dateStyle: "long" }).format(date);
  const updated =
    meta.modifiedAt && meta.publishedAt && meta.modifiedAt.getTime() - meta.publishedAt.getTime() > 24 * 60 * 60 * 1000
      ? meta.modifiedAt
      : null;
  return (
    <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-ink-muted">
      {meta.author ? (
        <span>
          {t("blog.by")}{" "}
          <a className="font-medium text-ink underline underline-offset-4" href={href(`/${meta.author.path}`)} rel="author">
            {meta.author.name}
          </a>
        </span>
      ) : null}
      {meta.publishedAt ? (
        <span>
          <time dateTime={meta.publishedAt.toISOString()}>{format(meta.publishedAt)}</time>
        </span>
      ) : null}
      {updated ? (
        <span>
          {t("blog.updated")} <time dateTime={updated.toISOString()}>{format(updated)}</time>
        </span>
      ) : null}
      {meta.categories.length ? (
        <span className="flex flex-wrap gap-x-2">
          {meta.categories.map((category) => (
            <a key={category.path} className="underline underline-offset-4" href={href(`/${category.path}`)}>
              {category.name}
            </a>
          ))}
        </span>
      ) : null}
    </p>
  );
}

/** Tags and the author's note, after the post. */
export function PostFooter({
  meta,
  t,
  href,
}: {
  meta: PostMeta;
  t: Translate;
  href: (path: string) => string;
}) {
  if (!meta.tags.length && !meta.author?.bio) return null;
  return (
    <footer className="grid gap-4 border-t border-rule pt-6">
      {meta.tags.length ? (
        <nav aria-label={t("blog.tags")}>
          <ul className="flex list-none flex-wrap gap-2 p-0">
            {meta.tags.map((tag) => (
              <li key={tag.path}>
                <a
                  className="inline-flex rounded-full border border-rule px-3 py-1 text-sm text-ink underline-offset-4 hover:underline"
                  href={href(`/${tag.path}`)}
                  rel="tag"
                >
                  {tag.name}
                </a>
              </li>
            ))}
          </ul>
        </nav>
      ) : null}
      {meta.author?.bio ? (
        <section aria-label={t("blog.aboutAuthor")} className="grid gap-1 text-sm">
          <p className="font-semibold text-ink">
            <a className="underline underline-offset-4" href={href(`/${meta.author.path}`)}>
              {meta.author.name}
            </a>
          </p>
          <p className="max-w-prose text-ink-muted">{meta.author.bio}</p>
        </section>
      ) : null}
    </footer>
  );
}
