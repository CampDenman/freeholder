// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: AGPL-3.0-only
// The v1 block vocabulary (MASTER.md §32).
//
// §32 lists a longer palette than this. The blocks missing here are the ones
// that need a module that does not exist yet — image and gallery need
// core/media, product and booking need catalog and booking, tip and paywall
// need the money path. Each arrives with its module rather than as a stub that
// renders an apology, because a palette advertising blocks that do not work is
// worse than a short palette.
//
// Every block below renders *owner content*, never platform copy, which is why
// there are no catalog lookups in the markup: the words on a public page come
// from the database. The one exception is a fallback for an empty nav, and it
// goes through `t` like everything else.
import { Fragment } from "react";
import { z } from "zod";
import { renderNAP } from "@/core/locations/nap";
import { cx } from "@/ui/primitives";
import { defineBlock } from "./types";

/* ------------------------------------------------------------------ text */

export const heading = defineBlock({
  type: "heading",
  labelKey: "cms.block.heading",
  contexts: ["page", "chrome"],
  schema: z.object({
    text: z.string().min(1),
    // The editor enforces one H1 per page (§32: "the drag-and-drop layer
    // can't produce pages that fail the SEO gate"), which is why the level is
    // a constrained choice rather than free text.
    level: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]).default(2),
    align: z.enum(["start", "center"]).default("start"),
  }),
  starter: () => ({ text: "A new heading", level: 2 as const }),
  render: ({ props, ctx }) => {
    const Tag = `h${props.level}` as const;
    const size = {
      1: "text-4xl sm:text-5xl font-bold tracking-tight text-balance",
      2: "text-2xl sm:text-3xl font-bold tracking-tight text-balance",
      3: "text-xl font-semibold tracking-tight",
      4: "text-base font-semibold",
    }[props.level];
    return (
      <Tag
        {...ctx.editable?.("text")}
        className={cx(size, props.align === "center" && "text-center")}
      >
        {props.text}
      </Tag>
    );
  },
});

export const text = defineBlock({
  type: "text",
  labelKey: "cms.block.text",
  contexts: ["page", "chrome"],
  schema: z.object({
    // Paragraphs rather than HTML: §32 keeps the custom-HTML escape hatch
    // "admin-only, scoped, and deliberately inconvenient", so ordinary body
    // copy is plain text split on blank lines and rendered as <p>.
    body: z.string().min(1),
    align: z.enum(["start", "center"]).default("start"),
    measure: z.boolean().default(true),
  }),
  starter: () => ({ body: "Write something here." }),
  fieldHints: { body: { control: "multiline" } },
  render: ({ props, ctx }) => {
    const editing = ctx.editable?.("body");
    return (
      <div
        {...editing}
        className={cx(
          "grid gap-4 text-ink-muted",
          props.measure && "max-w-prose",
          props.align === "center" && "text-center justify-items-center",
        )}
      >
        {/* Paragraphs when rendering for real; one editable region while
            typing, because a caret cannot cross sibling elements sensibly and
            splitting on blank lines mid-sentence would fight the typist. The
            stored value is the same string either way. */}
        {editing
          ? props.body
          : props.body
              .split(/\n{2,}/)
              .map((paragraph) => paragraph.trim())
              .filter(Boolean)
              .map((paragraph, i) => <p key={i}>{paragraph}</p>)}
      </div>
    );
  },
});

/* --------------------------------------------------------------- actions */

export const button = defineBlock({
  type: "button",
  labelKey: "cms.block.button",
  contexts: ["page", "chrome"],
  schema: z.object({
    label: z.string().min(1),
    href: z.string().min(1),
    variant: z.enum(["solid", "quiet"]).default("solid"),
  }),
  starter: () => ({ label: "Get in touch", href: "/contact" }),
  render: ({ props, ctx }) => (
    <a
      href={props.href}
      {...ctx.editable?.("label")}
      className={cx(
        "inline-flex items-center gap-2 rounded-md px-4 py-2 text-sm font-semibold",
        props.variant === "solid"
          ? "bg-accent text-on-accent shadow-[inset_0_-2px_0_rgb(0_0_0/0.16)]"
          : "border border-rule text-ink",
      )}
    >
      {props.label}
    </a>
  ),
});

/* ----------------------------------------------------------------- layout */

export const columns = defineBlock({
  type: "columns",
  labelKey: "cms.block.columns",
  contexts: ["page", "chrome"],
  container: true,
  schema: z.object({
    count: z.union([z.literal(2), z.literal(3)]).default(2),
    gap: z.enum(["tight", "normal", "loose"]).default("normal"),
  }),
  starter: () => ({ count: 2 as const }),
  render: ({ props, children }) => (
    <div
      className={cx(
        "grid",
        props.count === 2 ? "sm:grid-cols-2" : "sm:grid-cols-3",
        { tight: "gap-4", normal: "gap-8", loose: "gap-12" }[props.gap],
      )}
    >
      {children}
    </div>
  ),
});

export const divider = defineBlock({
  type: "divider",
  labelKey: "cms.block.divider",
  contexts: ["page", "chrome"],
  schema: z.object({}),
  starter: () => ({}),
  render: () => <hr className="border-0 border-t border-rule" />,
});

export const spacer = defineBlock({
  type: "spacer",
  labelKey: "cms.block.spacer",
  contexts: ["page"],
  schema: z.object({ size: z.enum(["s", "m", "l"]).default("m") }),
  starter: () => ({ size: "m" as const }),
  render: ({ props }) => (
    <div
      aria-hidden="true"
      className={{ s: "h-4", m: "h-10", l: "h-20" }[props.size]}
    />
  ),
});

/* -------------------------------------------------------------------- SEO */

/**
 * FAQ is a first-class block because §5 says so: "content blocks encourage
 * direct-answer patterns (FAQ blocks are first-class in the CMS)". It is the
 * clearest example of the block contract earning its keep — the block emits
 * its own FAQPage JSON-LD, so structured data is a property of what the owner
 * dragged onto the page rather than something the SEO module has to infer.
 */
export const faq = defineBlock({
  type: "faq",
  labelKey: "cms.block.faq",
  contexts: ["page"],
  schema: z.object({
    items: z
      .array(z.object({ question: z.string().min(1), answer: z.string().min(1) }))
      .min(1),
  }),
  starter: () => ({
    items: [{ question: "A question people ask", answer: "The answer." }],
  }),
  render: ({ props }) => (
    <dl className="grid gap-0 border-t border-rule">
      {props.items.map((item, i) => (
        <div key={i} className="border-b border-rule py-4">
          <dt className="font-semibold text-ink">{item.question}</dt>
          <dd className="mt-1.5 max-w-prose text-ink-muted">{item.answer}</dd>
        </div>
      ))}
    </dl>
  ),
  jsonLd: (props) => ({
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: props.items.map((item) => ({
      "@type": "Question",
      name: item.question,
      acceptedAnswer: { "@type": "Answer", text: item.answer },
    })),
  }),
});

/* ----------------------------------------------------------------- chrome */

/**
 * A language switcher (§4.9).
 *
 * Added because the SEO gate caught its absence: the French home page was in
 * the sitemap and no page linked to it, which is an orphan — a URL a crawler
 * is told about and a person cannot reach. Every bilingual site needs this, so
 * it belongs in the vocabulary rather than in one owner's footer markup.
 *
 * Renders nothing on a single-locale instance, which is most of them.
 */
export const locales = defineBlock({
  type: "locales",
  labelKey: "cms.block.locales",
  contexts: ["chrome"],
  schema: z.object({
    separator: z.string().max(4).default("·"),
  }),
  starter: () => ({}),
  render: ({ props, ctx }) => {
    const enabled = ctx.business?.enabledLocales ?? [];
    const fallback = ctx.business?.defaultLocale;
    if (enabled.length < 2 || !fallback) return null;

    // The same page in each language, not everybody's home page: a visitor
    // switching language on an article wants that article.
    const bare = ctx.path.replace(
      new RegExp(`^/(?:${enabled.filter((l) => l !== fallback).join("|")})(?=/|$)`),
      "",
    );

    return (
      <nav aria-label={ctx.t("cms.nav.locales")} className="flex items-center gap-2">
        {enabled.map((locale, index) => {
          const href =
            locale === fallback
              ? bare || "/"
              : `/${locale}${bare === "/" ? "" : bare}`;
          const current = ctx.locale === locale;
          return (
            <span key={locale} className="flex items-center gap-2">
              {index > 0 ? (
                <span aria-hidden="true" className="text-ink-muted">
                  {props.separator}
                </span>
              ) : null}
              <a
                href={href}
                hrefLang={locale}
                aria-current={current ? "true" : undefined}
                className={cx(
                  "text-xs",
                  current ? "font-semibold text-ink" : "text-ink-muted",
                )}
              >
                {/* The language's own name, not the reader's: somebody looking
                    for French is looking for the word "Français". */}
                {languageName(locale)}
              </a>
            </span>
          );
        })}
      </nav>
    );
  },
});

/** A locale's name in its own language, with the tag as a last resort. */
function languageName(locale: string): string {
  try {
    const display = new Intl.DisplayNames([locale], { type: "language" });
    const name = display.of(locale);
    return name ? name.charAt(0).toUpperCase() + name.slice(1) : locale;
  } catch {
    return locale;
  }
}

/**
 * The business's name, live from settings. §4.10's discipline applied to
 * branding: rendered from one source so it cannot drift between the header,
 * the footer and the page that hardcoded it.
 */
export const brand = defineBlock({
  type: "brand",
  labelKey: "cms.block.brand",
  contexts: ["chrome"],
  schema: z.object({
    href: z.string().default("/"),
    showTagline: z.boolean().default(false),
  }),
  starter: () => ({}),
  render: ({ props, ctx }) => (
    <a href={props.href} className="grid gap-0.5">
      <span className="text-sm font-semibold text-ink">
        {ctx.business?.name ?? ctx.t("common.appName")}
      </span>
      {props.showTagline && ctx.business?.tagline ? (
        <span className="text-xs text-ink-muted">{ctx.business.tagline}</span>
      ) : null}
    </a>
  ),
});

/**
 * Navigation as rows, not JSX (§32). The links are stored on the block, so
 * reordering the menu is a database write — which is the whole thesis of this
 * module expressed in the smallest possible component.
 */
export const nav = defineBlock({
  type: "nav",
  labelKey: "cms.block.nav",
  contexts: ["chrome"],
  schema: z.object({
    links: z
      .array(z.object({ label: z.string().min(1), href: z.string().min(1) }))
      .default([]),
    ariaLabelKey: z.string().default("cms.nav.primary"),
  }),
  starter: () => ({ links: [{ label: "About", href: "/about" }] }),
  // The screen-reader name for the menu is platform machinery, not copy the
  // owner writes — it is a catalog key, and showing it would invite someone to
  // type a sentence into a field that expects an identifier.
  fieldHints: { ariaLabelKey: { hidden: true } },
  render: ({ props, ctx }) => {
    if (props.links.length === 0) return null;
    return (
      <nav aria-label={ctx.t(props.ariaLabelKey)}>
        <ul className="flex list-none flex-wrap items-center gap-x-5 gap-y-1 p-0">
          {props.links.map((link) => {
            const current =
              link.href === ctx.path ||
              (link.href !== "/" && ctx.path.startsWith(link.href));
            return (
              <li key={link.href}>
                <a
                  href={link.href}
                  aria-current={current ? "page" : undefined}
                  className={cx(
                    "text-sm",
                    current ? "font-semibold text-ink" : "text-ink-muted",
                  )}
                >
                  {link.label}
                </a>
              </li>
            );
          })}
        </ul>
      </nav>
    );
  },
});

/* ------------------------------------------------------------------ media */

/**
 * An image from the asset library (MASTER.md §32 block list, §36, §5).
 *
 * The first block with a `resolve` step, and the reason that hook exists: what
 * this renders is not in the block's props. The props name an asset; the URLs,
 * the renditions and the intrinsic size come from core/media at render time,
 * so replacing a file updates every page that shows it without touching a
 * single block tree.
 *
 * The markup is the §36 checklist made concrete: `<picture>` with AVIF then
 * WebP then the original, `srcset` so the browser picks a width, `loading` and
 * `decoding` set for lazy rendering, and intrinsic `width`/`height` so the
 * page reserves space and does not reflow when the image lands.
 *
 * Alt text lives on the *asset*, not the block: it describes the image, and
 * copying it onto every block that uses the picture is how it drifts. §5
 * requires it on public images, so a missing one is a visible gap in the media
 * library rather than something a page can quietly omit.
 */
export const image = defineBlock({
  type: "image",
  labelKey: "cms.block.image",
  contexts: ["page", "chrome"],
  schema: z.object({
    assetId: z.string().uuid().optional(),
    /** Overrides the asset's own description where the context needs it to. */
    alt: z.string().optional(),
    width: z.enum(["column", "wide", "full"]).default("column"),
    rounded: z.boolean().default(true),
  }),
  starter: () => ({}),
  fieldHints: { assetId: { control: "asset" } },
  // Imported lazily so the block library does not drag core/media into every
  // bundle that only needs a heading.
  resolve: async (props) => {
    if (!props.assetId) return null;
    const { resolveImage } = await import("@/core/media/service");
    return resolveImage.call({ id: props.assetId }, { kind: "anonymous" });
  },
  render: ({ props, resolved }) => {
    if (!resolved) return null;
    const alt = props.alt ?? resolved.altText ?? "";
    return (
      <picture>
        {resolved.sources.map((source) => (
          <source key={source.format} srcSet={source.srcset} type={source.type} />
        ))}
        <img
          src={resolved.src}
          alt={alt}
          width={resolved.width ?? undefined}
          height={resolved.height ?? undefined}
          loading="lazy"
          decoding="async"
          className={cx(
            "h-auto max-w-full",
            props.rounded && "rounded-lg",
            props.width === "wide" && "w-full",
            props.width === "full" && "w-full",
          )}
        />
      </picture>
    );
  },
});

/* -------------------------------------------------------------- locations */

/**
 * The business's address, phone and hours (MASTER.md §4.10).
 *
 * The block owns *what to show*; it owns nothing about *how the address
 * reads*. Every string it renders comes from `renderNAP`, which is §4.10's
 * exact-match rule made structural: this block, the contact page and the
 * JSON-LD builder all call one formatter, so the address a visitor copies
 * into a search box is character-for-character the one a crawler compares
 * against a directory listing.
 *
 * Renders nothing at all when there is no location — §4.10: "a purely online
 * creator skips this and no empty local scaffolding appears". Not a message
 * saying an address has not been set: that is scaffolding, and it would be
 * on the live site for every business that never intends to have one.
 */
export const nap = defineBlock({
  type: "nap",
  labelKey: "cms.block.nap",
  // Available in chrome as well as pages, because the footer is where a NAP
  // most often lives and the footer is chrome.
  contexts: ["page", "chrome"],
  schema: z.object({
    /** Empty means the primary location — the usual case, and the default. */
    locationId: z.string().nullish(),
    showAddress: z.boolean().default(true),
    showPhone: z.boolean().default(true),
    showEmail: z.boolean().default(false),
    showHours: z.boolean().default(false),
    /**
     * §4.10's go-to-customer case: the business has an address on file for
     * tax and shipping, and does not want visitors arriving at it.
     */
    hideStreetAddress: z.boolean().default(false),
  }),
  starter: () => ({}),
  fieldHints: { locationId: { hidden: true } },
  resolve: async (props) => {
    const { getLocation, primaryLocation } = await import(
      "@/core/locations/service"
    );
    const anonymous = { kind: "anonymous" } as const;
    if (props.locationId) {
      return getLocation.call({ id: props.locationId }, anonymous);
    }
    const primary = await primaryLocation.call({}, anonymous);
    if (!primary) return null;
    return getLocation.call({ id: primary.id }, anonymous);
  },
  render: ({ props, ctx, resolved }) => {
    if (!resolved) return null;

    const nap = renderNAP(resolved, { hideAddress: props.hideStreetAddress });
    const weekly = props.showHours
      ? resolved.hours
          .filter((row) => row.weekday !== null)
          .sort((a, b) => (a.weekday ?? 0) - (b.weekday ?? 0))
      : [];

    // schema.org's own vocabulary is emitted elsewhere; what a visitor reads
    // is a real address element, which is the semantic tag for exactly this.
    return (
      <address className="grid gap-1.5 not-italic text-sm text-ink-muted">
        <span className="font-semibold text-ink">{nap.name}</span>
        {props.showAddress && nap.addressLines.length > 0 ? (
          <span className="grid">
            {nap.addressLines.map((line) => (
              <span key={line}>{line}</span>
            ))}
          </span>
        ) : null}
        {props.showPhone && nap.phone ? (
          <a href={nap.phoneHref ?? undefined} className="text-ink-muted">
            {nap.phone}
          </a>
        ) : null}
        {props.showEmail && nap.email ? (
          <a href={`mailto:${nap.email}`} className="text-ink-muted">
            {nap.email}
          </a>
        ) : null}
        {weekly.length > 0 ? (
          <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
            {weekly.map((row) => (
              <Fragment key={row.id}>
                <dt>{weekdayName(row.weekday!, ctx.locale)}</dt>
                <dd>
                  {row.closed
                    ? ctx.t("cms.nap.closed")
                    : `${row.opens?.slice(0, 5)}–${row.closes?.slice(0, 5)}`}
                </dd>
              </Fragment>
            ))}
          </dl>
        ) : null}
      </address>
    );
  },
});

/**
 * The day's name in the visitor's language.
 *
 * `Intl` rather than seven catalog keys: the platform would be restating what
 * every runtime already knows, and getting it wrong for the first locale
 * somebody adds without translating. 2024-01-07 was a Sunday, which makes the
 * arithmetic below index 0 = Sunday, matching the column.
 */
function weekdayName(weekday: number, locale: string): string {
  const date = new Date(Date.UTC(2024, 0, 7 + weekday));
  return new Intl.DateTimeFormat(locale, {
    weekday: "long",
    timeZone: "UTC",
  }).format(date);
}

/**
 * The index of every location (§4.10, §5's RIBA rule).
 *
 * "Multi-location businesses get /locations/ as a root-linked index page with
 * each location one hop below — RIBA-compliant by construction." This block is
 * the "root-linked" half: it lists what exists now, so a location added today
 * is linked from the index without anyone editing the index. §5's "no orphan
 * pages: publishing anything automatically links it from its section index" is
 * a promise a hand-maintained list cannot keep.
 */
export const locationsIndex = defineBlock({
  type: "locationsIndex",
  labelKey: "cms.block.locationsIndex",
  contexts: ["page"],
  schema: z.object({
    showAddress: z.boolean().default(true),
  }),
  starter: () => ({}),
  resolve: async () => {
    const { listLocations } = await import("@/core/locations/service");
    return listLocations.call({}, { kind: "anonymous" });
  },
  render: ({ props, resolved }) => {
    if (!resolved || resolved.length === 0) return null;
    return (
      <ul className="grid list-none gap-4 p-0">
        {resolved.map((location) => {
          const nap = renderNAP(location);
          return (
            <li key={location.id} className="border-b border-rule pb-4 last:border-0">
              <a
                href={`/locations/${location.slug}`}
                className="font-semibold text-ink"
              >
                {location.name}
              </a>
              {props.showAddress && nap.addressLine ? (
                <address className="mt-1 not-italic text-sm text-ink-muted">
                  {nap.addressLine}
                </address>
              ) : null}
            </li>
          );
        })}
      </ul>
    );
  },
});
