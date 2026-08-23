// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Law Firm Edition seed — WeVibeSites first certified edition.
//
// Placeholder identity only. New Vibe City fiction (Hargrove cast, invented
// verdicts, city lore) must never appear here. The owner replaces this copy
// with their own facts; Grok may draft from approved facts, not invent them.
import type { BlockNode } from "@/modules/cms/blocks/types";
import type { FormFieldInput } from "@/modules/forms/fields";

export type ImageSlot = "library" | "counsel" | "chamber";

export interface SeedPage {
  slug: string;
  title: string;
  seo: { title?: string; description?: string };
  blocks: (assets: Record<ImageSlot, string>) => BlockNode[];
}

export const BUSINESS = {
  name: "Your Law Firm",
  tagline: "Clear counsel. Proven process.",
  schemaType: "LegalService",
  country: "US",
  defaultLocale: "en",
  enabledLocales: ["en"],
  baseCurrency: "USD",
  timezone: "America/Los_Angeles",
  units: "imperial" as const,
  firstDayOfWeek: 0,
};

export const LOCATION = {
  name: "Your Law Firm",
  slug: "office",
  street: "400 Example Avenue",
  unit: "Suite 200",
  city: "Portland",
  region: "OR",
  postalCode: "97204",
  country: "US",
  latitude: 45.515,
  longitude: -122.678,
  phone: "++1-555-0048",
  email: "hello@example.law",
  priceRange: "$$$",
};

export const HOURS = [
  { weekday: 1, opens: "09:00", closes: "17:00" },
  { weekday: 2, opens: "09:00", closes: "17:00" },
  { weekday: 3, opens: "09:00", closes: "17:00" },
  { weekday: 4, opens: "09:00", closes: "17:00" },
  { weekday: 5, opens: "09:00", closes: "16:00" },
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
  library: {
    filename: "firm-library.jpg",
    alt: "Tall shelves of bound volumes in a quiet reading room with a long table",
    svg: gradient("#0f1629", "#1d2a52", "#b8960c"),
  },
  counsel: {
    filename: "firm-counsel.jpg",
    alt: "Two people seated across a desk reviewing a paper file in daylight",
    svg: gradient("#162040", "#3a3340", "#f5f3ee"),
  },
  chamber: {
    filename: "firm-chamber.jpg",
    alt: "An empty hearing room with wood benches facing a raised desk",
    svg: gradient("#1a1814", "#4a4030", "#ede9e1"),
  },
};

const NAV_LINKS = [
  { label: "Practice areas", href: "/practice-areas" },
  { label: "Attorneys", href: "/attorneys" },
  { label: "Results", href: "/results" },
  { label: "Resources", href: "/resources" },
  { label: "Case evaluation", href: "/case-evaluation" },
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
    slug: "case-evaluation",
    name: "Case evaluation",
    submitLabel: "Request an evaluation",
    successMessage:
      "Thank you. A person at the firm will review this and reply. This form does not create an attorney-client relationship.",
    fields: [
      { key: "full_name", label: "Your name", kind: "text", required: true },
      { key: "email", label: "Email", kind: "email", required: true },
      { key: "phone", label: "Phone", kind: "tel" },
      {
        key: "matter_type",
        label: "What kind of matter is this?",
        kind: "select",
        required: true,
        options: [
          "Personal injury",
          "Family law",
          "Criminal defense",
          "Estate or probate",
          "Business or contract",
          "Something else",
        ],
      },
      {
        key: "jurisdiction",
        label: "Where did this happen?",
        kind: "text",
        required: true,
        placeholder: "City, state or province",
        help: "The firm needs a place before it can say whether it can help.",
      },
      {
        key: "what_happened",
        label: "What happened, in your words?",
        kind: "multiline",
        required: true,
        help: "Facts only. Do not include medical record numbers or anyone else's private data.",
      },
      {
        key: "deadline_known",
        label: "Is there a date you were told not to miss?",
        kind: "text",
        placeholder: "A court date, a letter deadline, or unknown",
      },
      {
        key: "consent_contact",
        label:
          "The firm may contact me about this inquiry. I understand this is not legal advice and does not create an attorney-client relationship.",
        kind: "checkbox",
        required: true,
      },
    ],
  },
  {
    slug: "contact",
    name: "Contact",
    submitLabel: "Send message",
    successMessage: "Thank you. Someone at the firm will reply.",
    fields: [
      { key: "full_name", label: "Your name", kind: "text", required: true },
      { key: "email", label: "Email", kind: "email", required: true },
      { key: "message", label: "How can the firm help?", kind: "multiline", required: true },
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
    title: "Your Law Firm",
    seo: {
      title: "Your Law Firm",
      description:
        "Practice areas, attorney credentials, and a confidential case evaluation. This site is not legal advice.",
    },
    blocks: (a) => [
      { id: "home-h1", type: "heading", props: { text: "Clear counsel. Proven process.", level: 1, align: "start" } },
      {
        id: "home-intro",
        type: "text",
        props: {
          body: "This is a starting site for a real firm. Replace the name, the jurisdiction, and the people with facts you can stand behind.\n\nNothing here is legal advice. An evaluation is a conversation, not a promise about the outcome of a matter.",
          align: "start",
          measure: true,
        },
      },
      { id: "home-hero", type: "image", props: { assetId: a.library, width: "wide", rounded: false } },
      { id: "home-cta", type: "button", props: { label: "Request a case evaluation", href: "/case-evaluation", variant: "solid" } },
      { id: "home-rule", type: "divider", props: {} },
      {
        id: "home-cols",
        type: "columns",
        props: { count: 2, gap: "normal" },
        children: [
          {
            id: "home-col-a",
            type: "text",
            props: {
              body: "Name the practice areas you actually handle. Do not list a matter type you will not take.",
              align: "start",
              measure: true,
            },
          },
          {
            id: "home-col-b",
            type: "text",
            props: {
              body: "Publish attorneys with credentials you can prove. Leave a page blank rather than invent a biography.",
              align: "start",
              measure: true,
            },
          },
        ],
      },
    ],
  },
  {
    slug: "practice-areas",
    title: "Practice areas",
    seo: {
      title: "Practice areas we handle",
      description:
        "The kinds of matters this firm reviews. The list is only as wide as the work the firm actually does.",
    },
    blocks: () => [
      { id: "pa-h1", type: "heading", props: { text: "Practice areas", level: 1, align: "start" } },
      {
        id: "pa-intro",
        type: "text",
        props: {
          body: "Add a page for each matter type the firm handles. The personal-injury page is a template, not a claim that this firm takes that work.",
          align: "start",
          measure: true,
        },
      },
      { id: "pa-cta", type: "button", props: { label: "Personal injury template", href: "/practice-areas/personal-injury", variant: "quiet" } },
    ],
  },
  {
    slug: "practice-areas/personal-injury",
    title: "Personal injury",
    seo: {
      title: "Personal injury matters",
      description:
        "What a personal-injury evaluation needs. This page does not promise a recovery or a result.",
    },
    blocks: (a) => [
      { id: "pi-h1", type: "heading", props: { text: "Personal injury", level: 1, align: "start" } },
      {
        id: "pi-intro",
        type: "text",
        props: {
          body: "Use this page only if the firm handles this work. Replace the copy with the jurisdiction, the kinds of injuries you review, and what a visitor should bring to an evaluation.",
          align: "start",
          measure: true,
        },
      },
      { id: "pi-img", type: "image", props: { assetId: a.counsel, width: "wide", rounded: false } },
      {
        id: "pi-note",
        type: "text",
        props: {
          body: "Past results do not guarantee a future outcome. An evaluation is not legal advice and does not create an attorney-client relationship.",
          align: "start",
          measure: true,
        },
      },
      { id: "pi-cta", type: "button", props: { label: "Request an evaluation", href: "/case-evaluation", variant: "solid" } },
    ],
  },
  {
    slug: "attorneys",
    title: "Attorneys",
    seo: {
      title: "Attorneys and credentials",
      description:
        "Named professionals only, with admissions you can prove. Empty is better than invented.",
    },
    blocks: (a) => [
      { id: "at-h1", type: "heading", props: { text: "Attorneys", level: 1, align: "start" } },
      {
        id: "at-intro",
        type: "text",
        props: {
          body: "Add each lawyer by name, role, and bar admission. Include the jurisdiction and the year if you have them. Do not invent a biography or a case history.",
          align: "start",
          measure: true,
        },
      },
      { id: "at-img", type: "image", props: { assetId: a.chamber, width: "wide", rounded: false } },
    ],
  },
  {
    slug: "results",
    title: "Results",
    seo: {
      title: "Published results",
      description:
        "Only outcomes the owner has approved and the client has consented to publish. Past results do not guarantee future ones.",
    },
    blocks: () => [
      { id: "rs-h1", type: "heading", props: { text: "Results", level: 1, align: "start" } },
      {
        id: "rs-intro",
        type: "text",
        props: {
          body: "Do not publish a verdict, settlement, or testimonial until the owner has approved the facts and the client has consented. Leave this page as a disclaimer until then.",
          align: "start",
          measure: true,
        },
      },
      {
        id: "rs-disclaimer",
        type: "text",
        props: {
          body: "Past results do not guarantee a future outcome. Every matter is different. Nothing on this page is a promise about what the firm can obtain for the next client.",
          align: "start",
          measure: true,
        },
      },
    ],
  },
  {
    slug: "resources",
    title: "Resources",
    seo: {
      title: "Legal resources",
      description:
        "Educational notes, not legal advice. State the jurisdiction on every piece.",
    },
    blocks: () => [
      { id: "re-h1", type: "heading", props: { text: "Resources", level: 1, align: "start" } },
      {
        id: "re-intro",
        type: "text",
        props: {
          body: "Publish only material a lawyer at the firm has reviewed. Name the jurisdiction. This is education, not advice about a reader's facts.",
          align: "start",
          measure: true,
        },
      },
      {
        id: "re-faq",
        type: "faq",
        props: {
          items: [
            {
              question: "Is this legal advice?",
              answer: "No. These notes are general information. An evaluation is the place to talk about your facts.",
            },
            {
              question: "Does sending a form create an attorney-client relationship?",
              answer: "No. The firm has to agree to represent you, in writing, before that relationship exists.",
            },
          ],
        },
      },
    ],
  },
  {
    slug: "case-evaluation",
    title: "Case evaluation",
    seo: {
      title: "Request a case evaluation",
      description:
        "Share the facts of a matter. A person at the firm will reply. This is not legal advice.",
    },
    blocks: () => [
      { id: "ev-h1", type: "heading", props: { text: "Case evaluation", level: 1, align: "start" } },
      {
        id: "ev-intro",
        type: "text",
        props: {
          body: "Tell the firm what happened, where, and whether you were given a date not to miss. Do not include medical record numbers or someone else's private data.\n\nSubmitting this form does not create an attorney-client relationship and is not legal advice.",
          align: "start",
          measure: true,
        },
      },
      { id: "ev-form", type: "form", props: { formSlug: "case-evaluation" } },
    ],
  },
  {
    slug: "contact",
    title: "Contact",
    seo: {
      title: "Contact the firm",
      description:
        "Office hours, phone, email, and a general message form. Not a case evaluation.",
    },
    blocks: () => [
      { id: "ct-h1", type: "heading", props: { text: "Contact", level: 1, align: "start" } },
      {
        id: "ct-intro",
        type: "text",
        props: {
          body: "For a new matter, use the case evaluation. Use this page for general questions about the office.",
          align: "start",
          measure: true,
        },
      },
      { id: "ct-nap", type: "nap", props: { showAddress: true, showPhone: true, showEmail: true } },
      { id: "ct-eval", type: "button", props: { label: "Go to case evaluation", href: "/case-evaluation", variant: "quiet" } },
      { id: "ct-form", type: "form", props: { formSlug: "contact" } },
    ],
  },
];
