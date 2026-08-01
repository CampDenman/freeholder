// Copyright (C) 2026 Camp Denman Society
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
import { z } from "zod";
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
  render: ({ props }) => {
    const Tag = `h${props.level}` as const;
    const size = {
      1: "text-4xl sm:text-5xl font-bold tracking-tight text-balance",
      2: "text-2xl sm:text-3xl font-bold tracking-tight text-balance",
      3: "text-xl font-semibold tracking-tight",
      4: "text-base font-semibold",
    }[props.level];
    return (
      <Tag className={cx(size, props.align === "center" && "text-center")}>
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
  render: ({ props }) => (
    <div
      className={cx(
        "grid gap-4 text-ink-muted",
        props.measure && "max-w-prose",
        props.align === "center" && "text-center justify-items-center",
      )}
    >
      {props.body
        .split(/\n{2,}/)
        .map((paragraph) => paragraph.trim())
        .filter(Boolean)
        .map((paragraph, i) => (
          <p key={i}>{paragraph}</p>
        ))}
    </div>
  ),
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
  render: ({ props }) => (
    <a
      href={props.href}
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
