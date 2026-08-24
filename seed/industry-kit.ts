// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Shared kit for WeVibeSites Industry Edition seeds. Packs stay placeholder
// identity. Fiction and live-client brands belong in tests, not this helper.
import type { BlockNode } from "@/modules/cms/blocks/types";
import type { FormFieldInput } from "@/modules/forms/fields";

export type ImageSlot = "hero" | "work" | "desk";

export interface SeedPage {
  slug: string;
  title: string;
  seo: { title?: string; description?: string };
  blocks: (assets: Record<ImageSlot, string>) => BlockNode[];
}

export interface IndustrySeedPage {
  slug: string;
  title: string;
  seoTitle: string;
  seoDesc: string;
  h1: string;
  body: string;
  image?: ImageSlot;
  cta?: { label: string; href: string; variant?: "solid" | "quiet" };
  extraCtas?: Array<{ label: string; href: string }>;
  formSlug?: string;
}

export interface IndustrySeedSpec {
  name: string;
  tagline: string;
  schemaType: string;
  locationSlug: string;
  street: string;
  unit: string;
  email: string;
  priceRange?: string;
  colors: [string, string, string];
  alts: Record<ImageSlot, string>;
  nav: Array<{ label: string; href: string }>;
  pages: IndustrySeedPage[];
  forms: Array<{
    slug: string;
    name: string;
    submitLabel: string;
    successMessage: string;
    fields: FormFieldInput[];
  }>;
}

function gradient(from: string, via: string, to: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="1067">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="0.18" y2="1">
      <stop offset="0%" stop-color="${from}"/>
      <stop offset="55%" stop-color="${via}"/>
      <stop offset="100%" stop-color="${to}"/>
    </linearGradient>
  </defs>
  <rect width="1600" height="1067" fill="url(#g)"/>
  <rect y="720" width="1600" height="2" fill="${from}" opacity="0.35"/>
</svg>`;
}

export function industrySeed(spec: IndustrySeedSpec) {
  const BUSINESS = {
    name: spec.name,
    tagline: spec.tagline,
    schemaType: spec.schemaType,
    country: "US",
    defaultLocale: "en",
    enabledLocales: ["en"],
    baseCurrency: "USD",
    timezone: "America/Los_Angeles",
    units: "imperial" as const,
    firstDayOfWeek: 0,
  };

  const LOCATION = {
    name: spec.name,
    slug: spec.locationSlug,
    street: spec.street,
    unit: spec.unit,
    city: "Portland",
    region: "OR",
    postalCode: "97204",
    country: "US",
    latitude: 45.515,
    longitude: -122.678,
    phone: "++1-555-0048",
    email: spec.email,
    priceRange: spec.priceRange ?? "$$$",
  };

  const HOURS = [
    { weekday: 1, opens: "09:00", closes: "17:00" },
    { weekday: 2, opens: "09:00", closes: "17:00" },
    { weekday: 3, opens: "09:00", closes: "17:00" },
    { weekday: 4, opens: "09:00", closes: "17:00" },
    { weekday: 5, opens: "09:00", closes: "16:00" },
    { weekday: 6, closed: true },
    { weekday: 0, closed: true },
  ];

  const [from, via, to] = spec.colors;
  const IMAGES: Record<ImageSlot, { filename: string; alt: string; svg: string }> = {
    hero: { filename: "seed-hero.jpg", alt: spec.alts.hero, svg: gradient(from, via, to) },
    work: { filename: "seed-work.jpg", alt: spec.alts.work, svg: gradient(via, from, to) },
    desk: { filename: "seed-desk.jpg", alt: spec.alts.desk, svg: gradient(from, to, via) },
  };

  function header(): BlockNode[] {
    return [
      {
        id: "seed-header",
        type: "columns",
        props: { count: 2, gap: "normal" },
        children: [
          { id: "seed-header-brand", type: "brand", props: { href: "/", showTagline: true } },
          { id: "seed-header-nav", type: "nav", props: { links: spec.nav, ariaLabelKey: "cms.nav.primary" } },
        ],
      },
    ];
  }

  function footer(): BlockNode[] {
    return [
      {
        id: "seed-footer",
        type: "columns",
        props: { count: 2, gap: "normal" },
        children: [
          { id: "seed-footer-nap", type: "nap", props: { showAddress: true, showPhone: true, showEmail: true } },
          { id: "seed-footer-nav", type: "nav", props: { links: spec.nav, ariaLabelKey: "cms.nav.primary" } },
        ],
      },
    ];
  }

  const PAGES: SeedPage[] = spec.pages.map((page) => ({
    slug: page.slug,
    title: page.title,
    seo: { title: page.seoTitle, description: page.seoDesc },
    blocks: (assets) => {
      const nodes: BlockNode[] = [
        {
          id: `${page.slug || "home"}-h1`,
          type: "heading",
          props: { text: page.h1, level: 1, align: "start" },
        },
        {
          id: `${page.slug || "home"}-intro`,
          type: "text",
          props: { body: page.body, align: "start", measure: true },
        },
      ];
      if (page.image) {
        nodes.push({
          id: `${page.slug || "home"}-img`,
          type: "image",
          props: { assetId: assets[page.image], width: "wide", rounded: false },
        });
      }
      if (page.cta) {
        nodes.push({
          id: `${page.slug || "home"}-cta`,
          type: "button",
          props: {
            label: page.cta.label,
            href: page.cta.href,
            variant: page.cta.variant ?? "solid",
          },
        });
      }
      for (const [i, extra] of (page.extraCtas ?? []).entries()) {
        nodes.push({
          id: `${page.slug || "home"}-x${i}`,
          type: "button",
          props: { label: extra.label, href: extra.href, variant: "quiet" },
        });
      }
      if (page.formSlug) {
        nodes.push({
          id: `${page.slug || "home"}-form`,
          type: "form",
          props: { formSlug: page.formSlug },
        });
      }
      return nodes;
    },
  }));

  return {
    BUSINESS,
    LOCATION,
    HOURS,
    IMAGES,
    header,
    footer,
    FORMS: spec.forms,
    TRANSLATIONS: [] as Array<{
      slug: string;
      locale: string;
      title: string;
      seo: { title: string; description: string };
      blocks: (assets: Record<ImageSlot, string>) => BlockNode[];
    }>,
    PAGES,
  };
}

export function inquiryForm(
  slug: string,
  name: string,
  submitLabel: string,
  successMessage: string,
  extraFields: FormFieldInput[] = [],
) {
  return {
    slug,
    name,
    submitLabel,
    successMessage,
    fields: [
      { key: "full_name", label: "Your name", kind: "text" as const, required: true },
      { key: "email", label: "Email", kind: "email" as const, required: true },
      ...extraFields,
      { key: "message", label: "How can they help?", kind: "multiline" as const, required: true },
      {
        key: "consent_contact",
        label: "They may contact me about this request.",
        kind: "checkbox" as const,
        required: true,
      },
    ],
  };
}

export function contactForm(successMessage: string) {
  return inquiryForm("contact", "Contact", "Send message", successMessage, []);
}
