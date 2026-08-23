// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Talent Edition seed — WeVibeSites second certified edition.
//
// Placeholder identity only. Actor / Marlowe / Ambyr / NVC fiction must never
// appear here. The owner replaces this copy with credits they can prove.
import type { BlockNode } from "@/modules/cms/blocks/types";
import type { FormFieldInput } from "@/modules/forms/fields";

export type ImageSlot = "portrait" | "work" | "press";

export interface SeedPage {
  slug: string;
  title: string;
  seo: { title?: string; description?: string };
  blocks: (assets: Record<ImageSlot, string>) => BlockNode[];
}

export const BUSINESS = {
  name: "Your name",
  tagline: "The work. The story. The person.",
  schemaType: "Person",
  country: "US",
  defaultLocale: "en",
  enabledLocales: ["en"],
  baseCurrency: "USD",
  timezone: "America/Los_Angeles",
  units: "imperial" as const,
  firstDayOfWeek: 0,
};

export const LOCATION = {
  name: "Your name",
  slug: "studio",
  street: "100 Example Street",
  unit: "Suite 1",
  city: "Portland",
  region: "OR",
  postalCode: "97204",
  country: "US",
  latitude: 45.515,
  longitude: -122.678,
  phone: "++1-555-0048",
  email: "hello@example.person",
  priceRange: "$$$",
};

export const HOURS = [
  { weekday: 1, opens: "10:00", closes: "18:00" },
  { weekday: 2, opens: "10:00", closes: "18:00" },
  { weekday: 3, opens: "10:00", closes: "18:00" },
  { weekday: 4, opens: "10:00", closes: "18:00" },
  { weekday: 5, opens: "10:00", closes: "16:00" },
  { weekday: 6, closed: true },
  { weekday: 0, closed: true },
];

function gradient(from: string, via: string, to: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="1067">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="0.2" y2="1">
      <stop offset="0%" stop-color="${from}"/>
      <stop offset="55%" stop-color="${via}"/>
      <stop offset="100%" stop-color="${to}"/>
    </linearGradient>
  </defs>
  <rect width="1600" height="1067" fill="url(#g)"/>
  <rect y="720" width="1600" height="2" fill="${from}" opacity="0.4"/>
</svg>`;
}

export const IMAGES: Record<ImageSlot, { filename: string; alt: string; svg: string }> = {
  portrait: {
    filename: "talent-portrait.jpg",
    alt: "A quiet portrait frame with warm side light and an empty chair",
    svg: gradient("#1a1410", "#4a3428", "#d4b48c"),
  },
  work: {
    filename: "talent-work.jpg",
    alt: "A rehearsal table with a marked-up script and a single lamp",
    svg: gradient("#12141c", "#2c3348", "#c9b48a"),
  },
  press: {
    filename: "talent-press.jpg",
    alt: "A stack of printed clippings on a desk beside a closed notebook",
    svg: gradient("#16120e", "#3d3428", "#efe6d6"),
  },
};

const NAV_LINKS = [
  { label: "About", href: "/about" },
  { label: "Work", href: "/work" },
  { label: "Press", href: "/press" },
  { label: "Shop", href: "/shop" },
  { label: "Podcast", href: "/podcast" },
  { label: "Membership", href: "/membership" },
  { label: "Book", href: "/book" },
  { label: "Inquire", href: "/inquire" },
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
    slug: "inquire",
    name: "Work with me",
    submitLabel: "Send inquiry",
    successMessage:
      "Thank you. They will reply from facts they supplied. This form does not book a session or take payment.",
    fields: [
      { key: "full_name", label: "Your name", kind: "text", required: true },
      { key: "email", label: "Email", kind: "email", required: true },
      { key: "project", label: "What is the project?", kind: "multiline", required: true },
      {
        key: "consent_contact",
        label: "They may contact me about this inquiry.",
        kind: "checkbox",
        required: true,
      },
    ],
  },
  {
    slug: "book",
    name: "Session request",
    submitLabel: "Request a session",
    successMessage:
      "Thank you. They will confirm from the sessions they actually offer. This is not a reserved slot.",
    fields: [
      { key: "full_name", label: "Your name", kind: "text", required: true },
      { key: "email", label: "Email", kind: "email", required: true },
      { key: "session", label: "Which session?", kind: "text", required: true },
      { key: "date", label: "Requested date", kind: "text", required: true },
      {
        key: "consent_contact",
        label: "They may contact me to confirm this request.",
        kind: "checkbox",
        required: true,
      },
    ],
  },
  {
    slug: "contact",
    name: "Contact",
    submitLabel: "Send message",
    successMessage: "Thank you. They will reply.",
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
    title: "Your name",
    seo: {
      title: "Your name",
      description:
        "The work, the story, the person. A starting site for a named professional — not a firm wrapper.",
    },
    blocks: (a) => [
      {
        id: "home-h1",
        type: "heading",
        props: { text: "The work. The story. The person.", level: 1, align: "start" },
      },
      {
        id: "home-intro",
        type: "text",
        props: {
          body: "This is a starting site for one named person. Replace the name, credits, press, shop, and sessions with facts you can prove.\n\nDo not invent a credit, a price, or a membership. A request is not a booked session.",
          align: "start",
          measure: true,
        },
      },
      { id: "home-hero", type: "image", props: { assetId: a.portrait, width: "wide", rounded: false } },
      { id: "home-cta", type: "button", props: { label: "Work with me", href: "/inquire", variant: "solid" } },
      { id: "home-about", type: "button", props: { label: "About", href: "/about", variant: "quiet" } },
      { id: "home-work", type: "button", props: { label: "Work", href: "/work", variant: "quiet" } },
      { id: "home-press", type: "button", props: { label: "Press", href: "/press", variant: "quiet" } },
      { id: "home-shop", type: "button", props: { label: "Shop", href: "/shop", variant: "quiet" } },
      { id: "home-pod", type: "button", props: { label: "Podcast", href: "/podcast", variant: "quiet" } },
      { id: "home-mem", type: "button", props: { label: "Membership", href: "/membership", variant: "quiet" } },
      { id: "home-book", type: "button", props: { label: "Book", href: "/book", variant: "quiet" } },
      { id: "home-twin", type: "button", props: { label: "Ask", href: "/twin", variant: "quiet" } },
    ],
  },
  {
    slug: "about",
    title: "About",
    seo: {
      title: "About this person",
      description: "Biography they supplied. No invented credentials.",
    },
    blocks: (a) => [
      { id: "ab-h1", type: "heading", props: { text: "About", level: 1, align: "start" } },
      {
        id: "ab-intro",
        type: "text",
        props: {
          body: "Write the biography they supplied. Do not invent a school, an award, or a role. Missing facts stay off this page.",
          align: "start",
          measure: true,
        },
      },
      { id: "ab-img", type: "image", props: { assetId: a.portrait, width: "wide", rounded: false } },
    ],
  },
  {
    slug: "work",
    title: "Work",
    seo: {
      title: "Work they can prove",
      description: "Credits they supplied. Empty is better than fiction.",
    },
    blocks: (a) => [
      { id: "wk-h1", type: "heading", props: { text: "Work", level: 1, align: "start" } },
      {
        id: "wk-intro",
        type: "text",
        props: {
          body: "List credits they can prove. Title, role, year they named. Do not invent a production.",
          align: "start",
          measure: true,
        },
      },
      { id: "wk-img", type: "image", props: { assetId: a.work, width: "wide", rounded: false } },
    ],
  },
  {
    slug: "press",
    title: "Press",
    seo: {
      title: "Press they consented",
      description: "Items with owner-supplied copy. Empty until they add clips.",
    },
    blocks: (a) => [
      { id: "pr-h1", type: "heading", props: { text: "Press", level: 1, align: "start" } },
      {
        id: "pr-intro",
        type: "text",
        props: {
          body: "Publish only clips they supplied and consented. Leave this page empty rather than invent coverage.",
          align: "start",
          measure: true,
        },
      },
      { id: "pr-img", type: "image", props: { assetId: a.press, width: "wide", rounded: false } },
    ],
  },
  {
    slug: "inquire",
    title: "Inquire",
    seo: {
      title: "Work with me",
      description: "One inquiry form. Does not book a session or take payment.",
    },
    blocks: () => [
      { id: "inq-h1", type: "heading", props: { text: "Work with me", level: 1, align: "start" } },
      {
        id: "inq-intro",
        type: "text",
        props: {
          body: "Tell them about the project. This form qualifies the request. It does not book a session and it does not take payment.",
          align: "start",
          measure: true,
        },
      },
      { id: "inq-form", type: "form", props: { formSlug: "inquire" } },
    ],
  },
  {
    slug: "shop",
    title: "Shop",
    seo: {
      title: "Shop they named",
      description: "Catalog they actually sell. No invented SKUs.",
    },
    blocks: () => [
      { id: "sh-h1", type: "heading", props: { text: "Shop", level: 1, align: "start" } },
      {
        id: "sh-intro",
        type: "text",
        props: {
          body: "List products they named, at prices they set. Live checkout uses their keys. Do not invent a SKU.",
          align: "start",
          measure: true,
        },
      },
    ],
  },
  {
    slug: "podcast",
    title: "Podcast",
    seo: {
      title: "Podcast they supplied",
      description: "Episodes they listed. Missing archive stays empty.",
    },
    blocks: () => [
      { id: "po-h1", type: "heading", props: { text: "Podcast", level: 1, align: "start" } },
      {
        id: "po-intro",
        type: "text",
        props: {
          body: "Publish episodes they supplied. Title, date, and link they named. Do not invent an archive.",
          align: "start",
          measure: true,
        },
      },
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
          body: "Name the tiers they actually sell. Benefits they wrote. Do not invent a club.",
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
      title: "Sessions they offer",
      description: "Availability they sent. A request is not a reserved slot.",
    },
    blocks: () => [
      { id: "bk-h1", type: "heading", props: { text: "Book a session", level: 1, align: "start" } },
      {
        id: "bk-intro",
        type: "text",
        props: {
          body: "Ask for a session they actually offer. A request is not reserved until they confirm.",
          align: "start",
          measure: true,
        },
      },
      { id: "bk-form", type: "form", props: { formSlug: "book" } },
    ],
  },
  {
    slug: "twin",
    title: "Ask",
    seo: {
      title: "Ask this person",
      description: "Answers from facts they approved. No invented credit.",
    },
    blocks: () => [
      { id: "tw-h1", type: "heading", props: { text: "Ask", level: 1, align: "start" } },
      {
        id: "tw-intro",
        type: "text",
        props: {
          body: "The twin answers from facts they approved. It must not invent a credit, a price, or a session. Until those facts exist, this page is a placeholder.",
          align: "start",
          measure: true,
        },
      },
      { id: "tw-cta", type: "button", props: { label: "Work with me", href: "/inquire", variant: "quiet" } },
    ],
  },
  {
    slug: "contact",
    title: "Contact",
    seo: {
      title: "Contact this person",
      description: "Email and hours they supplied. Use Inquire for a project.",
    },
    blocks: () => [
      { id: "ct-h1", type: "heading", props: { text: "Contact", level: 1, align: "start" } },
      {
        id: "ct-intro",
        type: "text",
        props: {
          body: "For a project, use Inquire. For a session, use Book. Use this page for a general message.",
          align: "start",
          measure: true,
        },
      },
      { id: "ct-nap", type: "nap", props: { showAddress: true, showPhone: true, showEmail: true } },
      { id: "ct-form", type: "form", props: { formSlug: "contact" } },
    ],
  },
];
