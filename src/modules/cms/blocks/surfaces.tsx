// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Trust, conversion and gated blocks (MASTER.md C2.08–C2.10, §32).
import { z } from "zod";
import { formatMoney } from "@/core/i18n";
import { ShareCopyButton } from "@/ui/ShareCopyButton";
import { submitInboundAction } from "../../../../app/(public)/inbound-actions";
import { SiteChatClient } from "./SiteChatClient";
import { defineBlock } from "./types";
import { socialEmbed } from "./social";
import {
  previewChildCount,
  selectPreviewChildren,
} from "@/core/paywalls/evaluate";

const href = z.string().trim().min(1).max(2048);

/* ---------------------------------------------------------------- C2.08 */

export const testimonial = defineBlock({
  type: "testimonial",
  labelKey: "cms.block.testimonial",
  contexts: ["page"],
  schema: z.object({
    quote: z.string().min(1).max(2000),
    name: z.string().min(1).max(120),
    role: z.string().max(160).optional(),
  }),
  starter: () => ({
    quote: "They made the day feel easy.",
    name: "A client",
    role: "Wedding",
  }),
  render: ({ props }) => (
    <figure className="grid max-w-prose gap-3 border-s-2 border-accent ps-4">
      <blockquote className="text-lg text-ink">
        <p>{props.quote}</p>
      </blockquote>
      <figcaption className="text-sm text-ink-muted">
        {props.name}
        {props.role ? ` · ${props.role}` : ""}
      </figcaption>
    </figure>
  ),
  jsonLd: (props) => ({
    "@context": "https://schema.org",
    "@type": "Review",
    reviewBody: props.quote,
    author: { "@type": "Person", name: props.name },
  }),
});

export const gallery = defineBlock({
  type: "gallery",
  labelKey: "cms.block.gallery",
  contexts: ["page"],
  schema: z.object({
    items: z
      .array(z.object({ assetId: z.string().uuid(), caption: z.string().max(200).optional() }))
      .min(1)
      .max(24),
  }),
  starter: () => ({
    items: [{ assetId: "00000000-0000-4000-8000-000000000000", caption: "" }],
  }),
  resolve: async (props) => {
    const { resolveImage } = await import("@/core/media/service");
    const rows = await Promise.all(
      props.items.map(async (item) => ({
        item,
        image: await resolveImage.call({ id: item.assetId }, { kind: "anonymous" }),
      })),
    );
    return rows.filter((row) => row.image);
  },
  render: ({ resolved }) => {
    if (!resolved || resolved.length === 0) return null;
    return (
      <ul className="grid list-none grid-cols-2 gap-3 p-0 sm:grid-cols-3">
        {resolved.map(({ item, image }) => (
          <li key={item.assetId}>
            <figure>
              <picture>
                {image!.sources.map((source) => (
                  <source key={source.format} srcSet={source.srcset} type={source.type} />
                ))}
                <img
                  src={image!.src}
                  alt={item.caption || image!.altText || ""}
                  width={image!.width ?? undefined}
                  height={image!.height ?? undefined}
                  loading="lazy"
                  decoding="async"
                  className="h-auto w-full rounded-lg"
                />
              </picture>
              {item.caption ? (
                <figcaption className="mt-1 text-xs text-ink-muted">{item.caption}</figcaption>
              ) : null}
            </figure>
          </li>
        ))}
      </ul>
    );
  },
});

export const map = defineBlock({
  type: "map",
  labelKey: "cms.block.map",
  contexts: ["page", "chrome"],
  schema: z.object({
    locationId: z.string().uuid().optional(),
  }),
  starter: () => ({}),
  resolve: async (props) => {
    const { getLocation, primaryLocation } = await import("@/core/locations/service");
    if (props.locationId) {
      return getLocation.call({ id: props.locationId }, { kind: "anonymous" });
    }
    return primaryLocation.call({}, { kind: "anonymous" });
  },
  render: ({ resolved, ctx }) => {
    if (!resolved?.latitude || !resolved.longitude) return null;
    const lat = Number(resolved.latitude);
    const lon = Number(resolved.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
    const pad = 0.02;
    const src = `https://www.openstreetmap.org/export/embed.html?bbox=${lon - pad}%2C${lat - pad}%2C${lon + pad}%2C${lat + pad}&layer=mapnik&marker=${lat}%2C${lon}`;
    return (
      <iframe
        title={resolved.name || ctx.t("cms.block.map")}
        src={src}
        className="h-64 w-full rounded-lg border border-rule"
        loading="lazy"
        referrerPolicy="no-referrer-when-downgrade"
      />
    );
  },
});

export const social = defineBlock({
  type: "social",
  labelKey: "cms.block.social",
  contexts: ["page"],
  schema: z.object({
    url: z.string().url(),
    title: z.string().max(120).optional(),
  }),
  starter: () => ({ url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ" }),
  render: ({ props }) => {
    const embed = socialEmbed(props.url);
    if (!embed) return null;
    return (
      <figure className="grid gap-2">
        {props.title ? <figcaption className="text-sm font-semibold text-ink">{props.title}</figcaption> : null}
        <div className="relative w-full" style={{ aspectRatio: "16 / 9" }}>
          <iframe
            title={props.title || embed.provider}
            src={embed.src}
            className="absolute inset-0 h-full w-full rounded-lg border border-rule"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
            loading="lazy"
            referrerPolicy="strict-origin-when-cross-origin"
          />
        </div>
      </figure>
    );
  },
});

export const share = defineBlock({
  type: "share",
  labelKey: "cms.block.share",
  contexts: ["page", "chrome"],
  schema: z.object({
    label: z.string().min(1).max(80).default("Share"),
  }),
  starter: () => ({ label: "Share" }),
  render: ({ props, ctx }) => {
    const path = ctx.path === "" ? "/" : ctx.path.startsWith("/") ? ctx.path : `/${ctx.path}`;
    const localized = ctx.localizeHref?.(path) ?? path;
    return (
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-semibold text-ink">{props.label}</span>
        <ShareCopyButton
          url={localized}
          label={ctx.t("cms.share.copy")}
          copiedLabel={ctx.t("cms.share.copied")}
        />
        <a
          href={`mailto:?subject=${encodeURIComponent(ctx.business?.name ?? "")}&body=${encodeURIComponent(localized)}`}
          className="rounded-md border border-rule px-3 py-1.5 text-sm font-medium text-ink"
        >
          {ctx.t("cms.share.email")}
        </a>
      </div>
    );
  },
});

// The knowledge block moved to ./help.tsx when C8.12 turned it from a slug
// listing into the help centre proper.

/* ---------------------------------------------------------------- C2.09 */

export const productCard = defineBlock({
  type: "productCard",
  labelKey: "cms.block.productCard",
  contexts: ["page"],
  schema: z.object({
    slug: z.string().min(1),
  }),
  starter: () => ({ slug: "product" }),
  resolve: async (props) => {
    const { resolveVisibleProduct } = await import("@/modules/catalog/service");
    return resolveVisibleProduct.call({ slug: props.slug }, { kind: "anonymous" });
  },
  render: ({ resolved, ctx }) => {
    if (!resolved) return null;
    const href = ctx.localizeHref?.(`/products/${resolved.slug}`) ?? `/products/${resolved.slug}`;
    return (
      <article className="grid gap-2 rounded-lg border border-rule p-4">
        <h2 className="text-lg font-bold tracking-tight text-ink">
          <a href={href}>{resolved.name}</a>
        </h2>
        {resolved.subtitle ? <p className="text-sm text-ink-muted">{resolved.subtitle}</p> : null}
        <a href={href} className="text-sm font-semibold text-accent">
          {ctx.t("cms.productCard.view")}
        </a>
      </article>
    );
  },
});

export const booking = defineBlock({
  type: "booking",
  labelKey: "cms.block.booking",
  contexts: ["page"],
  schema: z.object({
    slug: z.string().min(1),
    ctaHref: href.default("/contact"),
  }),
  starter: () => ({ slug: "session", ctaHref: "/contact" }),
  resolve: async (props) => {
    const { resolveVisibleProduct } = await import("@/modules/catalog/service");
    const product = await resolveVisibleProduct.call({ slug: props.slug }, { kind: "anonymous" });
    if (!product) return null;
    const { getServiceOffering } = await import("@/modules/catalog/offerings");
    const offering = await getServiceOffering.call({ productId: product.id }, { kind: "anonymous" });
    return { product, offering };
  },
  render: ({ props, resolved, ctx }) => {
    if (!resolved) return null;
    return (
      <article className="grid gap-3 rounded-lg border border-rule p-4">
        <h2 className="text-lg font-bold tracking-tight text-ink">{resolved.product.name}</h2>
        {resolved.product.subtitle ? (
          <p className="text-sm text-ink-muted">{resolved.product.subtitle}</p>
        ) : null}
        {resolved.offering ? (
          <p className="text-sm text-ink-muted">
            {ctx.t("cms.booking.duration", { minutes: resolved.offering.durationMin })}
          </p>
        ) : null}
        <p className="text-sm text-ink-muted">{ctx.t("cms.booking.noCalendar")}</p>
        <a
          href={ctx.localizeHref?.(props.ctaHref) ?? props.ctaHref}
          className="inline-flex w-fit rounded-md bg-accent px-4 py-2 text-sm font-semibold text-on-accent"
        >
          {ctx.t("cms.booking.request")}
        </a>
      </article>
    );
  },
});

export const quoteRequest = defineBlock({
  type: "quoteRequest",
  labelKey: "cms.block.quoteRequest",
  contexts: ["page"],
  schema: z.object({}),
  starter: () => ({}),
  render: ({ ctx }) => {
    if (ctx.query?.quoted === "1") {
      return (
        <p role="status" className="max-w-prose rounded-md border border-rule bg-success-soft px-4 py-3 text-sm text-success">
          {ctx.t("cms.inbound.quoteThanks")}
        </p>
      );
    }
    return (
      <form action={submitInboundAction} className="grid max-w-prose gap-3">
        <input type="hidden" name="kind" value="quote" />
        <InboundFields t={ctx.t} />
        <button type="submit" className="w-fit rounded-md bg-accent px-4 py-2 text-sm font-semibold text-on-accent">
          {ctx.t("cms.inbound.sendQuote")}
        </button>
      </form>
    );
  },
});

export const tip = defineBlock({
  type: "tip",
  labelKey: "cms.block.tip",
  contexts: ["page"],
  schema: z.object({
    currency: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/).default("USD"),
    amounts: z.array(z.object({ amountMinor: z.number().int().positive() })).min(1).max(6),
  }),
  starter: () => ({
    currency: "USD",
    amounts: [{ amountMinor: 500 }, { amountMinor: 1000 }, { amountMinor: 2000 }],
  }),
  render: ({ props, ctx }) => {
    if (ctx.query?.tipped === "1") {
      return (
        <p role="status" className="max-w-prose rounded-md border border-rule bg-success-soft px-4 py-3 text-sm text-success">
          {ctx.t("cms.inbound.tipThanks")}
        </p>
      );
    }
    return (
      <form action={submitInboundAction} className="grid max-w-md gap-3">
        <input type="hidden" name="kind" value="tip" />
        <input type="hidden" name="currency" value={props.currency} />
        <label className="grid gap-1 text-sm">
          <span className="font-semibold text-ink">{ctx.t("cms.inbound.email")}</span>
          <input type="email" name="email" required className="rounded-md border border-rule bg-field px-3 py-2 text-ink" />
        </label>
        <fieldset className="grid gap-2">
          <legend className="text-sm font-semibold text-ink">{ctx.t("cms.tip.amount")}</legend>
          {props.amounts.map((row) => (
            <label key={row.amountMinor} className="flex items-center gap-2 text-sm text-ink">
              <input type="radio" name="amountMinor" value={row.amountMinor} required />
              {formatMoney(row.amountMinor, props.currency, ctx.locale)}
            </label>
          ))}
        </fieldset>
        <button type="submit" className="w-fit rounded-md bg-accent px-4 py-2 text-sm font-semibold text-on-accent">
          {ctx.t("cms.tip.send")}
        </button>
      </form>
    );
  },
});

export const siteChat = defineBlock({
  type: "siteChat",
  labelKey: "cms.block.siteChat",
  contexts: ["page"],
  schema: z.object({
    whatsappPhone: z.string().trim().regex(/^\+?[1-9][0-9\s().-]{6,24}$/).optional(),
    messengerUsername: z.string().trim().regex(/^[A-Za-z0-9._-]{2,100}$/).optional(),
    openingMessage: z.string().trim().max(500).optional(),
  }),
  starter: () => ({}),
  fieldHints: {
    openingMessage: { control: "multiline" },
  },
  render: ({ props, ctx }) => {
    const links = [
      props.whatsappPhone
        ? {
            href: whatsappDeepLink(props.whatsappPhone, props.openingMessage),
            label: ctx.t("cms.chat.whatsapp"),
          }
        : null,
      props.messengerUsername
        ? {
            href: messengerDeepLink(props.messengerUsername),
            label: ctx.t("cms.chat.messenger"),
          }
        : null,
    ].filter((link): link is { href: string; label: string } => link !== null);
    const deepLinks = links.length ? (
      <div className="grid max-w-prose gap-2 border-s-2 border-rule ps-3 text-sm">
        <p className="text-ink-muted">{ctx.t("cms.chat.otherApps")}</p>
        <div className="flex flex-wrap gap-3">
          {links.map((link) => (
            <a key={link.href} href={link.href} target="_blank" rel="noreferrer" className="font-semibold underline">
              {link.label}
            </a>
          ))}
        </div>
        <p className="text-xs text-ink-muted">{ctx.t("cms.chat.consentNote")}</p>
      </div>
    ) : null;
    if (ctx.query?.chatted === "1") {
      return (
        <div className="grid gap-4">
          <SiteChatClient
            locale={ctx.locale}
            labels={{
              loading: ctx.t("cms.chat.loading"),
              ended: ctx.t("cms.chat.ended"),
              escalated: ctx.t("cms.chat.escalated"),
              message: ctx.t("cms.inbound.message"),
              send: ctx.t("cms.inbound.sendChat"),
              sending: ctx.t("cms.chat.sending"),
              end: ctx.t("cms.chat.end"),
              fromYou: ctx.t("cms.chat.fromYou"),
              fromBusiness: ctx.t("cms.chat.fromBusiness"),
              fromAssistant: ctx.t("cms.chat.fromAssistant"),
              failed: ctx.t("cms.chat.failed"),
            }}
          />
          {deepLinks}
        </div>
      );
    }
    return (
      <div className="grid gap-4">
        {ctx.query?.inboundError === "1" ? (
          <p role="alert" className="max-w-prose rounded-md border border-danger bg-danger-soft px-4 py-3 text-sm text-danger">
            {ctx.t("cms.chat.failed")}
          </p>
        ) : null}
        <form action={submitInboundAction} className="grid max-w-prose gap-3">
          <input type="hidden" name="kind" value="chat" />
          <label aria-hidden="true" className="absolute -start-[10000px] h-px w-px overflow-hidden">
            <span>{ctx.t("cms.chat.leaveBlank")}</span>
            <input type="text" name="entry_ref" tabIndex={-1} autoComplete="off" />
          </label>
          <InboundFields t={ctx.t} />
          <button type="submit" className="w-fit rounded-md bg-accent px-4 py-2 text-sm font-semibold text-on-accent">
            {ctx.t("cms.inbound.sendChat")}
          </button>
        </form>
        {deepLinks}
      </div>
    );
  },
});

/** External-app links only: following one never writes a Contact or consent row. */
export function whatsappDeepLink(phone: string, openingMessage?: string): string {
  const digits = phone.replace(/\D/g, "");
  const query = openingMessage ? `?text=${encodeURIComponent(openingMessage)}` : "";
  return `https://wa.me/${digits}${query}`;
}

export function messengerDeepLink(username: string): string {
  return `https://m.me/${encodeURIComponent(username)}`;
}

function InboundFields({ t }: { t: (key: string) => string }) {
  return (
    <>
      <label className="grid gap-1 text-sm">
        <span className="font-semibold text-ink">{t("cms.inbound.name")}</span>
        <input type="text" name="name" autoComplete="name" required className="rounded-md border border-rule bg-field px-3 py-2 text-ink" />
      </label>
      <label className="grid gap-1 text-sm">
        <span className="font-semibold text-ink">{t("cms.inbound.email")}</span>
        <input type="email" name="email" autoComplete="email" required className="rounded-md border border-rule bg-field px-3 py-2 text-ink" />
      </label>
      <label className="grid gap-1 text-sm">
        <span className="font-semibold text-ink">{t("cms.inbound.message")}</span>
        <textarea name="message" required rows={4} className="rounded-md border border-rule bg-field px-3 py-2 text-ink" />
      </label>
    </>
  );
}

/* ---------------------------------------------------------------- C2.10 */

type PaywallResolved = {
  allowed: boolean;
  reveal: "all" | "preview" | "none";
  previewStrategy: "blocks" | "paragraphs" | "percent";
  previewValue: number;
};

export const paywall = defineBlock({
  type: "paywall",
  labelKey: "cms.block.paywall",
  contexts: ["page"],
  container: true,
  schema: z.object({
    teaser: z.string().min(1).max(400),
    ctaLabel: z.string().min(1).max(80),
    ctaHref: href,
    paywallId: z.string().uuid().optional(),
  }),
  starter: () => ({
    teaser: "The rest of this page is for supporters.",
    ctaLabel: "Continue",
    ctaHref: "/contact",
  }),
  resolve: async (props, ctx): Promise<PaywallResolved> => {
    if (ctx.identifyBlocks) {
      return { allowed: true, reveal: "all", previewStrategy: "blocks", previewValue: 0 };
    }
    const { evaluatePaywall } = await import("@/core/paywalls/service");
    const decision = await evaluatePaywall.call(
      {
        paywallId: props.paywallId,
        kind: "page",
        selector: ctx.path,
        anonId: ctx.visitorId,
      },
      ctx.actor ?? { kind: "anonymous" },
    );
    // A paywall *block* is a gate even when no Paywall row matches this path.
    // Showing children in that case would leak every C2.10 tree the moment
    // this item shipped. A Paywall row is what makes a grant able to open it.
    if (!decision.gated) {
      return { allowed: false, reveal: "none", previewStrategy: "blocks", previewValue: 0 };
    }
    return {
      allowed: decision.allowed,
      reveal: decision.reveal,
      previewStrategy: decision.previewStrategy,
      previewValue: decision.previewValue,
    };
  },
  includeChildren: ({ ctx, resolved }) =>
    ctx.identifyBlocks === true || resolved.reveal !== "none",
  selectChildren: ({ children, ctx, resolved }) => {
    if (ctx.identifyBlocks || resolved.reveal === "all") return children;
    return selectPreviewChildren(
      children,
      resolved.previewStrategy,
      previewChildCount(children.length, resolved.previewStrategy, resolved.previewValue),
    );
  },
  render: ({ props, ctx, resolved, children }) => {
    if (ctx.identifyBlocks) {
      return <div className="grid gap-4">{children}</div>;
    }
    const showGated = resolved.reveal !== "none";
    return (
      <div className="grid max-w-prose gap-4">
        {showGated ? <div data-paywall-gated className="grid gap-4">{children}</div> : null}
        {resolved.allowed ? null : (
          <aside data-paywall-teaser className="grid gap-3 rounded-lg border border-rule p-4">
            <p className="text-ink">{props.teaser}</p>
            <a
              href={ctx.localizeHref?.(props.ctaHref) ?? props.ctaHref}
              className="inline-flex w-fit rounded-md bg-accent px-4 py-2 text-sm font-semibold text-on-accent"
            >
              {props.ctaLabel}
            </a>
          </aside>
        )}
      </div>
    );
  },
  jsonLd: () => ({
    "@context": "https://schema.org",
    "@type": "WebPageElement",
    isAccessibleForFree: false,
    cssSelector: "[data-paywall-gated]",
  }),
});
