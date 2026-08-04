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
import { notFound, permanentRedirect, redirect } from "next/navigation";
import { ArrowRight } from "@phosphor-icons/react/dist/ssr";
import { setupState } from "@/core/settings/service";
import { collectJsonLd } from "@/modules/cms/blocks/registry";
import { renderBlocks } from "@/modules/cms/render";
import type { BlockNode } from "@/modules/cms/blocks/types";
import { resolveRedirect } from "@/core/seo/service";
import {
  breadcrumbJsonLd,
  humanizeSegment,
  organizationJsonLd,
  websiteJsonLd,
} from "@/core/seo/jsonld";
import { siteOrigin } from "@/core/seo/origin";
import { getLocale, getT } from "../../i18n";
import { recordPageView } from "./pageview";
import { currentBusiness } from "@/core/settings/read";
import { publishedPage } from "@/modules/cms/read";

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
    publishedPage(pathOf(slug), locale),
    currentBusiness(),
  ]);
  if (!page) return {};

  // §5 per-page requirements: a unique title and description on every page,
  // "with sane auto-generated defaults" — the stored override wins, and the
  // fallback is built from what the page already knows rather than left blank.
  const seo = (page.seo ?? {}) as { title?: string; description?: string };
  const siteName = business?.name;
  const title = seo.title ?? page.title;
  const description = seo.description ?? business?.tagline ?? undefined;

  // §5 wants the canonical *absolute*, and absolute means configured rather
  // than taken from the request — see core/seo/origin.ts.
  const origin = siteOrigin();
  const url = page.slug === "" ? `${origin}/` : `${origin}/${page.slug}`;

  return {
    title: siteName && page.slug !== "" ? `${title} · ${siteName}` : title,
    description,
    alternates: { canonical: url },
    openGraph: {
      title,
      description,
      type: "website",
      url,
      siteName: siteName ?? undefined,
    },
    twitter: { card: "summary_large_image", title, description },
  };
}

export default async function PublicPage({
  params,
  searchParams,
}: {
  params: Promise<Params>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ slug }, query] = await Promise.all([params, searchParams]);
  const path = pathOf(slug);

  const [locale, t] = await Promise.all([getLocale(), getT()]);
  const [page, business] = await Promise.all([
    publishedPage(path, locale),
    currentBusiness(),
  ]);

  // An instance nobody has set up yet has no pages, and answering 404 at the
  // root would be a true statement that helps nobody — the owner's next step
  // is the wizard. Only the root gets this; every other path is a real 404,
  // because a missing /about is missing however new the site is.
  if (!page && path === "") {
    const state = await setupState.call({}, ANONYMOUS);
    if (!state.completed) return <NotSetUpYet t={t} />;
  }

  // §5: "slugs never silently break". Before answering 404, ask whether this
  // address used to be a page — a link somebody shared two years ago should
  // still land somewhere, and a permanent redirect tells a crawler to carry
  // the standing of the old address over to the new one.
  //
  // The wire status is 308, not the 301 §5 names: a server component cannot
  // choose its status code, and Next's permanent redirect is 308. What §5
  // actually asks for — permanent versus temporary, told to the crawler — is
  // intact, and search engines treat 308 as 301's equal. The redirect *row*
  // still records 301/302, so serving a literal 301 later is a change here and
  // nowhere else.
  if (!page) {
    const moved = await resolveRedirect.call({ path, locale }, ANONYMOUS);
    if (moved) {
      const destination = moved.toPath === "" ? "/" : `/${moved.toPath}`;
      if (moved.status === "301") permanentRedirect(destination);
      redirect(destination);
    }
  }
  if (!page) notFound();

  // §4.7's first-party analytics, recorded by the platform rather than by a
  // script in the visitor's browser. Nothing to block, nothing to consent to
  // loading, and it works with JavaScript switched off — the numbers describe
  // the traffic that actually arrived rather than the subset that ran a tag.
  await recordPageView(path === "" ? "/" : `/${path}`, locale);

  const blocks = page.blocks as BlockNode[];
  const rendered = await renderBlocks(blocks, {
    locale,
    t,
    business: business ? { name: business.name, tagline: business.tagline } : null,
    path: path === "" ? "/" : `/${path}`,
    // Blocks whose state survives a page load read it from here — see the
    // form block, which confirms a submission by re-rendering rather than by
    // holding the result in client state. Repeated parameters collapse to the
    // first: a block asking "was this form just sent?" wants an answer, not an
    // array.
    query: Object.fromEntries(
      Object.entries(query).map(([key, value]) => [
        key,
        Array.isArray(value) ? value[0] : value,
      ]),
    ),
  });

  // Structured data comes from two places, and neither is a setting an owner
  // has to find: the page's own identity (§5 — WebSite and the business on the
  // home page, a breadcrumb trail everywhere else), and the blocks themselves,
  // where an FAQ block is what puts FAQPage in the markup.
  const origin = siteOrigin();
  const facts = business
    ? {
        name: business.name,
        tagline: business.tagline,
        schemaType: business.schemaType,
        baseCurrency: business.baseCurrency,
      }
    : null;

  const jsonLd = [
    ...(facts && path === ""
      ? [websiteJsonLd(origin, facts), organizationJsonLd(origin, facts)]
      : []),
    ...(path !== ""
      ? [
          breadcrumbJsonLd(origin, path, (segmentPath) =>
            segmentPath === ""
              ? (facts?.name ?? t("home.brand"))
              : segmentPath === path
                ? page.title
                : humanizeSegment(segmentPath.split("/").pop() ?? segmentPath),
          ),
        ].filter((entry) => entry !== undefined)
      : []),
    ...collectJsonLd(blocks),
  ];

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
