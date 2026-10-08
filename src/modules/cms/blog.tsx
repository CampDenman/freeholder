// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C2.26: posts are ordinary CMS pages; discovery shares their publish vetoes.
import { and, eq, inArray } from "drizzle-orm";
import { pages } from "./schema";
import { z } from "zod";
import { defineService } from "@/core/service";
import { defineBlock, firstQueryValue } from "./blocks/types";

export const listBlogPosts = defineService({
  name: "cms.listBlogPosts",
  summary: "Published blog posts in one locale, newest first, without private bodies.",
  kind: "query",
  permission: "public",
  input: z.object({ locale: z.string().default("en"), prefix: z.string().regex(/^[a-z0-9][a-z0-9/-]*$/).default("blog"), page: z.number().int().min(1).max(10000).default(1), limit: z.number().int().min(1).max(50).default(12) }),
  output: z.object({ total: z.number().int(), page: z.number().int(), pages: z.number().int(), posts: z.array(z.object({ slug: z.string(), title: z.string(), description: z.string().nullable(), updatedAt: z.date() })) }),
  handler: async (input, ctx) => {
    const { publishedPaths, resolvePage } = await import("./service");
    const all = await ctx.call(publishedPaths, { locale: input.locale });
    const paths = [...new Set(all.map(p => p.slug.startsWith(`${input.locale}/`) ? p.slug.slice(input.locale.length+1) : p.slug).filter(slug => slug.startsWith(`${input.prefix}/`)))];
    const metadata = paths.length ? await ctx.tx.select({slug:pages.slug,publishedAt:pages.publishedAt}).from(pages).where(and(inArray(pages.slug,paths),eq(pages.status,"published"))) : [];
    metadata.sort((a,b)=>(b.publishedAt?.getTime()??0)-(a.publishedAt?.getTime()??0)||a.slug.localeCompare(b.slug));
    const posts=[];
    for (const row of metadata.slice((input.page-1)*input.limit,input.page*input.limit)) {
      const page=await ctx.call(resolvePage,{slug:row.slug,locale:input.locale});
      if(!page)continue;
      const seo=page.seo as {title?:string;description?:string};
      posts.push({slug:row.slug,title:seo?.title??page.title,description:seo?.description??null,updatedAt:row.publishedAt??page.updatedAt});
    }
    return {total:metadata.length,page:input.page,pages:Math.max(1,Math.ceil(metadata.length/input.limit)),posts};
  },
});

export const blogIndex = defineBlock({
  type: "blogIndex", labelKey: "blog.title", contexts: ["page"],
  schema: z.object({ prefix: z.string().regex(/^[a-z0-9][a-z0-9/-]*$/).default("blog"), limit: z.number().int().min(1).max(50).default(12) }),
  starter: () => ({ prefix: "blog", limit: 12 }),
  resolve: async (props, ctx) => listBlogPosts.call({ locale: ctx.locale, prefix: props.prefix, limit: props.limit, page: Math.min(10000, Math.max(1, Math.floor(Number(firstQueryValue(ctx.query?.page))) || 1)) }, { kind: "anonymous" }),
  render: ({ props, resolved, ctx }) => {
    if (!resolved) return null;
    const href = (path: string) => ctx.localizeHref?.(path) ?? path;
    return <section className="grid gap-8" aria-label={ctx.t("blog.title")}>
      {resolved.posts.length ? <div className="grid gap-6 md:grid-cols-2">{resolved.posts.map(post => <article key={post.slug} className="grid content-start gap-3 rounded-lg border border-rule bg-surface p-6"><h2 className="text-xl font-semibold"><a className="underline decoration-rule underline-offset-4" href={href(`/${post.slug}`)}>{post.title}</a></h2>{post.description ? <p className="text-ink-muted">{post.description}</p> : null}<time className="text-sm text-ink-muted" dateTime={post.updatedAt.toISOString()}>{new Intl.DateTimeFormat(ctx.locale, { dateStyle: "medium" }).format(post.updatedAt)}</time></article>)}</div> : <p className="text-ink-muted">{ctx.t("blog.empty")}</p>}
      {resolved.pages > 1 ? <nav className="flex items-center justify-between gap-4" aria-label={ctx.t("blog.pagination")}>
        {resolved.page > 1 ? <a className="underline" href={href(`/${props.prefix}?page=${resolved.page-1}`)}>{ctx.t("blog.previous")}</a> : <span />}
        <span>{ctx.t("blog.page", { page: resolved.page, pages: resolved.pages })}</span>
        {resolved.page < resolved.pages ? <a className="underline" href={href(`/${props.prefix}?page=${resolved.page+1}`)}>{ctx.t("blog.next")}</a> : <span />}
      </nav> : null}
    </section>;
  },
});
