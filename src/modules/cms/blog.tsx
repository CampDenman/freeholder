// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C2.26: posts are ordinary CMS pages; discovery shares their publish vetoes.
// C2.27/C2.28: a post is a page under `blog/`, or any page marked a post (an
// imported WordPress post keeps its own address). The listing filters by
// category (with its subcategories), tag and author, and shows each post's
// byline, date and categories.
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { pages } from "./schema";
import { blogAuthors, blogPostTerms, blogPosts, blogTerms } from "./blog-schema";
import { z } from "zod";
import { defineService } from "@/core/service";
import { defineBlock, firstQueryValue } from "./blocks/types";

const filterValue = z.string().trim().max(200).regex(/^[a-z0-9-]+$|^[0-9a-f-]{36}$/).optional();

const link = z.object({ name: z.string(), path: z.string() });

export const listBlogPosts = defineService({
  name: "cms.listBlogPosts",
  summary:
    "Published blog posts in one locale, newest first, without private bodies. Filter by category (including subcategories), tag or author slug.",
  kind: "query",
  permission: "public",
  input: z.object({
    locale: z.string().default("en"),
    prefix: z.string().regex(/^[a-z0-9][a-z0-9/-]*$/).default("blog"),
    page: z.number().int().min(1).max(10000).default(1),
    limit: z.number().int().min(1).max(50).default(12),
    category: filterValue,
    tag: filterValue,
    author: filterValue,
  }),
  output: z.object({
    total: z.number().int(),
    page: z.number().int(),
    pages: z.number().int(),
    posts: z.array(
      z.object({
        slug: z.string(),
        title: z.string(),
        description: z.string().nullable(),
        updatedAt: z.date(),
        author: link.nullable(),
        categories: z.array(link),
      }),
    ),
  }),
  handler: async (input, ctx) => {
    const { publishedPaths, resolvePage } = await import("./service");
    const { postIdsMatching } = await import("./blog-service");
    const all = await ctx.call(publishedPaths, { locale: input.locale });
    const unprefixed = all.map((p) =>
      p.slug.startsWith(`${input.locale}/`) ? p.slug.slice(input.locale.length + 1) : p.slug,
    );
    // Marked posts count wherever they live, but only on the default listing:
    // a custom prefix ("news") means exactly the pages under it.
    const marked =
      input.prefix === "blog"
        ? new Set(
            (
              await ctx.tx
                .select({ slug: pages.slug })
                .from(blogPosts)
                .innerJoin(pages, eq(pages.id, blogPosts.pageId))
            ).map((row) => row.slug),
          )
        : new Set<string>();
    const paths = [...new Set(unprefixed.filter((slug) => slug.startsWith(`${input.prefix}/`) || marked.has(slug)))];
    const matching = await postIdsMatching(ctx.tx, {
      category: input.category,
      tag: input.tag,
      author: input.author,
    });
    let metadata = paths.length
      ? await ctx.tx
          .select({ id: pages.id, slug: pages.slug, publishedAt: pages.publishedAt })
          .from(pages)
          .where(and(inArray(pages.slug, paths), eq(pages.status, "published"), isNull(pages.trashedAt)))
      : [];
    if (matching !== null) metadata = metadata.filter((row) => matching.has(row.id));
    metadata.sort(
      (a, b) => (b.publishedAt?.getTime() ?? 0) - (a.publishedAt?.getTime() ?? 0) || a.slug.localeCompare(b.slug),
    );
    const slice = metadata.slice((input.page - 1) * input.limit, input.page * input.limit);
    const ids = slice.map((row) => row.id);
    const authors = ids.length
      ? await ctx.tx
          .select({ pageId: blogPosts.pageId, name: blogAuthors.name, path: blogAuthors.path })
          .from(blogPosts)
          .innerJoin(blogAuthors, eq(blogAuthors.id, blogPosts.authorId))
          .where(inArray(blogPosts.pageId, ids))
      : [];
    const categories = ids.length
      ? await ctx.tx
          .select({ pageId: blogPostTerms.pageId, name: blogTerms.name, path: blogTerms.path })
          .from(blogPostTerms)
          .innerJoin(blogTerms, eq(blogTerms.id, blogPostTerms.termId))
          .where(and(inArray(blogPostTerms.pageId, ids), eq(blogTerms.taxonomy, "category")))
          .orderBy(asc(blogPostTerms.position))
      : [];
    const posts = [];
    for (const row of slice) {
      const page = await ctx.call(resolvePage, { slug: row.slug, locale: input.locale });
      if (!page) continue;
      const seo = page.seo as { title?: string; description?: string };
      const author = authors.find((one) => one.pageId === row.id);
      posts.push({
        slug: row.slug,
        title: seo?.title ?? page.title,
        description: seo?.description ?? null,
        updatedAt: row.publishedAt ?? page.updatedAt,
        author: author ? { name: author.name, path: author.path } : null,
        categories: categories.filter((one) => one.pageId === row.id).map(({ name, path }) => ({ name, path })),
      });
    }
    return {
      total: metadata.length,
      page: input.page,
      pages: Math.max(1, Math.ceil(metadata.length / input.limit)),
      posts,
    };
  },
});

const blockFilter = z.string().trim().max(200).regex(/^[a-z0-9-]*$/).optional();

export const blogIndex = defineBlock({
  type: "blogIndex",
  labelKey: "blog.title",
  contexts: ["page"],
  schema: z.object({
    prefix: z.string().regex(/^[a-z0-9][a-z0-9/-]*$/).default("blog"),
    limit: z.number().int().min(1).max(50).default(12),
    /** Only posts in this category (and its subcategories), by slug. */
    category: blockFilter,
    /** Only posts with this tag, by slug. */
    tag: blockFilter,
    /** Only posts by this author, by slug. */
    author: blockFilter,
    /** Show the categories as links above the list. */
    showCategories: z.boolean().default(false),
  }),
  starter: () => ({ prefix: "blog", limit: 12 }),
  resolve: async (props, ctx) => {
    const { listTerms } = await import("./blog-service");
    const anonymous = { kind: "anonymous" } as const;
    // A visitor can narrow an unfiltered listing (`?category=glazes`); a
    // listing the owner already filtered stays what the owner set. Filtered
    // views are noindexed and canonicalised by the page route (§5).
    const asked = (key: string) => {
      const value = firstQueryValue(ctx.query?.[key]);
      return value && /^[a-z0-9-]{1,200}$/.test(value) ? value : undefined;
    };
    const [listing, categories] = await Promise.all([
      listBlogPosts.call(
        {
          locale: ctx.locale,
          prefix: props.prefix,
          limit: props.limit,
          page: Math.min(10000, Math.max(1, Math.floor(Number(firstQueryValue(ctx.query?.page))) || 1)),
          category: props.category || asked("category"),
          tag: props.tag || asked("tag"),
          author: props.author || asked("author"),
        },
        anonymous,
      ),
      props.showCategories ? listTerms.call({ taxonomy: "category" }, anonymous) : Promise.resolve([]),
    ]);
    return { ...listing, categories: categories.filter((term) => term.posts > 0 && !term.parentId) };
  },
  render: ({ props, resolved, ctx }) => {
    if (!resolved) return null;
    const href = (path: string) => ctx.localizeHref?.(path) ?? path;
    const here = ctx.path || `/${props.prefix}`;
    const pageHref = (page: number) => {
      const params = new URLSearchParams();
      for (const key of ["category", "tag", "author"]) {
        const value = firstQueryValue(ctx.query?.[key]);
        if (value) params.set(key, value);
      }
      if (page > 1) params.set("page", String(page));
      const query = params.toString();
      return href(query ? `${here}?${query}` : here);
    };
    return (
      <section className="grid gap-8" aria-label={ctx.t("blog.title")}>
        {resolved.categories.length ? (
          <nav aria-label={ctx.t("blog.categories")}>
            <ul className="flex list-none flex-wrap gap-2 p-0">
              {resolved.categories.map((term) => (
                <li key={term.id}>
                  <a
                    className="inline-flex rounded-full border border-rule px-3 py-1 text-sm text-ink underline-offset-4 hover:underline"
                    href={href(`/${term.path}`)}
                  >
                    {term.name}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
        ) : null}
        {resolved.posts.length ? (
          <div className="grid gap-6 md:grid-cols-2">
            {resolved.posts.map((post) => (
              <article key={post.slug} className="grid content-start gap-3 rounded-lg border border-rule bg-surface p-6">
                {post.categories.length ? (
                  <p className="flex flex-wrap gap-x-3 text-xs font-semibold uppercase tracking-wide text-ink-muted">
                    {post.categories.map((category) => (
                      <a key={category.path} className="hover:underline" href={href(`/${category.path}`)}>
                        {category.name}
                      </a>
                    ))}
                  </p>
                ) : null}
                <h2 className="text-xl font-semibold">
                  <a className="underline decoration-rule underline-offset-4" href={href(`/${post.slug}`)}>
                    {post.title}
                  </a>
                </h2>
                {post.description ? <p className="text-ink-muted">{post.description}</p> : null}
                <p className="flex flex-wrap gap-x-2 text-sm text-ink-muted">
                  {post.author ? (
                    <span>
                      {ctx.t("blog.by")}{" "}
                      <a className="underline underline-offset-4" href={href(`/${post.author.path}`)}>
                        {post.author.name}
                      </a>
                    </span>
                  ) : null}
                  <time dateTime={post.updatedAt.toISOString()}>
                    {new Intl.DateTimeFormat(ctx.locale, { dateStyle: "medium" }).format(post.updatedAt)}
                  </time>
                </p>
              </article>
            ))}
          </div>
        ) : (
          <p className="text-ink-muted">{ctx.t("blog.empty")}</p>
        )}
        {resolved.pages > 1 ? (
          <nav className="flex items-center justify-between gap-4" aria-label={ctx.t("blog.pagination")}>
            {resolved.page > 1 ? (
              <a className="underline" rel="prev" href={pageHref(resolved.page - 1)}>
                {ctx.t("blog.previous")}
              </a>
            ) : (
              <span />
            )}
            <span>{ctx.t("blog.page", { page: resolved.page, pages: resolved.pages })}</span>
            {resolved.page < resolved.pages ? (
              <a className="underline" rel="next" href={pageHref(resolved.page + 1)}>
                {ctx.t("blog.next")}
              </a>
            ) : (
              <span />
            )}
          </nav>
        ) : null}
      </section>
    );
  },
});
