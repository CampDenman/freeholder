// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// The help centre's two blocks (MASTER.md §4.6, C8.12).
//
// `knowledge` is not new — it shipped as a slug-prefix listing, one of the two
// "passing mentions" §4.6 records. It is upgraded in place rather than joined
// by a second, overlapping block, because two blocks that both list help
// articles is the "second CMS" §4.6 forbids, arriving through the palette
// instead of the schema. Pages already using it keep working: with no
// categories defined, it still lists by prefix exactly as before.
//
// Both render as plain server HTML. The search is a GET form and the vote is a
// server action that redirects back with a flag — no client component, so the
// public surface stays the unhydrated markup §5 and the SEO gate depend on.
import { z } from "zod";
import { submitInboundAction } from "../../../../app/(public)/inbound-actions";
import { defineBlock } from "./types";

const ANONYMOUS = { kind: "anonymous" } as const;

type Article = {
  id: string;
  slug: string;
  title: string;
  categorySlug: string | null;
  categoryName: string | null;
};

type Resolved =
  | { mode: "legacy"; pages: { slug: string; title: string }[] }
  | {
      mode: "browse" | "search";
      q: string;
      categories: { id: string; slug: string; name: string; description: string | null; articleCount: number }[];
      articles: Article[];
    };

export const knowledge = defineBlock({
  type: "knowledge",
  labelKey: "cms.block.knowledge",
  contexts: ["page"],
  schema: z.object({
    /** Kept from the original block so existing pages validate unchanged. */
    prefix: z.string().trim().min(1).max(40).default("help"),
    /** Show one category only. Empty shows every category. */
    categorySlug: z.string().trim().max(80).optional(),
    showSearch: z.boolean().default(true),
    limit: z.number().int().min(1).max(100).default(50),
  }),
  starter: () => ({ prefix: "help", showSearch: true, limit: 50 }),
  resolve: async (props, ctx): Promise<Resolved> => {
    const { helpArticles, helpCategoryList, searchHelp } = await import("../help-service");
    const categories = await helpCategoryList.call({ locale: ctx.locale }, ANONYMOUS);

    // Nothing filed yet — behave exactly like the block did before C8.12 so an
    // existing site does not lose its help index the moment this ships.
    if (categories.length === 0) {
      const { publishedPaths } = await import("../service");
      const rows = await publishedPaths.call({ locale: ctx.locale }, ANONYMOUS);
      const prefix = props.prefix.replace(/^\/+|\/+$/g, "");
      return {
        mode: "legacy",
        pages: rows.filter((r) => r.slug === prefix || r.slug.startsWith(`${prefix}/`)),
      };
    }

    const q = (ctx.query?.q ?? "").trim();
    if (q) {
      return {
        mode: "search",
        q,
        categories,
        articles: await searchHelp.call({ q, locale: ctx.locale, limit: props.limit }, ANONYMOUS),
      };
    }
    return {
      mode: "browse",
      q: "",
      categories,
      articles: await helpArticles.call(
        { locale: ctx.locale, categorySlug: props.categorySlug, limit: props.limit },
        ANONYMOUS,
      ),
    };
  },
  render: ({ props, resolved, ctx }) => {
    if (!resolved) return null;
    const link = (slug: string) => ctx.localizeHref?.(`/${slug}`) ?? `/${slug}`;

    if (resolved.mode === "legacy") {
      if (resolved.pages.length === 0) return null;
      return (
        <nav aria-label={ctx.t("cms.block.knowledge")}>
          <ul className="grid list-none gap-2 p-0">
            {resolved.pages.map((page) => (
              <li key={page.slug}>
                <a href={link(page.slug)} className="font-semibold text-ink">
                  {page.title}
                </a>
              </li>
            ))}
          </ul>
        </nav>
      );
    }

    const search = props.showSearch ? (
      // GET, so a search is a URL somebody can share or go back to, and it
      // works with scripting off.
      <form method="get" role="search" className="flex flex-wrap items-end gap-2">
        <label className="grid gap-1 text-sm">
          <span className="font-medium text-ink">{ctx.t("help.search.label")}</span>
          <input
            type="search"
            name="q"
            defaultValue={resolved.q}
            placeholder={ctx.t("help.search.placeholder")}
            className="rounded border border-rule bg-surface px-3 py-2 text-ink"
          />
        </label>
        <button
          type="submit"
          className="rounded bg-accent px-3 py-2 font-medium text-on-accent"
        >
          {ctx.t("help.search.submit")}
        </button>
      </form>
    ) : null;

    if (resolved.mode === "search") {
      return (
        <section className="grid gap-4">
          {search}
          {resolved.articles.length === 0 ? (
            <p className="text-ink-muted">{ctx.t("help.search.none", { q: resolved.q })}</p>
          ) : (
            <ul className="grid list-none gap-3 p-0">
              {resolved.articles.map((a) => (
                <li key={a.id}>
                  <a href={link(a.slug)} className="font-semibold text-ink">
                    {a.title}
                  </a>
                  {a.categoryName ? (
                    <span className="ms-2 text-sm text-ink-muted">{a.categoryName}</span>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </section>
      );
    }

    const shown = resolved.categories.filter(
      (c) => !props.categorySlug || c.slug === props.categorySlug,
    );
    return (
      <section className="grid gap-6">
        {search}
        {shown.map((category) => {
          const articles = resolved.articles.filter((a) => a.categorySlug === category.slug);
          if (articles.length === 0) return null;
          return (
            <nav key={category.id} aria-label={category.name} className="grid gap-2">
              <h3 className="font-semibold text-ink">{category.name}</h3>
              {category.description ? (
                <p className="text-sm text-ink-muted">{category.description}</p>
              ) : null}
              <ul className="grid list-none gap-2 p-0">
                {articles.map((a) => (
                  <li key={a.id}>
                    <a href={link(a.slug)} className="text-ink">
                      {a.title}
                    </a>
                  </li>
                ))}
              </ul>
            </nav>
          );
        })}
      </section>
    );
  },
});

/**
 * "Did this help?" — two buttons and no comment box.
 *
 * §4.6 is specific about why: the question "is answerable by somebody who is
 * already frustrated; a free-text box is a support queue nobody staffed, and
 * an unanswered one is worse than none."
 *
 * The block finds its own article from the path it is rendering on, so an
 * owner drops it on an article without having to know an id, and it renders
 * nothing at all on a page that is not a help article — including on a draft,
 * where there are no readers to ask.
 */
export const helpFeedback = defineBlock({
  type: "helpFeedback",
  labelKey: "cms.block.helpFeedback",
  contexts: ["page"],
  schema: z.object({}),
  starter: () => ({}),
  resolve: async (_props, ctx) => {
    const { helpArticleAt } = await import("../help-service");
    return helpArticleAt.call({ slug: ctx.path, locale: ctx.locale }, ANONYMOUS);
  },
  render: ({ resolved, ctx }) => {
    if (!resolved) return null;
    // The confirmation is a query flag rather than component state, for the
    // same reason the form block's is: state would put the first hydration
    // boundary on the public surface.
    const voted = ctx.query?.helped;
    if (voted === "1" || voted === "0") {
      return <p className="text-ink-muted">{ctx.t("help.feedback.thanks")}</p>;
    }
    return (
      <form action={submitInboundAction} className="flex flex-wrap items-center gap-2">
        <input type="hidden" name="kind" value="helpful" />
        <input type="hidden" name="articleId" value={resolved.id} />
        <span className="text-ink">{ctx.t("help.feedback.question")}</span>
        <button
          type="submit"
          name="helpful"
          value="yes"
          className="rounded border border-rule px-3 py-1 text-ink"
        >
          {ctx.t("help.feedback.yes")}
        </button>
        <button
          type="submit"
          name="helpful"
          value="no"
          className="rounded border border-rule px-3 py-1 text-ink"
        >
          {ctx.t("help.feedback.no")}
        </button>
      </form>
    );
  },
});
