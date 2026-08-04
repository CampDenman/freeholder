// Copyright (C) 2026 Camp Denman Society
// SPDX-License-Identifier: AGPL-3.0-only
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

/** Which generated image a block wants. Resolved to asset ids at install. */
export type ImageSlot = "coastline" | "portrait" | "studio";

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
  enabledLocales: ["en"],
  baseCurrency: "CAD",
  timezone: "America/Vancouver",
  units: "metric" as const,
  firstDayOfWeek: 1,
};

export const IMAGES: Record<ImageSlot, { filename: string; alt: string; svg: string }> = {
  coastline: {
    filename: "aurora-coast-shoreline.jpg",
    // Alt text that describes rather than labels: §5 wants images described,
    // and "image1.jpg" passing a gate is how alt text becomes decoration.
    alt: "Low tide on a pebble shoreline at dusk, with fog on the far headland",
    svg: gradient("#1f3347", "#7796ad", "#c9d6de"),
  },
  portrait: {
    filename: "aurora-coast-portrait.jpg",
    alt: "A portrait session on the beach, shot into the last of the evening light",
    svg: gradient("#3a2b2b", "#a2705c", "#e8cbb2"),
  },
  studio: {
    filename: "aurora-coast-studio.jpg",
    alt: "The studio on a grey morning, prints drying along the north wall",
    svg: gradient("#2b2f2c", "#6f7d7f", "#cdd6cd"),
  },
};

/**
 * A placeholder that is honest about being one.
 *
 * Real photographs cannot ship here: they would be somebody's copyright, tens
 * of megabytes in a repository that has to stay cloneable, and a licence
 * question on every fork. Generated bands of colour are none of those things,
 * and they still exercise what matters — sharp reads them, renditions are
 * built at every width, `<picture>` gets real AVIF and WebP sources, and the
 * page reserves real intrinsic dimensions.
 */
function gradient(from: string, via: string, to: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="1067">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="0.35" y2="1">
      <stop offset="0%" stop-color="${from}"/>
      <stop offset="55%" stop-color="${via}"/>
      <stop offset="100%" stop-color="${to}"/>
    </linearGradient>
  </defs>
  <rect width="1600" height="1067" fill="url(#g)"/>
  <rect y="712" width="1600" height="3" fill="${from}" opacity="0.35"/>
  <rect y="760" width="1600" height="1" fill="${from}" opacity="0.25"/>
</svg>`;
}

const NAV_LINKS = [
  { label: "Services", href: "/services" },
  { label: "About", href: "/about" },
  { label: "Contact", href: "/contact" },
];

export function header(): BlockNode[] {
  return [
    {
      id: "seed-header",
      type: "columns",
      props: { count: 2, gap: "normal" },
      children: [
        {
          id: "seed-header-brand",
          type: "brand",
          props: { href: "/", showTagline: true },
        },
        {
          id: "seed-header-nav",
          type: "nav",
          props: { links: NAV_LINKS, ariaLabelKey: "cms.nav.primary" },
        },
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
          id: "seed-footer-text",
          type: "text",
          props: {
            body: `${BUSINESS.name}\nComox Valley, British Columbia\nhello@auroracoast.example`,
            align: "start",
            measure: true,
          },
        },
        {
          id: "seed-footer-nav",
          type: "nav",
          props: {
            // Every page is reachable from the chrome, which is what keeps the
            // site inside §5's three-hops rule without anyone checking by hand.
            links: [
              ...NAV_LINKS,
              { label: "Weddings", href: "/services/weddings" },
              { label: "Portraits", href: "/services/portraits" },
            ],
            ariaLabelKey: "cms.nav.primary",
          },
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

export const PAGES: SeedPage[] = [
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
          body: "Three things, done properly, rather than everything done adequately.",
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
      { id: "svc-img", type: "image", props: { assetId: a.studio, width: "wide", rounded: true } },
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
      { id: "wed-img", type: "image", props: { assetId: a.coastline, width: "wide", rounded: true } },
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
      { id: "por-cta", type: "button", props: { label: "Book a session", href: "/contact", variant: "solid" } },
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
