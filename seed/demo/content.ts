// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Aurora Coast Photography — the demo business (MASTER.md §3, §15.2, §25).
//
// This is data, not a fixture. Three things depend on it being *good* rather
// than merely present:
//
//   - §15.2's SEO gate crawls it. A demo site that fails the doctrine cannot
//     prove the doctrine holds, so the gate would be checking nothing.
//   - §25's plugin dev harness boots it, so this is the site a contributor
//     sees first and forms their idea of what the platform makes.
//   - §3 promises "a fresh deploy is instantly explorable". An empty instance
//     is a tutorial; a populated one is a product.
//
// So it is written as a real photographer's site would be: a browse hierarchy
// no more than two levels deep (§5's RIBA rule), every page reachable from the
// nav, a service page per thing sold, and copy that says something. The
// business is fictional; the shape of it is not.
import type { BlockNode } from "@/modules/cms/blocks/types";
import type { FormFieldInput } from "@/modules/forms/fields";
import type {
  CalculatorInput,
  CalculatorStep,
} from "@/modules/calculators/formula";
import { ILLUSTRATIONS } from "./illustrations";

/** Which generated image a block wants. Resolved to asset ids at install. */
export type ImageSlot =
  | "coastline"
  | "portrait"
  | "studio"
  | "fog"
  | "dawn"
  | "headland"
  | "calendar"
  | "giftCard";

export interface SeedPage {
  slug: string;
  title: string;
  seo: { title?: string; description?: string };
  blocks: (assets: Record<ImageSlot, string>) => BlockNode[];
}

export const BUSINESS = {
  name: "Aurora Coast Photography",
  tagline: "Coastal light, honestly made",
  // §13 calls the schema.org choice "identity, not decoration", and the demo
  // has to demonstrate that rather than settle for LocalBusiness.
  schemaType: "Photographer",
  country: "CA",
  defaultLocale: "en",
  // Two locales on purpose: hreflang, the per-locale sitemap and the URL
  // prefix are only real if something is actually translated, and a demo that
  // cannot exercise §4.9 cannot prove it works.
  enabledLocales: ["en", "fr-CA"],
  baseCurrency: "CAD",
  timezone: "America/Vancouver",
  units: "metric" as const,
  firstDayOfWeek: 1,
};

/**
 * Where Aurora Coast works (§4.10).
 *
 * A real, structured address rather than a line of text in the footer, because
 * the point of §4.10 is that those are different things: a text line renders
 * identically and is worth nothing to a search engine comparing this site
 * against a directory listing. The demo has to demonstrate the difference, or
 * it demonstrates the failure mode.
 *
 * The street is invented; the town is not. A demo address that resolved to a
 * real business would be a worse kind of wrong.
 */
export const LOCATION = {
  name: "Aurora Coast Photography",
  slug: "courtenay",
  street: "210 Fifth Street",
  unit: "Studio 3",
  city: "Courtenay",
  region: "BC",
  postalCode: "V9N 1A1",
  country: "CA",
  latitude: 49.687,
  longitude: -124.993,
  phone: "+1 250-555-0142",
  email: "hello@auroracoast.example",
  priceRange: "$$",
};

/**
 * A week of hours, including a stated closure.
 *
 * Sunday is marked closed rather than left out, which is the distinction §4.10
 * turns on: a search result can tell somebody a studio is shut on Sunday, and
 * can tell them nothing at all about a day nobody mentioned.
 */
export const HOURS = [
  { weekday: 1, opens: "09:00", closes: "17:00" },
  { weekday: 2, opens: "09:00", closes: "17:00" },
  { weekday: 3, opens: "09:00", closes: "17:00" },
  { weekday: 4, opens: "09:00", closes: "17:00" },
  { weekday: 5, opens: "09:00", closes: "16:00" },
  { weekday: 6, opens: "10:00", closes: "14:00" },
  { weekday: 0, closed: true },
];

/**
 * The demo's images: generated illustrations (seed/demo/illustrations.ts),
 * original to this repository, rasterised at install. Every one carries alt
 * text that describes what is drawn — §5 wants images described, and
 * "image1.jpg" passing a gate is how alt text becomes decoration.
 */
export const IMAGES: Record<ImageSlot, { filename: string; alt: string; svg: string }> = {
  coastline: {
    filename: "aurora-coast-shoreline.jpg",
    alt: "Illustration of a low sun over the strait at dusk, headlands layered blue behind a dark pebble shore",
    svg: ILLUSTRATIONS.coastline(),
  },
  portrait: {
    filename: "aurora-coast-portrait.jpg",
    alt: "Illustration of two people walking the tideline at dusk, the sun low over the water behind them",
    svg: ILLUSTRATIONS.portrait(),
  },
  studio: {
    filename: "aurora-coast-studio.jpg",
    alt: "Illustration of the studio wall: five prints drying on a line above a window onto the strait",
    svg: ILLUSTRATIONS.studio(),
  },
  fog: {
    filename: "aurora-coast-strait-in-fog.jpg",
    alt: "Illustration of the strait in morning fog, pale headlands fading into a white sky",
    svg: ILLUSTRATIONS.fog(),
  },
  dawn: {
    filename: "aurora-coast-driftwood-dawn.jpg",
    alt: "Illustration of dawn over the water in rose and violet, a dark driftwood shore in the foreground",
    svg: ILLUSTRATIONS.dawn(),
  },
  headland: {
    filename: "aurora-coast-headland.jpg",
    alt: "Illustration of a headland at low tide under a pale sky, light catching the wet sand",
    svg: ILLUSTRATIONS.headland(),
  },
  calendar: {
    filename: "aurora-coast-calendar.jpg",
    alt: "Illustration of a wall calendar open on a dawn coastal scene above a grid of days",
    svg: ILLUSTRATIONS.calendar(),
  },
  giftCard: {
    filename: "aurora-coast-gift-card.jpg",
    alt: "Illustration of an Aurora Coast gift card with a dusk seascape, lying on linen",
    svg: ILLUSTRATIONS.giftCard(),
  },
};

/**
 * The site's menu. It lives in the Navigation chrome section — the platform's
 * one menu (C2.11) — rather than on a nav block inside the header, which is
 * the older shape `cms.ensureDefaults` migrates out of headers.
 */
export const NAV_LINKS = [
  { label: "Services", href: "/services" },
  { label: "Shop", href: "/products" },
  { label: "Book", href: "/book" },
  { label: "Events", href: "/events" },
  { label: "Journal", href: "/blog" },
  { label: "About", href: "/about" },
  { label: "Contact", href: "/contact" },
];

/** Brand on the left; the cart and the language switch on the right. */
export function header(): BlockNode[] {
  return [
    {
      id: "seed-header",
      type: "chromeBar",
      props: { align: "between" },
      children: [
        {
          id: "seed-header-brand",
          type: "brand",
          props: { href: "/", showTagline: true },
        },
        { id: "seed-header-cart", type: "cartWidget", props: {} },
      ],
    },
  ];
}

export function nav(): BlockNode[] {
  return [
    {
      id: "chrome-nav",
      type: "nav",
      props: { links: NAV_LINKS, ariaLabelKey: "cms.nav.primary" },
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
          // Not a text block with the address typed into it, which is what
          // this was. §4.10's rule is that the render helper is the only way
          // to output NAP, and a footer keeping its own copy is exactly the
          // drift the rule exists to stop — edit the location and this text
          // would have gone on saying the old thing. The block reads the
          // primary location instead.
          id: "seed-footer-nap",
          type: "nap",
          props: { showAddress: true, showPhone: true, showEmail: true },
        },
        {
          id: "seed-footer-nav",
          type: "nav",
          props: {
            // Every page is reachable from the chrome, which is what keeps the
            // site inside §5's three-hops rule without anyone checking by hand.
            links: [
              { label: "Weddings", href: "/services/weddings" },
              { label: "Portraits", href: "/services/portraits" },
              { label: "Planning", href: "/planning" },
              { label: "Newsletters", href: "/newsletters" },
              { label: "Gifts", href: "/c/gifts" },
              { label: "Search", href: "/search" },
            ],
            ariaLabelKey: "cms.nav.footer",
            collapseOnMobile: false,
          },
        },
        {
          id: "seed-footer-locales",
          type: "locales",
          props: { separator: "·" },
        },
      ],
    },
  ];
}

/**
 * The forms the demo ships with.
 *
 * One, and a real one: the contact page's enquiry form. It exists so the
 * public surface has a form on it — which is what makes the a11y smoke test
 * check real labels against real controls, and the SEO crawler walk a page
 * that writes as well as reads.
 */
export const FORMS: Array<{
  slug: string;
  name: string;
  submitLabel: string;
  successMessage: string;
  fields: FormFieldInput[];
}> = [
  {
    slug: "contact",
    name: "Enquiry",
    submitLabel: "Send enquiry",
    successMessage:
      "Thank you — I read everything myself and will reply within a day.",
    fields: [
      { key: "name", label: "Your name", kind: "text", required: true },
      { key: "email", label: "Email", kind: "email", required: true },
      {
        key: "occasion",
        label: "What is it for?",
        kind: "select",
        required: true,
        options: ["A wedding", "A portrait session", "Something else"],
      },
      {
        key: "when",
        label: "Roughly when?",
        kind: "text",
        placeholder: "September, or a date if you have one",
      },
      {
        key: "message",
        label: "Tell me about it",
        kind: "multiline",
        required: true,
        help: "Where, how many people, and anything you already know you want.",
      },
    ],
  },
];

/**
 * The figures the demo's calculators rest on (§4.18, C5.26).
 *
 * Money rides these as integer minor units, the platform-wide convention:
 * 340000 is $3,400.00, not $340,000. The calculators divide by 100 as a
 * published step, so the working stays in whole cents and the visitor still
 * reads dollars. Each figure carries where it came from and the moment it
 * was true; the print credit's terms stop being true at the end of April,
 * which is the demo's live demonstration of a calculator declining rather
 * than answering from an expired figure.
 */
export const FACTS: Array<{
  key: string;
  value: number;
  source: string;
  asOf: string;
  validUntil?: string;
}> = [
  {
    key: "price.wedding-day-base",
    value: 340000,
    source: "2026 wedding rate card",
    asOf: "2026-09-01",
  },
  {
    key: "price.wedding-extra-hour",
    value: 25000,
    source: "2026 wedding rate card",
    asOf: "2026-09-15",
  },
  {
    key: "rebate.print-credit-each",
    value: 400,
    source: "Off-season print terms, 2026",
    asOf: "2026-09-01",
    validUntil: "2027-04-30",
  },
  {
    key: "rebate.print-credit-cap",
    value: 20,
    source: "Off-season print terms, 2026",
    asOf: "2026-09-15",
    validUntil: "2027-04-30",
  },
];

/**
 * The demo's two calculators (C5.26): an affordability figure and a
 * rebate-eligibility figure. Both are plain lists of named steps over
 * published figures — never an expression — and both carry assumptions in
 * the owner's voice that say plainly what the number is not. Seeded through
 * the services, not the table, so the demo can only contain what an owner
 * could have made by hand: publishing refuses a calculator whose figures do
 * not exist yet, so the facts above are recorded before these are opened.
 */
export const CALCULATORS: Array<{
  slug: string;
  name: string;
  intro: string;
  inputs: CalculatorInput[];
  steps: CalculatorStep[];
  resultLabel: string;
  resultUnit?: string;
  assumptions: string;
}> = [
  {
    slug: "wedding-day-cost",
    name: "What will a wedding day cost?",
    intro:
      "The published day rate plus the published hourly rate for every hour past eight. Worked from figures Aurora Coast has stood behind, with the dates those figures were true.",
    inputs: [
      {
        key: "hours",
        label: "How many hours of coverage?",
        help: "From getting ready to the last dance; eight hours covers most weddings.",
        min: 6,
        max: 14,
        unit: "hours",
      },
    ],
    steps: [
      {
        key: "extra_hours",
        label: "Hours past eight",
        op: "subtract",
        first: { kind: "input", key: "hours" },
        second: { kind: "literal", value: 8 },
      },
      {
        key: "extra_hours_capped",
        label: "Billable extra hours",
        op: "max",
        first: { kind: "step", key: "extra_hours" },
        second: { kind: "literal", value: 0 },
      },
      {
        key: "extra_cost",
        label: "Extra coverage",
        op: "multiply",
        first: { kind: "step", key: "extra_hours_capped" },
        second: { kind: "fact", factKey: "price.wedding-extra-hour" },
      },
      {
        key: "total_cents",
        label: "Day total in cents",
        op: "add",
        first: { kind: "step", key: "extra_cost" },
        second: { kind: "fact", factKey: "price.wedding-day-base" },
      },
      {
        key: "total_dollars",
        label: "Day total in dollars",
        op: "divide",
        first: { kind: "step", key: "total_cents" },
        second: { kind: "literal", value: 100 },
      },
    ],
    resultLabel: "Estimated wedding coverage",
    resultUnit: "$",
    assumptions:
      "The published base day plus the published hourly rate for each hour past eight, worked in cents and shown in dollars. A planning number for sizing a budget — not a quote; ferry travel and mainland venues are talked through before you book.",
  },
  {
    slug: "print-credit",
    name: "Off-season print credit",
    intro:
      "Four dollars a print on up to twenty prints, for sessions booked between November and April. Worked from the published terms, with the dates those terms were true.",
    inputs: [
      {
        key: "prints",
        label: "How many prints are you ordering?",
        help: "Counts prints ordered with a session booked November through April.",
        min: 1,
        max: 100,
        unit: "prints",
      },
    ],
    steps: [
      {
        key: "eligible_prints",
        label: "Prints that qualify",
        op: "min",
        first: { kind: "input", key: "prints" },
        second: { kind: "fact", factKey: "rebate.print-credit-cap" },
      },
      {
        key: "credit_cents",
        label: "Credit in cents",
        op: "multiply",
        first: { kind: "step", key: "eligible_prints" },
        second: { kind: "fact", factKey: "rebate.print-credit-each" },
      },
      {
        key: "credit_dollars",
        label: "Credit in dollars",
        op: "divide",
        first: { kind: "step", key: "credit_cents" },
        second: { kind: "literal", value: 100 },
      },
    ],
    resultLabel: "Print credit you would be eligible for",
    resultUnit: "$",
    assumptions:
      "Four dollars a print on up to twenty prints, for sessions booked November through April, worked in cents and shown in dollars. A planning number — whether a specific order qualifies is confirmed when the order is placed, not by this arithmetic.",
  },
];

/**
 * One page, translated. Enough to make §4.9 demonstrable end to end: a
 * prefixed URL that resolves, an hreflang set with something true in it, and a
 * per-locale sitemap that lists exactly what that locale has.
 *
 * Written by a human for the demo rather than machine-drafted, so it ships as
 * `reviewed` — §4.9 forbids publishing a machine draft silently, and the seed
 * should model the rule rather than skirt it.
 */
export const TRANSLATIONS: Array<{
  slug: string;
  locale: string;
  title: string;
  seo: { title: string; description: string };
  blocks: (assets: Record<ImageSlot, string>) => BlockNode[];
}> = [
  {
    slug: "",
    locale: "fr-CA",
    title: "Aurora Coast Photographie",
    seo: {
      title: "Aurora Coast Photographie",
      description:
        "Photographie de mariage et de portrait sur la côte est de l'île de Vancouver, en lumière naturelle.",
    },
    blocks: (a) => [
      {
        id: "home-h1",
        type: "heading",
        props: { text: "La lumière de la côte, sans artifice", level: 1, align: "start" },
      },
      {
        id: "home-intro",
        type: "text",
        props: {
          body: "Mariages et portraits sur la côte est de l'île de Vancouver, photographiés dans la lumière qui est là.\n\nAucune pose imposée. On marche, on jase, et les photos sortent de la journée plutôt que d'être arrangées par-dessus.",
          align: "start",
          measure: true,
        },
      },
      {
        id: "home-hero",
        type: "image",
        props: { assetId: a.coastline, width: "wide", rounded: true },
      },
      {
        id: "home-cta",
        type: "button",
        props: { label: "Voir les tarifs", href: "/fr-CA/services", variant: "solid" },
      },
    ],
  },
];

/**
 * The letter a demo visitor can actually read, and the campaign wording an
 * owner can send. The archive page is empty without an issue, and the sending
 * journey has nothing to send without a template.
 */
export const NEWSLETTER = {
  name: "The Aurora Coast Letter",
  slug: "aurora-coast-letter",
  description:
    "Occasional notes from the studio: the light, what is on the wall, and when the next sitting is.",
  consentStatement:
    "Send me the Aurora Coast Letter. I can unsubscribe from any issue.",
  issue: {
    slug: "first-light",
    title: "First light on the coast",
    excerpt: "What the morning looked like from the strait, and when the next sitting is.",
    body: "The strait was silver before the ferry. This letter is how the studio says what is coming up, and nothing else.\n\nThe next open sitting is on the booking page.",
  },
  template: {
    name: "Aurora Coast Letter",
    subject: "The Aurora Coast Letter",
    body: "Hello {{contact.first_name}}.\n\nA short note from the studio.",
  },
};

export const PAGES: SeedPage[] = [
  {
    slug: "blog",
    title: "Studio journal",
    seo: { description: "Notes from the studio, coastal photography stories and recent work from Aurora Coast Photography." },
    blocks: () => [
      { id: "blog-title", type: "heading", props: { text: "Studio journal", level: 1 } },
      { id: "blog-index", type: "blogIndex", props: {} },
    ],
  },
  {
    slug: "newsletters",
    title: "Studio newsletters",
    seo: { description: "Read the studio newsletter archive and subscribe to occasional news from Aurora Coast Photography." },
    blocks: () => [
      { id: "newsletters-title", type: "heading", props: { text: "Studio newsletters", level: 1 } },
      { id: "newsletters-archive", type: "newsletterArchive", props: {} },
      {
        id: "newsletters-subscribe",
        type: "newsletterSubscribe",
        props: { consentStatement: NEWSLETTER.consentStatement },
      },
    ],
  },
  {
    slug: "",
    title: "Aurora Coast Photography",
    seo: {
      title: "Aurora Coast Photography",
      description:
        "Wedding and portrait photography on Vancouver Island's east coast, made in available light.",
    },
    blocks: (a) => [
      {
        id: "home-h1",
        type: "heading",
        props: { text: "Coastal light, honestly made", level: 1, align: "start" },
      },
      {
        id: "home-intro",
        type: "text",
        props: {
          body: "Weddings and portraits on the east coast of Vancouver Island, photographed in the light that is actually there.\n\nNo posing you into somebody else's photographs. We walk, we talk, and the pictures come out of the day rather than being arranged on top of it.",
          align: "start",
          measure: true,
        },
      },
      {
        id: "home-hero",
        type: "image",
        props: { assetId: a.coastline, width: "wide", rounded: true },
      },
      { id: "home-cta", type: "button", props: { label: "See what a day costs", href: "/services", variant: "solid" } },
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
              body: "Based in the Comox Valley, working from Victoria to Port Hardy and across to the mainland when the ferry cooperates.",
              align: "start",
              measure: true,
            },
          },
          {
            id: "home-col-b",
            type: "text",
            props: {
              body: "Every booking includes a pre-shoot call, the edited gallery within three weeks, and print rights you actually own.",
              align: "start",
              measure: true,
            },
          },
        ],
      },
    ],
  },
  {
    slug: "services",
    title: "Services",
    seo: {
      title: "Photography services and pricing",
      description:
        "Wedding coverage, portrait sessions and commercial work on Vancouver Island — what each includes and what it costs.",
    },
    blocks: (a) => [
      { id: "svc-h1", type: "heading", props: { text: "What I photograph", level: 1, align: "start" } },
      {
        id: "svc-intro",
        type: "text",
        props: {
          body: "Two things, done properly, rather than everything done adequately — and prints from the studio wall for anyone who would rather take the coast home.",
          align: "start",
          measure: true,
        },
      },
      {
        id: "svc-cols",
        type: "columns",
        props: { count: 2, gap: "normal" },
        children: [
          { id: "svc-wed-h", type: "heading", props: { text: "Weddings", level: 2, align: "start" } },
          { id: "svc-por-h", type: "heading", props: { text: "Portraits", level: 2, align: "start" } },
        ],
      },
      {
        id: "svc-cols-2",
        type: "columns",
        props: { count: 2, gap: "normal" },
        children: [
          {
            id: "svc-wed-t",
            type: "text",
            props: {
              body: "Full-day coverage from getting ready to the last dance. From $3,400.",
              align: "start",
              measure: true,
            },
          },
          {
            id: "svc-por-t",
            type: "text",
            props: {
              body: "Ninety minutes on a beach or in the studio, for families, couples and one person who hates having their photograph taken. From $450.",
              align: "start",
              measure: true,
            },
          },
        ],
      },
      {
        id: "svc-cols-3",
        type: "columns",
        props: { count: 2, gap: "normal" },
        children: [
          { id: "svc-wed-b", type: "button", props: { label: "Wedding coverage", href: "/services/weddings", variant: "quiet" } },
          { id: "svc-por-b", type: "button", props: { label: "Portrait sessions", href: "/services/portraits", variant: "quiet" } },
        ],
      },
      { id: "svc-img", type: "image", props: { assetId: a.headland, width: "wide", rounded: true } },
      { id: "svc-shop", type: "button", props: { label: "Prints and gift cards", href: "/c/prints", variant: "quiet" } },
      { id: "svc-book", type: "button", props: { label: "Book a session online", href: "/book", variant: "solid" } },
    ],
  },
  {
    slug: "services/weddings",
    title: "Wedding photography",
    seo: {
      title: "Wedding photography, Vancouver Island",
      description:
        "Full-day wedding coverage in the Comox Valley and across Vancouver Island. What is included, what it costs, and how booking works.",
    },
    blocks: (a) => [
      { id: "wed-h1", type: "heading", props: { text: "Wedding photography", level: 1, align: "start" } },
      {
        id: "wed-intro",
        type: "text",
        props: {
          body: "One photographer, the whole day, and no package that ends at 6pm when the good part starts at 9.\n\nCoverage runs from getting ready to whenever the dancing gives out. You get every frame worth keeping, edited, in a gallery you can hand to your family without asking me for permission.",
          align: "start",
          measure: true,
        },
      },
      { id: "wed-img", type: "image", props: { assetId: a.dawn, width: "wide", rounded: true } },
      {
        id: "wed-faq",
        type: "faq",
        props: {
          items: [
            {
              question: "How far ahead should we book?",
              answer:
                "Most couples book nine to fourteen months out. Summer Saturdays on the Island go first; a Friday in September is usually still open in June.",
            },
            {
              question: "Do you travel?",
              answer:
                "Anywhere on Vancouver Island at no extra cost. Mainland and Gulf Islands add ferry and a night's accommodation, quoted before you book.",
            },
            {
              question: "What if it rains?",
              answer:
                "It rains. We shoot anyway — the light under cloud is kinder than sun, and the pictures people frame are usually the wet ones.",
            },
            {
              question: "When do we get the photographs?",
              answer:
                "A short preview within 48 hours, and the full edited gallery within three weeks. Print rights are included, permanently.",
            },
          ],
        },
      },
      { id: "wed-cta", type: "button", props: { label: "Check your date", href: "/contact", variant: "solid" } },
    ],
  },
  {
    slug: "services/portraits",
    title: "Portrait sessions",
    seo: {
      title: "Portrait sessions on the coast",
      description:
        "Ninety-minute portrait sessions for families, couples and individuals, on the beach or in the Comox Valley studio.",
    },
    blocks: (a) => [
      { id: "por-h1", type: "heading", props: { text: "Portrait sessions", level: 1, align: "start" } },
      {
        id: "por-intro",
        type: "text",
        props: {
          body: "Ninety minutes, on a beach or in the studio, for families, couples, and the one person in every family who hates having their photograph taken.\n\nWe start with a walk and a conversation. By the time the camera matters, nobody is thinking about it.",
          align: "start",
          measure: true,
        },
      },
      { id: "por-img", type: "image", props: { assetId: a.portrait, width: "wide", rounded: true } },
      {
        id: "por-faq",
        type: "faq",
        props: {
          items: [
            {
              question: "What should we wear?",
              answer:
                "Whatever you would wear on a good day off. Avoid brand-new clothes and anything you will spend the session adjusting.",
            },
            {
              question: "Will you photograph our dog?",
              answer: "Yes. Bring the dog. The dog usually improves the session.",
            },
          ],
        },
      },
      { id: "por-cta", type: "button", props: { label: "Book a session", href: "/book", variant: "solid" } },
    ],
  },
  {
    slug: "planning",
    title: "Planning",
    seo: {
      title: "Plan a photography budget",
      description:
        "Work out a rough wedding coverage figure and an off-season print credit from the figures Aurora Coast has published, dates included.",
    },
    blocks: () => [
      { id: "plan-h1", type: "heading", props: { text: "Planning tools", level: 1, align: "start" } },
      {
        id: "plan-intro",
        type: "text",
        props: {
          body: "Two calculators, both worked out from figures this studio has published and dated. Each answer arrives with the assumptions behind it and the date of the oldest figure it used — and if a figure goes out of date, the calculator says so instead of guessing.",
          align: "start",
          measure: true,
        },
      },
      {
        id: "plan-cost",
        type: "calculator",
        props: { calculatorSlug: "wedding-day-cost" },
      },
      {
        id: "plan-credit",
        type: "calculator",
        props: { calculatorSlug: "print-credit" },
      },
    ],
  },
  {
    slug: "about",
    title: "About",
    seo: {
      title: "About Aurora Coast Photography",
      description:
        "A one-person photography studio in the Comox Valley, working in available light since 2014.",
    },
    blocks: (a) => [
      { id: "abt-h1", type: "heading", props: { text: "About the studio", level: 1, align: "start" } },
      {
        id: "abt-body",
        type: "text",
        props: {
          body: "Aurora Coast is one person, a bag of prime lenses, and a small studio above a boatyard in the Comox Valley.\n\nI have photographed on this coast since 2014 — long enough to know which beaches work at which tide, and which venues have a window that does something extraordinary for eleven minutes in August.\n\nEverything is edited by me. Nothing is outsourced, and there is no second photographer unless you asked for one.",
          align: "start",
          measure: true,
        },
      },
      { id: "abt-img", type: "image", props: { assetId: a.studio, width: "wide", rounded: true } },
      { id: "abt-cta", type: "button", props: { label: "Get in touch", href: "/contact", variant: "quiet" } },
    ],
  },
  {
    slug: "contact",
    title: "Contact",
    seo: {
      title: "Contact Aurora Coast Photography",
      description:
        "Check a date, ask a question, or book a portrait session in the Comox Valley.",
    },
    blocks: () => [
      { id: "con-h1", type: "heading", props: { text: "Get in touch", level: 1, align: "start" } },
      {
        id: "con-body",
        type: "text",
        props: {
          body: "Tell me the date, roughly where, and what you have in mind. I answer everything within a day, usually sooner.\n\nhello@auroracoast.example\n+1 250 555 0142\n\nStudio visits by appointment — the boatyard gate is locked outside working hours.",
          align: "start",
          measure: true,
        },
      },
      {
        id: "con-form",
        type: "form",
        props: { formSlug: "contact" },
      },
      {
        id: "con-faq",
        type: "faq",
        props: {
          items: [
            {
              question: "Do you hold dates without a deposit?",
              answer:
                "For seven days, once we have spoken. After that the date goes back to whoever asks for it next.",
            },
          ],
        },
      },
    ],
  },
];

/**
 * The shop (C1.38). Complete enough to buy: every product carries the
 * standard tax category, an active variant per size, a price on the CAD
 * retail list, stock on hand at the studio and a picture. A demo shop with
 * no products taught evaluators that the catalog cannot sell.
 */
export interface SeedProduct {
  slug: string;
  name: string;
  kind: "physical" | "digital";
  subtitle: string;
  description: string;
  image: ImageSlot;
  /** Variant sizes (option "print-size"), or one price for a single variant. */
  sizes?: Array<{ name: string; fragment: string; price: string; stock: number }>;
  price?: string;
  stock?: number;
  collections: string[];
}

export const PRINT_SIZES = [
  { name: "8 × 10 in", fragment: "8x10", price: "45.00", stock: 24 },
  { name: "12 × 18 in", fragment: "12x18", price: "85.00", stock: 12 },
  { name: "24 × 36 in", fragment: "24x36", price: "180.00", stock: 4 },
];

export const CATALOG: SeedProduct[] = [
  {
    slug: "driftwood-dawn-print",
    name: "Driftwood Dawn",
    kind: "physical",
    subtitle: "Archival print, signed on the back",
    description:
      "Twenty minutes before sunrise at Kye Bay, when the strait turns the colour of the inside of a shell.\n\nPrinted on 310 gsm cotton rag with pigment inks, rated for a hundred years out of direct sun. Shipped flat in a rigid mailer, or collected from the studio.",
    image: "dawn",
    sizes: PRINT_SIZES,
    collections: ["prints"],
  },
  {
    slug: "strait-in-fog-print",
    name: "Strait in Fog",
    kind: "physical",
    subtitle: "Archival print, signed on the back",
    description:
      "A November morning when the far shore simply was not there. The quietest picture on the studio wall, and the one people ask about most.\n\nCotton rag, pigment inks, shipped flat.",
    image: "fog",
    sizes: PRINT_SIZES,
    collections: ["prints"],
  },
  {
    slug: "headland-low-tide-print",
    name: "Headland at Low Tide",
    kind: "physical",
    subtitle: "Archival print, signed on the back",
    description:
      "Goose Spit at the bottom of a spring tide, the sand still holding the sky.\n\nCotton rag, pigment inks, shipped flat.",
    image: "headland",
    sizes: PRINT_SIZES,
    collections: ["prints"],
  },
  {
    slug: "coastal-calendar-2027",
    name: "Coastal Calendar 2027",
    kind: "physical",
    subtitle: "Twelve months of the east coast",
    description:
      "A wall calendar of twelve pictures from the year's walks, with the spring tides marked. Printed in Courtenay on recycled stock.",
    image: "calendar",
    price: "28.00",
    stock: 60,
    collections: ["prints", "gifts"],
  },
  {
    slug: "aurora-coast-gift-card",
    name: "Gift card",
    kind: "digital",
    subtitle: "Spend it on prints or a session",
    description:
      "A gift card delivered by email, good for prints, calendars or towards any session. It never expires.",
    image: "giftCard",
    price: "100.00",
    collections: ["gifts"],
  },
  {
    slug: "portrait-session-voucher",
    name: "Portrait session voucher",
    kind: "digital",
    subtitle: "Ninety minutes on the coast, as a gift",
    description:
      "One ninety-minute portrait session for a family, a couple or one brave person, with the edited gallery and print rights. The recipient books the date themselves.",
    image: "portrait",
    price: "450.00",
    collections: ["gifts"],
  },
];

export const COLLECTIONS = [
  {
    slug: "prints",
    title: "Prints from the studio wall",
    description: "Archival prints and the 2027 calendar, printed and signed in the Comox Valley.",
  },
  {
    slug: "gifts",
    title: "Gifts",
    description: "Gift cards, session vouchers and the coastal calendar.",
  },
];

/**
 * Bookable services (C1.38): what /book offers. Each is a service product
 * with an offering, a full-payment price rule and the studio calendar behind
 * it, which has weekly hours — so /book shows real open times.
 */
export const SERVICES = [
  {
    slug: "portrait-session",
    name: "Portrait session",
    subtitle: "Ninety minutes on the beach or in the studio",
    price: "450.00",
    durationMin: 90,
    bufferAfterMin: 30,
  },
  {
    slug: "mini-session",
    name: "Mini session",
    subtitle: "Thirty minutes, one location, ten edited pictures",
    price: "175.00",
    durationMin: 30,
    bufferAfterMin: 15,
  },
  {
    slug: "headshot-session",
    name: "Headshot session",
    subtitle: "Forty-five minutes in the studio for profiles and press",
    price: "225.00",
    durationMin: 45,
    bufferAfterMin: 15,
  },
];

/** The studio calendar's weekly bookable hours (weekday 0 = Sunday). */
export const STUDIO_AVAILABILITY = [
  { weekday: 1, starts: "09:00", ends: "17:00" },
  { weekday: 2, starts: "09:00", ends: "17:00" },
  { weekday: 3, starts: "09:00", ends: "17:00" },
  { weekday: 4, starts: "09:00", ends: "17:00" },
  { weekday: 5, starts: "09:00", ends: "16:00" },
  { weekday: 6, starts: "10:00", ends: "14:00" },
];

/**
 * Upcoming events, dated relative to install so the playground always has
 * something next month: one free, two paid.
 */
export const EVENTS = [
  {
    slug: "open-studio-print-sale",
    name: "Open studio and print sale",
    summary:
      "Drop in, see the prints on the wall, and take home last season's test prints at cost. Free; coffee from the boatyard café.",
    daysAhead: 9,
    startHour: 11,
    hours: 4,
    capacity: 60,
    ticket: { name: "Free entry", priceMinor: 0 },
  },
  {
    slug: "golden-hour-workshop",
    name: "Golden-hour beach workshop",
    summary:
      "Two hours on Goose Spit learning to read evening light with whatever camera you own — a phone is fine. Eight places.",
    daysAhead: 16,
    startHour: 17,
    hours: 2,
    capacity: 8,
    ticket: { name: "Workshop place", priceMinor: 9500 },
  },
  {
    slug: "winter-portrait-day",
    name: "Winter portrait day",
    summary:
      "Twenty-minute studio portraits for families and pets, booked in slots, with five edited pictures each.",
    daysAhead: 34,
    startHour: 10,
    hours: 6,
    capacity: 18,
    ticket: { name: "Twenty-minute slot", priceMinor: 6000 },
  },
];

/**
 * Pages that are the site rather than content (C1.38). The share bar belongs
 * on things people pass along — journal posts, products, events — not on the
 * contact form; these are switched off through the owner's own share
 * control, so an owner can switch any of them back on.
 */
export const SHARE_OFF = [
  "",
  "services",
  "services/weddings",
  "services/portraits",
  "planning",
  "about",
  "contact",
  "blog",
  "newsletters",
  "locations",
  "locations/courtenay",
  "products",
  "events",
  "c/prints",
  "c/gifts",
];
