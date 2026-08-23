// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Fishing Charter Edition seed — WeVibeSites certified pack on Freeholder.
//
// Placeholder identity only. Harvest the operating system (trips, deposit
// booking, calendar honesty, catch-value worksheet, weather, albums). Never
// seed a live client's brand, boat, dock, gallery, or guest names.
import type { BlockNode } from "@/modules/cms/blocks/types";
import type { FormFieldInput } from "@/modules/forms/fields";

export type ImageSlot = "harbor" | "deck" | "worksheet";

export interface SeedPage {
  slug: string;
  title: string;
  seo: { title?: string; description?: string };
  blocks: (assets: Record<ImageSlot, string>) => BlockNode[];
}

export const BUSINESS = {
  name: "Your Charter",
  tagline: "Trips they run. Days the calendar can actually take.",
  schemaType: "SportsActivityLocation",
  country: "US",
  defaultLocale: "en",
  enabledLocales: ["en"],
  baseCurrency: "USD",
  timezone: "America/Los_Angeles",
  units: "imperial" as const,
  firstDayOfWeek: 0,
};

export const LOCATION = {
  name: "Your Charter",
  slug: "dock",
  street: "100 Harbor Road",
  unit: "Slip 1",
  city: "Port Example",
  region: "OR",
  postalCode: "97001",
  country: "US",
  latitude: 45.4,
  longitude: -122.8,
  phone: "++1-555-0048",
  email: "hello@example.charter",
  priceRange: "$$$",
};

export const HOURS = [
  { weekday: 1, opens: "06:00", closes: "18:00" },
  { weekday: 2, opens: "06:00", closes: "18:00" },
  { weekday: 3, opens: "06:00", closes: "18:00" },
  { weekday: 4, opens: "06:00", closes: "18:00" },
  { weekday: 5, opens: "06:00", closes: "18:00" },
  { weekday: 6, opens: "06:00", closes: "18:00" },
  { weekday: 0, opens: "06:00", closes: "16:00" },
];

function gradient(from: string, via: string, to: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="1067">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="0.15" y2="1">
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
  harbor: {
    filename: "charter-harbor.jpg",
    alt: "A quiet working harbor at first light with empty slips and still water",
    svg: gradient("#0b1f33", "#1a4a6b", "#c5a46a"),
  },
  deck: {
    filename: "charter-deck.jpg",
    alt: "Wet deck boards and coiled line on a small boat under overcast sky",
    svg: gradient("#14232e", "#3d4f46", "#e7e1d4"),
  },
  worksheet: {
    filename: "charter-worksheet.jpg",
    alt: "A paper tally sheet and pencil on a wooden table beside a window",
    svg: gradient("#1c1914", "#5a4a32", "#f3efe6"),
  },
};

const NAV_LINKS = [
  { label: "Fishing", href: "/fishing" },
  { label: "Tours", href: "/tours" },
  { label: "Pricing", href: "/pricing" },
  { label: "Book", href: "/book" },
  { label: "Catch value", href: "/catch-calculator" },
  { label: "Photos", href: "/photos" },
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
    slug: "book",
    name: "Trip booking",
    submitLabel: "Request this trip",
    successMessage:
      "Thank you. They will confirm from the calendar they publish. This is not a guaranteed trip.",
    fields: [
      { key: "full_name", label: "Your name", kind: "text", required: true },
      { key: "email", label: "Email", kind: "email", required: true },
      { key: "phone", label: "Phone", kind: "tel", required: true },
      { key: "date", label: "Requested date", kind: "text", required: true },
      { key: "guests", label: "Guests", kind: "text", required: true },
      { key: "trip", label: "Which trip?", kind: "text", required: true },
      {
        key: "consent_contact",
        label: "They may contact me to confirm this request. I understand weather can cancel a trip.",
        kind: "checkbox",
        required: true,
      },
    ],
  },
  {
    slug: "contact",
    name: "Contact",
    submitLabel: "Send message",
    successMessage: "Thank you. The charter will reply.",
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
    title: "Your Charter",
    seo: {
      title: "Your Charter",
      description:
        "Trips they run and days the calendar can take. This is a starting site, not a live boat.",
    },
    blocks: (a) => [
      {
        id: "home-h1",
        type: "heading",
        props: { text: "Trips they run. Days the calendar can take.", level: 1, align: "start" },
      },
      {
        id: "home-intro",
        type: "text",
        props: {
          body: "This is a starting site for a real charter. Replace the name, the dock, the trips, and the people with facts you can stand behind.\n\nA request is not a guaranteed trip. Weather, licenses, and the calendar they publish decide what actually leaves the dock.",
          align: "start",
          measure: true,
        },
      },
      { id: "home-hero", type: "image", props: { assetId: a.harbor, width: "wide", rounded: false } },
      { id: "home-cta", type: "button", props: { label: "Request a trip", href: "/book", variant: "solid" } },
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
              body: "Name the fishing and tour products they actually run. Durations and guest counts they set. Do not list a trip they will not take.",
              align: "start",
              measure: true,
            },
          },
          {
            id: "home-col-b",
            type: "text",
            props: {
              body: "Publish rates they set and the deposit they operate. Keep cancellation terms visible before a request.",
              align: "start",
              measure: true,
            },
          },
        ],
      },
      { id: "home-fishing", type: "button", props: { label: "Fishing trips", href: "/fishing", variant: "quiet" } },
      { id: "home-tours", type: "button", props: { label: "Tours", href: "/tours", variant: "quiet" } },
      { id: "home-pricing", type: "button", props: { label: "Pricing", href: "/pricing", variant: "quiet" } },
      { id: "home-days", type: "button", props: { label: "Best days", href: "/upcoming", variant: "quiet" } },
      { id: "home-catch", type: "button", props: { label: "Catch-value worksheet", href: "/catch-calculator", variant: "quiet" } },
      { id: "home-photos", type: "button", props: { label: "Photos", href: "/photos", variant: "quiet" } },
      { id: "home-conditions", type: "button", props: { label: "Conditions", href: "/conditions", variant: "quiet" } },
      { id: "home-waters", type: "button", props: { label: "Nearby waters", href: "/waters", variant: "quiet" } },
      { id: "home-ask", type: "button", props: { label: "Ask the captain", href: "/ask", variant: "quiet" } },
    ],
  },
  {
    slug: "fishing",
    title: "Fishing trips",
    seo: {
      title: "Fishing trips they run",
      description:
        "Products they named. Durations and guest counts they set. Not a promised species.",
    },
    blocks: (a) => [
      { id: "fi-h1", type: "heading", props: { text: "Fishing trips", level: 1, align: "start" } },
      {
        id: "fi-intro",
        type: "text",
        props: {
          body: "List only trips they actually run. Use the duration, guest count, and gear policy they set. Do not promise a species they did not name.",
          align: "start",
          measure: true,
        },
      },
      { id: "fi-img", type: "image", props: { assetId: a.deck, width: "wide", rounded: false } },
      {
        id: "fi-note",
        type: "text",
        props: {
          body: "A listed trip is a product, not a guaranteed catch. Weather and the calendar they publish can still cancel the day.",
          align: "start",
          measure: true,
        },
      },
      { id: "fi-cta", type: "button", props: { label: "Request a trip", href: "/book", variant: "solid" } },
    ],
  },
  {
    slug: "tours",
    title: "Tours",
    seo: {
      title: "Tours they actually run",
      description:
        "Wildlife or sightseeing they operate. Leave this page empty if they do not run tours.",
    },
    blocks: () => [
      { id: "to-h1", type: "heading", props: { text: "Tours", level: 1, align: "start" } },
      {
        id: "to-intro",
        type: "text",
        props: {
          body: "Use this page only if they run wildlife or sightseeing. Name the waters they visit. Do not invent a marine park they do not go to.",
          align: "start",
          measure: true,
        },
      },
      { id: "to-cta", type: "button", props: { label: "See pricing", href: "/pricing", variant: "quiet" } },
    ],
  },
  {
    slug: "pricing",
    title: "Pricing",
    seo: {
      title: "Trip rates they set",
      description:
        "Prices, guest counts, and extra-guest policy they named. Not another operator's list.",
    },
    blocks: () => [
      { id: "pr-h1", type: "heading", props: { text: "Pricing", level: 1, align: "start" } },
      {
        id: "pr-intro",
        type: "text",
        props: {
          body: "Publish rates they set. Include the guest count that rate covers and the extra-guest policy they named. Keep deposit percent and tax visible.",
          align: "start",
          measure: true,
        },
      },
      {
        id: "pr-note",
        type: "text",
        props: {
          body: "A published rate is not a guaranteed trip. Cancellation windows they wrote stay on this page.",
          align: "start",
          measure: true,
        },
      },
      { id: "pr-cta", type: "button", props: { label: "Request a trip", href: "/book", variant: "solid" } },
    ],
  },
  {
    slug: "book",
    title: "Book",
    seo: {
      title: "Request a trip",
      description:
        "Dates the calendar can take. Submitting is not a guaranteed trip until they confirm.",
    },
    blocks: () => [
      { id: "bk-h1", type: "heading", props: { text: "Book a trip", level: 1, align: "start" } },
      {
        id: "bk-intro",
        type: "text",
        props: {
          body: "Ask for a date the calendar they publish can take. A request is not a reserved trip until they confirm. Weather can still cancel after that.",
          align: "start",
          measure: true,
        },
      },
      { id: "bk-form", type: "form", props: { formSlug: "book" } },
    ],
  },
  {
    slug: "upcoming",
    title: "Best days",
    seo: {
      title: "Best days they publish",
      description:
        "Forecast scores for waters they named. This page does not invent an open day.",
    },
    blocks: () => [
      { id: "up-h1", type: "heading", props: { text: "Best days", level: 1, align: "start" } },
      {
        id: "up-intro",
        type: "text",
        props: {
          body: "Scores use the forecast for waters they named, with weights they configured. A high score is not an open day and not a guaranteed trip.",
          align: "start",
          measure: true,
        },
      },
      {
        id: "up-note",
        type: "text",
        props: {
          body: "Replace this placeholder with the calendar they publish. Do not fabricate an open slot.",
          align: "start",
          measure: true,
        },
      },
      { id: "up-cta", type: "button", props: { label: "Request a trip", href: "/book", variant: "quiet" } },
    ],
  },
  {
    slug: "catch-calculator",
    title: "Catch value",
    seo: {
      title: "Catch-value worksheet",
      description:
        "Species and prices they published. Assumptions shown. Not a guaranteed catch.",
    },
    blocks: (a) => [
      { id: "cc-h1", type: "heading", props: { text: "Catch-value worksheet", level: 1, align: "start" } },
      {
        id: "cc-intro",
        type: "text",
        props: {
          body: "This page is a worksheet. Replace every row with a species and a price they published. Show the unit and the as-of date. The total is not a guaranteed catch and not a market quote.",
          align: "start",
          measure: true,
        },
      },
      { id: "cc-img", type: "image", props: { assetId: a.worksheet, width: "wide", rounded: false } },
      {
        id: "cc-rows",
        type: "text",
        props: {
          body: "Species they named — price they published per pound. Replace this line.\nAnother species they named — price they published per pound. Replace this line too.",
          align: "start",
          measure: true,
        },
      },
      {
        id: "cc-faq",
        type: "faq",
        props: {
          items: [
            {
              question: "Is this a guaranteed catch?",
              answer: "No. The worksheet uses prices they published. It does not promise a fish or a limit.",
            },
            {
              question: "Where do the prices come from?",
              answer: "Only from figures the owner supplied, with the date they stated. Do not invent a market price.",
            },
          ],
        },
      },
    ],
  },
  {
    slug: "photos",
    title: "Photos",
    seo: {
      title: "Trip photos they consented",
      description:
        "Albums they own and consented. Empty until they add photographs.",
    },
    blocks: () => [
      { id: "ph-h1", type: "heading", props: { text: "Photos", level: 1, align: "start" } },
      {
        id: "ph-intro",
        type: "text",
        props: {
          body: "Publish only photographs they own and guests have consented to show. Leave this page empty rather than use another operator's gallery.",
          align: "start",
          measure: true,
        },
      },
    ],
  },
  {
    slug: "conditions",
    title: "Conditions",
    seo: {
      title: "Conditions and licenses",
      description:
        "Weather, tides, and license links they named. No copied marine-park map.",
    },
    blocks: () => [
      { id: "co-h1", type: "heading", props: { text: "Conditions", level: 1, align: "start" } },
      {
        id: "co-intro",
        type: "text",
        props: {
          body: "Link weather, tides, and license pages they named. License and safety facts require owner-supplied evidence. Do not copy another charter's map.",
          align: "start",
          measure: true,
        },
      },
      { id: "co-waters", type: "button", props: { label: "Nearby waters", href: "/waters", variant: "quiet" } },
    ],
  },
  {
    slug: "waters",
    title: "Nearby waters",
    seo: {
      title: "Nearby waters they named",
      description:
        "Places they authorized. Not another captain's SEO map.",
    },
    blocks: () => [
      { id: "wa-h1", type: "heading", props: { text: "Nearby waters", level: 1, align: "start" } },
      {
        id: "wa-intro",
        type: "text",
        props: {
          body: "Add a page for each place they authorized. Use names they supplied. Do not copy another operator's dock, ferry, or park list.",
          align: "start",
          measure: true,
        },
      },
      { id: "wa-cta", type: "button", props: { label: "See fishing trips", href: "/fishing", variant: "quiet" } },
    ],
  },
  {
    slug: "ask",
    title: "Ask the captain",
    seo: {
      title: "Ask the captain",
      description:
        "Answers from facts they supplied. No invented open day or species.",
    },
    blocks: () => [
      { id: "as-h1", type: "heading", props: { text: "Ask the captain", level: 1, align: "start" } },
      {
        id: "as-intro",
        type: "text",
        props: {
          body: "The twin answers from facts they supplied. It must not invent an open day, a species, or a catch. Until those facts exist, this page is a placeholder.",
          align: "start",
          measure: true,
        },
      },
      { id: "as-cta", type: "button", props: { label: "Request a trip", href: "/book", variant: "quiet" } },
    ],
  },
  {
    slug: "contact",
    title: "Contact",
    seo: {
      title: "Contact the charter",
      description:
        "Dock, phone, and hours they supplied. Use Book to request a trip.",
    },
    blocks: () => [
      { id: "ct-h1", type: "heading", props: { text: "Contact", level: 1, align: "start" } },
      {
        id: "ct-intro",
        type: "text",
        props: {
          body: "For a trip, use Book. Use this page for general questions about the dock, hours, or a message that is not a date request.",
          align: "start",
          measure: true,
        },
      },
      { id: "ct-nap", type: "nap", props: { showAddress: true, showPhone: true, showEmail: true } },
      { id: "ct-book", type: "button", props: { label: "Go to booking", href: "/book", variant: "quiet" } },
      { id: "ct-form", type: "form", props: { formSlug: "contact" } },
    ],
  },
];
