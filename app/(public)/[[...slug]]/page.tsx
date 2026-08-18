// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
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
import { headers } from "next/headers";
import { notFound, permanentRedirect, redirect } from "next/navigation";
import { ArrowRight } from "@phosphor-icons/react/dist/ssr";
import { setupState } from "@/core/settings/service";
import { collectJsonLd } from "@/modules/cms/blocks/registry";
import { renderBlocks } from "@/modules/cms/render";
import type { BlockNode } from "@/modules/cms/blocks/types";
import { resolveRedirect } from "@/core/seo/service";
import {
  articleJsonLd,
  breadcrumbJsonLd,
  eventJsonLd,
  humanizeSegment,
  organizationJsonLd,
  productJsonLd,
  serviceJsonLd,
  websiteJsonLd,
} from "@/core/seo/jsonld";
import { kindFromSlug } from "@/core/seo/classify";
import {
  composeDescription,
  composeDocumentTitle,
  isFilterQuery,
  ogImagePath,
} from "@/core/seo/meta";
import { siteOrigin } from "@/core/seo/origin";
import { localBusinessJsonLd } from "@/core/locations/jsonld";
import { currentLocation } from "@/core/locations/read";
import { getLocation } from "@/core/locations/service";
import { getLocale, getT, requestedLocale } from "../../i18n";
import { alternatesFor, localePath, translatedLocales } from "./alternates";
import { recordPageView } from "./pageview";
import { currentBusiness } from "@/core/settings/read";
import { publishedPage } from "@/modules/cms/read";
import { assignmentsFor } from "@/modules/cms/experiments";
import { ANON_HEADER } from "@/modules/analytics/visitor";
import { localizeCustomerHref } from "@/core/i18n/customer";
import { CSP_NONCE_HEADER } from "@/core/http/csp";

export const dynamic = "force-dynamic";

const ANONYMOUS = { kind: "anonymous" } as const;

type Params = { slug?: string[] };

/** "" for the home page; "services/weddings" for a nested one. */
function pathOf(slug: string[] | undefined): string {
  return (slug ?? []).join("/");
}

/**
 * The path to resolve, once a locale prefix has been accounted for.
 *
 * The proxy strips anything shaped like a language tag, because the edge
 * cannot ask which locales this instance publishes. If it turns out not to be
 * one, the segment was never a prefix — `/de/about` on a site with no German
 * is a page called `de/about`, and it resolves as one.
 */
async function pathFor(slug: string[] | undefined): Promise<string> {
  const path = pathOf(slug);
  const [asked, business] = await Promise.all([
    requestedLocale(),
    currentBusiness(),
  ]);
  if (!asked) return path;
  if (business?.enabledLocales.includes(asked)) return path;
  return path === "" ? asked : `${asked}/${path}`;
}

/** A page's own address in a given locale (§4.9's URL strategy). */
function canonicalFor(
  origin: string,
  slug: string,
  locale: string,
  business: { defaultLocale: string } | null,
): string {
  return `${origin}${localePath(slug, locale, business?.defaultLocale ?? locale)}`;
}

export async function generateMetadata({
  params,
  searchParams,
}: {
  params: Promise<Params>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<Metadata> {
  const { slug } = await params;
  const query = await searchParams;
  const locale = await getLocale();
  const [page, business] = await Promise.all([
    publishedPage(await pathFor(slug), locale),
    currentBusiness(),
  ]);
  if (!page) return {};

  // §5 per-page requirements: a unique title and description on every page,
  // "with sane auto-generated defaults" — the stored override wins, and the
  // fallback is built from what the page already knows rather than left blank.
  const seo = (page.seo ?? {}) as {
    title?: string;
    description?: string;
    ogImage?: string;
  };
  const siteName = business?.name;
  const title = composeDocumentTitle(
    seo.title ?? page.title,
    siteName,
    page.slug === "",
  );
  const description = composeDescription(
    seo.description ?? business?.tagline ?? undefined,
  );

  // §5 wants the canonical *absolute*, and absolute means configured rather
  // than taken from the request — see core/seo/origin.ts.
  const origin = siteOrigin();

  // §5: "every localized page emits full hreflang alternates + x-default".
  // Only the locales that actually have a reviewed translation are advertised
  // — telling a search engine a French version exists when it does not is how
  // a site ends up with duplicate-content problems in two languages.
  const alternates = await alternatesFor(page.id, page.slug, origin, business);

  // A prefixed URL for a page with no translation serves the site's own
  // language — so it is not a separate page, and saying otherwise is how one
  // article becomes two competing search results. The canonical names the
  // version that is actually the article.
  const translated = business ? await translatedLocales(page.id, business) : [];
  const servedLocale =
    locale === business?.defaultLocale || translated.includes(locale)
      ? locale
      : (business?.defaultLocale ?? locale);

  const canonical = canonicalFor(origin, page.slug, servedLocale, business);
  const ogImage = seo.ogImage ?? `${origin}${ogImagePath(page.slug)}`;
  const filtered = isFilterQuery(query);

  return {
    title,
    description,
    robots: filtered ? { index: false, follow: true } : undefined,
    alternates: {
      canonical,
      ...(alternates ? { languages: alternates } : {}),
    },
    openGraph: {
      title,
      description,
      type: "website",
      url: canonical,
      siteName: siteName ?? undefined,
      images: [{ url: ogImage, width: 1200, height: 630, alt: title }],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [ogImage],
    },
  };
}

export default async function PublicPage({
  params,
  searchParams,
}: {
  params: Promise<Params>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ slug }, query, requestHeaders] = await Promise.all([
    params,
    searchParams,
    headers(),
  ]);
  const nonce = requestHeaders.get(CSP_NONCE_HEADER) ?? undefined;
  const path = await pathFor(slug);

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
      const localized = business
        ? localizeCustomerHref(destination, locale, business)
        : destination;
      if (moved.status === "301") permanentRedirect(localized);
      redirect(localized);
    }
  }
  if (!page) notFound();

  // §4.7's first-party analytics, recorded by the platform rather than by a
  // script in the visitor's browser. Nothing to block, nothing to consent to
  // loading, and it works with JavaScript switched off — the numbers describe
  // the traffic that actually arrived rather than the subset that ran a tag.
  await recordPageView(path === "" ? "/" : `/${path}`, locale, query);

  const blocks = page.blocks as BlockNode[];
  const visitorId = requestHeaders.get(ANON_HEADER);
  const experimentAssignments = assignmentsFor(blocks, visitorId);
  const rendered = await renderBlocks(blocks, {
    locale,
    t,
    business: business ? {
          name: business.name,
          tagline: business.tagline,
          defaultLocale: business.defaultLocale,
          enabledLocales: business.enabledLocales,
        } : null,
    path: path === "" ? "/" : `/${path}`,
    visitorId,
    experimentAssignments,
    localizeHref: business
      ? (href: string) => localizeCustomerHref(href, locale, business)
      : undefined,
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

  // §4.10: "Each location emits LocalBusiness JSON-LD with geo, hours,
  // priceRange, sameAs." The home page carries the primary location's, because
  // for a single-location business the home page *is* the business's page —
  // and a business with no locations emits nothing extra rather than an
  // Organization pretending to be somewhere.
  const localBusiness =
    facts && path === "" ? await homeLocalBusiness(origin, facts.schemaType) : null;

  const jsonLd = [
    ...(facts && path === ""
      ? [
          websiteJsonLd(origin, facts),
          localBusiness ?? organizationJsonLd(origin, facts),
        ]
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
    ...(await entityJsonLd({
      origin,
      path,
      title: page.title,
      description: (page.seo as { description?: string } | null)?.description
        ?? facts?.tagline
        ?? null,
      providerName: facts?.name ?? null,
      updatedAt: page.updatedAt,
    })),
    ...collectJsonLd(blocks),
  ];

  return (
    <>
      {jsonLd.map((entry, i) => (
        <script
          key={i}
          nonce={nonce}
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(entry) }}
        />
      ))}
      <article className="grid gap-8">{rendered}</article>
    </>
  );
}

/**
 * Page-type structured data beyond the site/business/breadcrumb.
 *
 * Service, article, product and event pages emit the matching schema.org type
 * so a crawler does not have to guess from the URL.
 */
async function entityJsonLd(input: {
  origin: string;
  path: string;
  title: string;
  description: string | null;
  providerName: string | null;
  updatedAt?: Date;
}): Promise<ReturnType<typeof serviceJsonLd>[]> {
  const kind = kindFromSlug(input.path);
  const url = input.path === "" ? `${input.origin}/` : `${input.origin}/${input.path}`;
  const leaf = input.path.split("/").filter(Boolean)[1];
  if (kind === "service") {
    return [
      serviceJsonLd({
        name: input.title,
        url,
        description: input.description,
        providerName: input.providerName,
      }),
    ];
  }
  if (kind === "article" || kind === "newsletter") {
    return [
      articleJsonLd({
        headline: input.title,
        url,
        description: input.description,
        dateModified: input.updatedAt,
        authorName: input.providerName,
      }),
    ];
  }
  if (kind === "product" && leaf) {
    const { resolveVisibleProduct } = await import("@/modules/catalog/service");
    const product = await resolveVisibleProduct.call({ slug: leaf }, ANONYMOUS);
    if (!product) return [];
    return [
      productJsonLd({
        name: product.name,
        url,
        description: product.seo.description ?? product.subtitle ?? input.description,
        sku: product.slug,
        brand: product.brand,
      }),
    ];
  }
  if (kind === "event" && leaf) {
    const { resolvePublicEvent } = await import("@/modules/events/service");
    const event = await resolvePublicEvent.call({ slug: leaf }, ANONYMOUS);
    if (!event) return [];
    const first = event.sessions[0];
    return [
      eventJsonLd({
        name: event.name,
        url,
        description: event.summary ?? input.description,
        startDate: first?.startsAt.toISOString(),
        endDate: first?.endsAt.toISOString(),
        eventStatus: event.status === "cancelled" ? "EventCancelled" : "EventScheduled",
        venueName: event.venueName,
        venueAddress: event.venueAddress,
        remainingAttendeeCapacity: first?.remaining,
      }),
    ];
  }
  return [];
}

/**
 * The primary location as LocalBusiness, or null when there is none.
 *
 * It supersedes `organizationJsonLd` rather than joining it: two objects both
 * claiming to be the business, one with an address and one without, is a
 * crawler's ambiguity to resolve rather than a fact. The location's own
 * `schemaType` wins when it has one — see core/locations/schema.ts.
 */
async function homeLocalBusiness(
  origin: string,
  businessSchemaType: string,
): Promise<Record<string, unknown> | null> {
  const primary = await currentLocation();
  if (!primary) return null;
  const full = await getLocation.call({ id: primary.id }, ANONYMOUS);
  if (!full) return null;
  return localBusinessJsonLd({
    location: full,
    hours: full.hours,
    serviceArea: full.serviceArea,
    businessSchemaType,
    url: `${origin}/`,
  });
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
