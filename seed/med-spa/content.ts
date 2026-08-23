// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Med Spa Edition seed — WeVibeSites third certified edition.
//
// Placeholder identity only. Lumière / NVC fiction must never appear here.
// Treatments, prices, and results publish only from facts the owner supplies.
import type { BlockNode } from "@/modules/cms/blocks/types";
import type { FormFieldInput } from "@/modules/forms/fields";

export type ImageSlot = "lobby" | "treatment" | "results";

export interface SeedPage {
  slug: string;
  title: string;
  seo: { title?: string; description?: string };
  blocks: (assets: Record<ImageSlot, string>) => BlockNode[];
}

export const BUSINESS = {
  name: "Your Med Spa",
  tagline: "Treatments they actually offer. Results they consented.",
  schemaType: "MedicalBusiness",
  country: "US",
  defaultLocale: "en",
  enabledLocales: ["en"],
  baseCurrency: "USD",
  timezone: "America/Los_Angeles",
  units: "imperial" as const,
  firstDayOfWeek: 0,
};

export const LOCATION = {
  name: "Your Med Spa",
  slug: "clinic",
  street: "200 Example Avenue",
  unit: "Suite 100",
  city: "Portland",
  region: "OR",
  postalCode: "97205",
  country: "US",
  latitude: 45.52,
  longitude: -122.68,
  phone: "++1-555-0048",
  email: "hello@example.medspa",
  priceRange: "$$$",
};

export const HOURS = [
  { weekday: 1, opens: "09:00", closes: "17:00" },
  { weekday: 2, opens: "09:00", closes: "17:00" },
  { weekday: 3, opens: "09:00", closes: "17:00" },
  { weekday: 4, opens: "09:00", closes: "17:00" },
  { weekday: 5, opens: "09:00", closes: "16:00" },
  { weekday: 6, opens: "10:00", closes: "14:00" },
  { weekday: 0, closed: true },
];

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

export const IMAGES: Record<ImageSlot, { filename: string; alt: string; svg: string }> = {
  lobby: {
    filename: "medspa-lobby.jpg",
    alt: "A quiet clinic lobby with a low table, linen chairs, and morning light",
    svg: gradient("#2a2420", "#6b5348", "#e8d5c4"),
  },
  treatment: {
    filename: "medspa-treatment.jpg",
    alt: "A treatment room with a made table and a folded towel on a side stand",
    svg: gradient("#1f1c1a", "#4a3d38", "#f0e6dc"),
  },
  results: {
    filename: "medspa-results.jpg",
    alt: "An empty results wall with two unmarked frames and even gallery light",
    svg: gradient("#161412", "#3a3330", "#d9cfc6"),
  },
};

const NAV_LINKS = [
  { label: "Treatments", href: "/treatments" },
  { label: "Providers", href: "/providers" },
  { label: "Results", href: "/results" },
  { label: "Membership", href: "/membership" },
  { label: "Book", href: "/book" },
  { label: "Education", href: "/education" },
  { label: "Ask", href: "/twin" },
  { label: "Contact", href: "/contact" },
];

export function header(): BlockNode[] {
  return [
    {
      id: "seed-header",
      type: "columns",
      props: { count: 2, gap: "normal" },
      children: [
        { id: "seed-header-brand", type: "brand", props: { href: "/", showTagline: true } },
        { id: "seed-header-nav", type: "nav", props: { links: NAV_LINKS, ariaLabelKey: "cms.nav.primary" } },
      ],
    },
  ];
}

export function footer(): BlockNode[] {
  return [
    {
      id: "seed-footer",
      type: "columns",
      props: { count: 2, gap: "normal" },
      children: [
        {
          id: "seed-footer-nap",
          type: "nap",
          props: { showAddress: true, showPhone: true, showEmail: true },
        },
        {
          id: "seed-footer-nav",
          type: "nav",
          props: { links: NAV_LINKS, ariaLabelKey: "cms.nav.primary" },
        },
      ],
    },
  ];
}

export const FORMS: Array<{
  slug: string;
  name: string;
  submitLabel: string;
  successMessage: string;
  fields: FormFieldInput[];
}> = [
  {
    slug: "consultation",
    name: "Consultation request",
    submitLabel: "Request a consultation",
    successMessage:
      "Thank you. The practice will review this. This form does not diagnose or promise an outcome.",
    fields: [
      { key: "full_name", label: "Your name", kind: "text", required: true },
      { key: "email", label: "Email", kind: "email", required: true },
      { key: "phone", label: "Phone", kind: "tel", required: true },
      { key: "interest", label: "What would you like to discuss?", kind: "multiline", required: true },
      {
        key: "consent_contact",
        label: "The practice may contact me about this request. I understand this is not a diagnosis.",
        kind: "checkbox",
        required: true,
      },
    ],
  },
  {
    slug: "contact",
    name: "Contact",
    submitLabel: "Send message",
    successMessage: "Thank you. The practice will reply.",
    fields: [
      { key: "full_name", label: "Your name", kind: "text", required: true },
      { key: "email", label: "Email", kind: "email", required: true },
      { key: "message", label: "How can they help?", kind: "multiline", required: true },
    ],
  },
];

export const TRANSLATIONS: Array<{
  slug: string;
  locale: string;
  title: string;
  seo: { title: string; description: string };
  blocks: (assets: Record<ImageSlot, string>) => BlockNode[];
}> = [];

export const PAGES: SeedPage[] = [
  {
    slug: "",
    title: "Your Med Spa",
    seo: {
      title: "Your Med Spa",
      description:
        "Treatments they actually offer and results they consented. A starting site, not a diagnosis.",
    },
    blocks: (a) => [
      {
        id: "home-h1",
        type: "heading",
        props: { text: "Treatments they offer. Results they consented.", level: 1, align: "start" },
      },
      {
        id: "home-intro",
        type: "text",
        props: {
          body: "This is a starting site for a real med spa. Replace the name, menu, providers, and photos with facts you can stand behind.\n\nA consultation request is not a diagnosis and not a promised result.",
          align: "start",
          measure: true,
        },
      },
      { id: "home-hero", type: "image", props: { assetId: a.lobby, width: "wide", rounded: false } },
      { id: "home-cta", type: "button", props: { label: "Request a consultation", href: "/book", variant: "solid" } },
      { id: "home-treat", type: "button", props: { label: "Treatments", href: "/treatments", variant: "quiet" } },
      { id: "home-prov", type: "button", props: { label: "Providers", href: "/providers", variant: "quiet" } },
      { id: "home-res", type: "button", props: { label: "Results", href: "/results", variant: "quiet" } },
      { id: "home-mem", type: "button", props: { label: "Membership", href: "/membership", variant: "quiet" } },
      { id: "home-edu", type: "button", props: { label: "Education", href: "/education", variant: "quiet" } },
      { id: "home-ask", type: "button", props: { label: "Ask the practice", href: "/twin", variant: "quiet" } },
    ],
  },
  {
    slug: "treatments",
    title: "Treatments",
    seo: {
      title: "Treatments they named",
      description: "Menu they actually offer, at prices they set. No invented menu.",
    },
    blocks: (a) => [
      { id: "tr-h1", type: "heading", props: { text: "Treatments", level: 1, align: "start" } },
      {
        id: "tr-intro",
        type: "text",
        props: {
          body: "List treatments they named, with prices they set. Do not invent a menu item or a result.",
          align: "start",
          measure: true,
        },
      },
      { id: "tr-img", type: "image", props: { assetId: a.treatment, width: "wide", rounded: false } },
      { id: "tr-cta", type: "button", props: { label: "Request a consultation", href: "/book", variant: "solid" } },
    ],
  },
  {
    slug: "providers",
    title: "Providers",
    seo: {
      title: "Providers they can prove",
      description: "Credentials they supplied. No invented license.",
    },
    blocks: () => [
      { id: "pv-h1", type: "heading", props: { text: "Providers", level: 1, align: "start" } },
      {
        id: "pv-intro",
        type: "text",
        props: {
          body: "Name the people who work here. Use licenses and credentials they can prove. Do not invent a qualification.",
          align: "start",
          measure: true,
        },
      },
    ],
  },
  {
    slug: "results",
    title: "Results",
    seo: {
      title: "Results they consented",
      description: "Photos publish only with recorded consent. Empty until they add cases.",
    },
    blocks: (a) => [
      { id: "re-h1", type: "heading", props: { text: "Results", level: 1, align: "start" } },
      {
        id: "re-intro",
        type: "text",
        props: {
          body: "Publish only photographs with recorded consent. Leave this page empty rather than use another clinic's gallery. Results are not a guaranteed outcome.",
          align: "start",
          measure: true,
        },
      },
      { id: "re-img", type: "image", props: { assetId: a.results, width: "wide", rounded: false } },
    ],
  },
  {
    slug: "membership",
    title: "Membership",
    seo: {
      title: "Membership they sell",
      description: "Tiers they named. Missing club stays empty.",
    },
    blocks: () => [
      { id: "me-h1", type: "heading", props: { text: "Membership", level: 1, align: "start" } },
      {
        id: "me-intro",
        type: "text",
        props: {
          body: "Name the memberships they actually sell. Benefits they wrote. Do not invent a club.",
          align: "start",
          measure: true,
        },
      },
    ],
  },
  {
    slug: "book",
    title: "Book",
    seo: {
      title: "Request a consultation",
      description: "Qualifies the visit. Not a diagnosis and not a promised result.",
    },
    blocks: () => [
      { id: "bk-h1", type: "heading", props: { text: "Request a consultation", level: 1, align: "start" } },
      {
        id: "bk-intro",
        type: "text",
        props: {
          body: "Tell the practice what you want to discuss. This form does not diagnose, prescribe, or promise an outcome.",
          align: "start",
          measure: true,
        },
      },
      { id: "bk-form", type: "form", props: { formSlug: "consultation" } },
    ],
  },
  {
    slug: "education",
    title: "Education",
    seo: {
      title: "Education they approved",
      description: "Clinical copy they signed off. No invented claims.",
    },
    blocks: () => [
      { id: "ed-h1", type: "heading", props: { text: "Education", level: 1, align: "start" } },
      {
        id: "ed-intro",
        type: "text",
        props: {
          body: "Publish education the owner approved. Do not invent a clinical claim. This page is not a diagnosis.",
          align: "start",
          measure: true,
        },
      },
    ],
  },
  {
    slug: "twin",
    title: "Ask the practice",
    seo: {
      title: "Ask the practice",
      description: "Answers from approved treatment copy. Never diagnoses.",
    },
    blocks: () => [
      { id: "tw-h1", type: "heading", props: { text: "Ask the practice", level: 1, align: "start" } },
      {
        id: "tw-intro",
        type: "text",
        props: {
          body: "The twin answers from treatment copy they approved. It must not diagnose or promise a result. Until those facts exist, this page is a placeholder.",
          align: "start",
          measure: true,
        },
      },
      { id: "tw-cta", type: "button", props: { label: "Request a consultation", href: "/book", variant: "quiet" } },
    ],
  },
  {
    slug: "contact",
    title: "Contact",
    seo: {
      title: "Contact the practice",
      description: "Phone, email, and hours they supplied. Use Book for a consultation.",
    },
    blocks: () => [
      { id: "ct-h1", type: "heading", props: { text: "Contact", level: 1, align: "start" } },
      {
        id: "ct-intro",
        type: "text",
        props: {
          body: "For a consultation, use Book. Use this page for hours, parking, or a general message.",
          align: "start",
          measure: true,
        },
      },
      { id: "ct-nap", type: "nap", props: { showAddress: true, showPhone: true, showEmail: true } },
      { id: "ct-form", type: "form", props: { formSlug: "contact" } },
    ],
  },
];
