// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Plastic Surgery Edition seed — WeVibeSites certified pack on Freeholder.
//
// Placeholder identity only. Renata Cole / NVC fiction must never appear here.
// Procedures, costs, and photos publish only from facts the owner supplies.
import type { BlockNode } from "@/modules/cms/blocks/types";
import type { FormFieldInput } from "@/modules/forms/fields";

export type ImageSlot = "consult" | "procedure" | "gallery";

export interface SeedPage {
  slug: string;
  title: string;
  seo: { title?: string; description?: string };
  blocks: (assets: Record<ImageSlot, string>) => BlockNode[];
}

export const BUSINESS = {
  name: "Your Plastic Surgery Practice",
  tagline: "Procedures they perform. Results they consented.",
  schemaType: "Physician",
  country: "US",
  defaultLocale: "en",
  enabledLocales: ["en"],
  baseCurrency: "USD",
  timezone: "America/Los_Angeles",
  units: "imperial" as const,
  firstDayOfWeek: 0,
};

export const LOCATION = {
  name: "Your Plastic Surgery Practice",
  slug: "practice",
  street: "300 Example Boulevard",
  unit: "Suite 400",
  city: "Portland",
  region: "OR",
  postalCode: "97209",
  country: "US",
  latitude: 45.53,
  longitude: -122.69,
  phone: "++1-555-0048",
  email: "hello@example.surgery",
  priceRange: "$$$$",
};

export const HOURS = [
  { weekday: 1, opens: "08:00", closes: "17:00" },
  { weekday: 2, opens: "08:00", closes: "17:00" },
  { weekday: 3, opens: "08:00", closes: "17:00" },
  { weekday: 4, opens: "08:00", closes: "17:00" },
  { weekday: 5, opens: "08:00", closes: "15:00" },
  { weekday: 6, closed: true },
  { weekday: 0, closed: true },
];

function gradient(from: string, via: string, to: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="1067">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="0.16" y2="1">
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
  consult: {
    filename: "surgery-consult.jpg",
    alt: "A quiet consult room with two chairs, a table, and a closed folder",
    svg: gradient("#1b1a18", "#3f3a34", "#d8d0c4"),
  },
  procedure: {
    filename: "surgery-procedure.jpg",
    alt: "An empty procedure corridor with even light and unmarked doors",
    svg: gradient("#141312", "#2e2c28", "#cfc8bc"),
  },
  gallery: {
    filename: "surgery-gallery.jpg",
    alt: "A results wall with two unmarked frames and a blank label strip",
    svg: gradient("#181614", "#3a3530", "#e6dfd4"),
  },
};

const NAV_LINKS = [
  { label: "Procedures", href: "/procedures" },
  { label: "Surgeon", href: "/surgeon" },
  { label: "Results", href: "/gallery" },
  { label: "Consult", href: "/consultation" },
  { label: "Candidacy", href: "/candidacy" },
  { label: "Recovery", href: "/recovery" },
  { label: "Costs", href: "/costs" },
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
      "Thank you. The practice will review this. This form does not diagnose, decide candidacy, or guarantee a result.",
    fields: [
      { key: "full_name", label: "Your name", kind: "text", required: true },
      { key: "email", label: "Email", kind: "email", required: true },
      { key: "phone", label: "Phone", kind: "tel", required: true },
      { key: "procedure", label: "Procedure of interest", kind: "text", required: true },
      { key: "notes", label: "Anything the surgeon should know?", kind: "multiline", required: false },
      {
        key: "consent_contact",
        label: "The practice may contact me. I understand this is not a diagnosis or a candidacy decision.",
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
    title: "Your Plastic Surgery Practice",
    seo: {
      title: "Your Plastic Surgery Practice",
      description:
        "Procedures they perform and results they consented. A starting site, not a guaranteed result.",
    },
    blocks: (a) => [
      {
        id: "home-h1",
        type: "heading",
        props: { text: "Procedures they perform. Results they consented.", level: 1, align: "start" },
      },
      {
        id: "home-intro",
        type: "text",
        props: {
          body: "This is a starting site for a real practice. Replace the name, surgeon, procedures, and photos with facts you can stand behind.\n\nA consultation request is not a diagnosis, not a candidacy decision, and not a guaranteed result.",
          align: "start",
          measure: true,
        },
      },
      { id: "home-hero", type: "image", props: { assetId: a.consult, width: "wide", rounded: false } },
      { id: "home-cta", type: "button", props: { label: "Request a consultation", href: "/consultation", variant: "solid" } },
      { id: "home-proc", type: "button", props: { label: "Procedures", href: "/procedures", variant: "quiet" } },
      { id: "home-surg", type: "button", props: { label: "Surgeon", href: "/surgeon", variant: "quiet" } },
      { id: "home-gal", type: "button", props: { label: "Results", href: "/gallery", variant: "quiet" } },
      { id: "home-can", type: "button", props: { label: "Candidacy", href: "/candidacy", variant: "quiet" } },
      { id: "home-rec", type: "button", props: { label: "Recovery", href: "/recovery", variant: "quiet" } },
      { id: "home-cost", type: "button", props: { label: "Costs", href: "/costs", variant: "quiet" } },
      { id: "home-ask", type: "button", props: { label: "Ask the practice", href: "/twin", variant: "quiet" } },
    ],
  },
  {
    slug: "procedures",
    title: "Procedures",
    seo: {
      title: "Procedures they named",
      description: "Operations they perform. No invented procedure and no guaranteed result.",
    },
    blocks: (a) => [
      { id: "pc-h1", type: "heading", props: { text: "Procedures", level: 1, align: "start" } },
      {
        id: "pc-intro",
        type: "text",
        props: {
          body: "List procedures they named. Do not invent an operation. A listed procedure is not a guaranteed result.",
          align: "start",
          measure: true,
        },
      },
      { id: "pc-img", type: "image", props: { assetId: a.procedure, width: "wide", rounded: false } },
      { id: "pc-cta", type: "button", props: { label: "Request a consultation", href: "/consultation", variant: "solid" } },
    ],
  },
  {
    slug: "surgeon",
    title: "Surgeon",
    seo: {
      title: "Surgeon credentials they supplied",
      description: "Qualifications they can prove. No invented board.",
    },
    blocks: () => [
      { id: "sg-h1", type: "heading", props: { text: "Surgeon", level: 1, align: "start" } },
      {
        id: "sg-intro",
        type: "text",
        props: {
          body: "Name the surgeon. Use credentials they supplied. Do not invent a board, a fellowship, or a case volume.",
          align: "start",
          measure: true,
        },
      },
    ],
  },
  {
    slug: "gallery",
    title: "Results",
    seo: {
      title: "Results they consented",
      description: "Cases with recorded consent. Empty until they add photographs.",
    },
    blocks: (a) => [
      { id: "ga-h1", type: "heading", props: { text: "Results", level: 1, align: "start" } },
      {
        id: "ga-intro",
        type: "text",
        props: {
          body: "Publish only cases with recorded consent. Leave this page empty rather than use another surgeon's gallery. Results are not a guaranteed outcome.",
          align: "start",
          measure: true,
        },
      },
      { id: "ga-img", type: "image", props: { assetId: a.gallery, width: "wide", rounded: false } },
    ],
  },
  {
    slug: "consultation",
    title: "Consultation",
    seo: {
      title: "Request a consultation",
      description: "Secure intake. This form does not diagnose or decide candidacy.",
    },
    blocks: () => [
      { id: "cn-h1", type: "heading", props: { text: "Consultation", level: 1, align: "start" } },
      {
        id: "cn-intro",
        type: "text",
        props: {
          body: "Photos stay staff-only until they say otherwise. Submitting this form does not diagnose, decide candidacy, or guarantee a result.",
          align: "start",
          measure: true,
        },
      },
      { id: "cn-form", type: "form", props: { formSlug: "consultation" } },
    ],
  },
  {
    slug: "candidacy",
    title: "Candidacy",
    seo: {
      title: "Questions they approved",
      description: "Non-diagnostic questions. This page never decides candidacy.",
    },
    blocks: () => [
      { id: "cd-h1", type: "heading", props: { text: "Candidacy", level: 1, align: "start" } },
      {
        id: "cd-intro",
        type: "text",
        props: {
          body: "Ask only questions they approved. This page does not decide candidacy and does not diagnose.",
          align: "start",
          measure: true,
        },
      },
      { id: "cd-cta", type: "button", props: { label: "Request a consultation", href: "/consultation", variant: "quiet" } },
    ],
  },
  {
    slug: "recovery",
    title: "Recovery",
    seo: {
      title: "Recovery they described",
      description: "Timelines they supplied. No invented healing promise.",
    },
    blocks: () => [
      { id: "rv-h1", type: "heading", props: { text: "Recovery", level: 1, align: "start" } },
      {
        id: "rv-intro",
        type: "text",
        props: {
          body: "Publish timelines they supplied. Do not invent a healing promise. Checklists they configured belong here.",
          align: "start",
          measure: true,
        },
      },
    ],
  },
  {
    slug: "costs",
    title: "Costs",
    seo: {
      title: "Ranges they published",
      description: "Assumptions displayed. Not another surgeon's fee list.",
    },
    blocks: () => [
      { id: "cs-h1", type: "heading", props: { text: "Costs", level: 1, align: "start" } },
      {
        id: "cs-intro",
        type: "text",
        props: {
          body: "Publish ranges they named, with the assumptions they stated. Do not invent a fee.",
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
      description: "Answers from approved facts. Never diagnoses.",
    },
    blocks: () => [
      { id: "tw-h1", type: "heading", props: { text: "Ask the practice", level: 1, align: "start" } },
      {
        id: "tw-intro",
        type: "text",
        props: {
          body: "The twin answers from facts they approved. It must not diagnose, decide candidacy, or promise a result. Until those facts exist, this page is a placeholder.",
          align: "start",
          measure: true,
        },
      },
      { id: "tw-cta", type: "button", props: { label: "Request a consultation", href: "/consultation", variant: "quiet" } },
    ],
  },
  {
    slug: "contact",
    title: "Contact",
    seo: {
      title: "Contact the practice",
      description: "Phone, email, and hours they supplied. Use Consult for a visit.",
    },
    blocks: () => [
      { id: "ct-h1", type: "heading", props: { text: "Contact", level: 1, align: "start" } },
      {
        id: "ct-intro",
        type: "text",
        props: {
          body: "For a visit, use Consult. Use this page for hours, parking, or a general message.",
          align: "start",
          measure: true,
        },
      },
      { id: "ct-nap", type: "nap", props: { showAddress: true, showPhone: true, showEmail: true } },
      { id: "ct-form", type: "form", props: { formSlug: "contact" } },
    ],
  },
];
