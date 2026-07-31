// Copyright (C) 2026 Camp Denman Society
// SPDX-License-Identifier: AGPL-3.0-only
// The public surface — one route for every page on the site (MASTER.md §32).
//
// This file is the answer to a question the module contract left open: how does
// a module contribute a public page when Next's router is file-system based?
// It does not. §32 already decided — "structure is data; code is vocabulary" —
// so there is one route, it resolves a path to a row, and it renders that row's
// block tree. A new page is an INSERT. A new *kind* of block is code.
//
// Consequences worth knowing:
//   - Publishing is live on the next request. There is no build step between
//     an owner and their site, which is §32's stated requirement.
//   - The SEO contract holds by construction: metadata comes from the same row
//     as the content, and blocks contribute their own JSON-LD (§5).
//   - A path with no published page is a real 404, not a soft one — §5 wants
//     "clean structural 404s", and a 200 saying "not found" is neither.
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ArrowRight } from "@phosphor-icons/react/dist/ssr";
import { getBusiness, setupState } from "@/core/settings/service";
import { resolvePage } from "@/modules/cms/service";
import { collectJsonLd } from "@/modules/cms/blocks/registry";
import { renderBlocks } from "@/modules/cms/render";
import type { BlockNode } from "@/modules/cms/blocks/types";
import { getLocale, getT } from "../../i18n";

export const dynamic = "force-dynamic";

const ANONYMOUS = { kind: "anonymous" } as const;

type Params = { slug?: string[] };

/** "" for the home page; "services/weddings" for a nested one. */
function pathOf(slug: string[] | undefined): string {
  return (slug ?? []).join("/");
}

export async function generateMetadata({
  params,
}: {
  params: Promise<Params>;
}): Promise<Metadata> {
  const { slug } = await params;
  const locale = await getLocale();
  const [page, business] = await Promise.all([
    resolvePage.call({ slug: pathOf(slug), locale }, ANONYMOUS),
    getBusiness.call({}, ANONYMOUS),
  ]);
  if (!page) return {};

  // §5 per-page requirements: a unique title and description on every page,
  // "with sane auto-generated defaults" — the stored override wins, and the
  // fallback is built from what the page already knows rather than left blank.
  const seo = (page.seo ?? {}) as { title?: string; description?: string };
  const siteName = business?.name;
  const title = seo.title ?? page.title;

  return {
    title: siteName && page.slug !== "" ? `${title} · ${siteName}` : title,
    description: seo.description ?? business?.tagline ?? undefined,
    alternates: { canonical: page.slug === "" ? "/" : `/${page.slug}` },
    openGraph: {
      title,
      description: seo.description ?? business?.tagline ?? undefined,
      type: "website",
      siteName: siteName ?? undefined,
    },
  };
}

export default async function PublicPage({
  params,
}: {
  params: Promise<Params>;
}) {
  const { slug } = await params;
  const path = pathOf(slug);

  const [locale, t] = await Promise.all([getLocale(), getT()]);
  const [page, business] = await Promise.all([
    resolvePage.call({ slug: path, locale }, ANONYMOUS),
    getBusiness.call({}, ANONYMOUS),
  ]);

  // An instance nobody has set up yet has no pages, and answering 404 at the
  // root would be a true statement that helps nobody — the owner's next step
  // is the wizard. Only the root gets this; every other path is a real 404,
  // because a missing /about is missing however new the site is.
  if (!page && path === "") {
    const state = await setupState.call({}, ANONYMOUS);
    if (!state.completed) return <NotSetUpYet t={t} />;
  }
  if (!page) notFound();

  const blocks = page.blocks as BlockNode[];
  const rendered = await renderBlocks(blocks, {
    locale,
    t,
    business: business ? { name: business.name, tagline: business.tagline } : null,
    path: path === "" ? "/" : `/${path}`,
  });

  // Structured data from the blocks themselves (§5): an FAQ block on the page
  // is what puts FAQPage in the markup, so the SEO layer never has to guess
  // what the content means.
  const jsonLd = collectJsonLd(blocks);

  return (
    <>
      {jsonLd.map((entry, i) => (
        <script
          key={i}
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(entry) }}
        />
      ))}
      <article className="grid gap-8">{rendered}</article>
    </>
  );
}

/**
 * The only screen in this file that is markup rather than blocks, and the only
 * one that can be: it is shown when there is no business yet, so there is
 * nothing to have authored it.
 */
function NotSetUpYet({ t }: { t: Awaited<ReturnType<typeof getT>> }) {
  return (
    <div className="grid gap-5">
      <h1 className="text-3xl font-bold tracking-tight text-balance">
        {t("home.ready.title")}
      </h1>
      <p className="max-w-prose text-ink-muted">{t("home.ready.intro")}</p>
      <div>
        <a
          href="/setup"
          className="inline-flex items-center gap-2 rounded-md bg-accent px-4 py-2 text-sm font-semibold text-on-accent shadow-[inset_0_-2px_0_rgb(0_0_0/0.16)]"
        >
          {t("home.ready.cta")}
          <ArrowRight size={15} weight="bold" />
        </a>
      </div>
    </div>
  );
}
