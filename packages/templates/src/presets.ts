// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Business presets (C3.15, MASTER.md §32). Independently publishable: no
// application imports. The app installs these trees through CMS, catalog,
// forms and design services.

/**
 * Platform Bench, the working surface packages/templates overrides.
 * Hex values must stay the platform light tokens (tests/core/colour-literals.test.ts).
 */
export const BENCH_TOKENS = {
  paper: "#fafaf8",
  ink: "#23262a",
  accent: "#2551e0",
  radius: "md",
  measure: "wide",
} as const;

export const RADIUS_CSS = {
  sm: "0.25rem",
  md: "0.375rem",
  lg: "0.5rem",
} as const;

export const MEASURE_CSS = {
  narrow: "36rem",
  standard: "48rem",
  wide: "56rem",
} as const;

/** Social hub in every normal preset. Connect and publish stay explicit. */
export const SOCIAL_SURFACE = {
  href: "/admin/social",
  autoAuthorize: false,
  autoPublish: false,
} as const;

export interface TemplateBlock {
  id: string;
  type: string;
  props: Record<string, unknown>;
  children?: TemplateBlock[];
}

export interface PresetPage {
  slug: string;
  title: string;
  blocks: TemplateBlock[];
}

export interface PresetEntity {
  type: "product" | "service";
  template: "product-page" | "service-page";
  name: string;
  slug: string;
  kind: "physical" | "digital" | "service";
  description: TemplateBlock[];
}

export interface PresetEmail {
  key: string;
  name: string;
  slots: readonly string[];
  variables: readonly string[];
  blocks: TemplateBlock[];
}

export interface PresetForm {
  slug: string;
  name: string;
  submitLabel: string;
  successMessage: string;
  fields: { key: string; label: string; kind: "text" | "email" | "multiline"; required: boolean }[];
}

export interface PresetTokens {
  paper: string;
  ink: string;
  accent: string;
  radius: keyof typeof RADIUS_CSS;
  measure: keyof typeof MEASURE_CSS;
}

export interface BusinessPreset {
  name: string;
  tokens: PresetTokens;
  pages: readonly PresetPage[];
  entities: readonly PresetEntity[];
  emails: readonly PresetEmail[];
  forms: readonly PresetForm[];
  seed: { pages: number; contacts: number };
  social: typeof SOCIAL_SURFACE;
}

function heading(id: string, text: string, level: 1 | 2 = 1): TemplateBlock {
  return { id, type: "heading", props: { text, level, align: "start" } };
}

function body(id: string, text: string): TemplateBlock {
  return { id, type: "text", props: { body: text, align: "start", measure: true } };
}

function button(id: string, label: string, href: string): TemplateBlock {
  return { id, type: "button", props: { label, href, variant: "solid" } };
}

function image(id: string): TemplateBlock {
  return { id, type: "image", props: { decorative: false, width: "wide", rounded: true } };
}

function formBlock(id: string, formSlug: string): TemplateBlock {
  return { id, type: "form", props: { formSlug } };
}

const CONTACT_FORM: PresetForm = {
  slug: "contact",
  name: "Contact",
  submitLabel: "Send",
  successMessage: "Thanks — we will write back.",
  fields: [
    { key: "name", label: "Name", kind: "text", required: true },
    { key: "email", label: "Email", kind: "email", required: true },
    { key: "message", label: "Message", kind: "multiline", required: true },
  ],
};

function welcomeEmail(prefix: string): PresetEmail {
  return {
    key: "welcome",
    name: "Welcome",
    slots: ["name", "siteName"],
    variables: ["contact.first_name", "business.name"],
    blocks: [
      heading(`${prefix}-welcome-h1`, "Hello {{contact.first_name}}"),
      body(
        `${prefix}-welcome-body`,
        "Welcome to {{business.name}}. This letter is a starting point; variable slots stay as written until send time.",
      ),
    ],
  };
}

function bookingEmail(prefix: string): PresetEmail {
  return {
    key: "booking-confirm",
    name: "Booking confirmation",
    slots: ["name", "startsAt"],
    variables: ["contact.first_name", "booking.starts_at_local"],
    blocks: [
      heading(`${prefix}-booking-h1`, "See you soon, {{contact.first_name}}"),
      body(
        `${prefix}-booking-body`,
        "Your booking is at {{booking.starts_at_local}}. Reply if you need to change it.",
      ),
    ],
  };
}

function receiptEmail(prefix: string): PresetEmail {
  return {
    key: "order-receipt",
    name: "Order receipt",
    slots: ["name", "total"],
    variables: ["contact.first_name", "invoice.total"],
    blocks: [
      heading(`${prefix}-receipt-h1`, "Thank you, {{contact.first_name}}"),
      body(
        `${prefix}-receipt-body`,
        "Your order total is {{invoice.total}}. Keep this note as your receipt.",
      ),
    ],
  };
}

export const PRESETS: Record<"creator" | "service-business" | "shop" | "community", BusinessPreset> = {
  creator: {
    name: "Creator",
    tokens: { ...BENCH_TOKENS, measure: "narrow" },
    pages: [
      {
        slug: "home",
        title: "Home",
        blocks: [
          heading("creator-home-h1", "Work worth looking at"),
          body(
            "creator-home-intro",
            "A short page for the work, the story, and how to hire you. Rearrange it; this is only a start.",
          ),
          image("creator-home-image"),
          button("creator-home-cta", "See the work", "/about"),
        ],
      },
      {
        slug: "about",
        title: "About",
        blocks: [
          heading("creator-about-h1", "About the studio"),
          body("creator-about-body", "Say who you are, where you work, and what a collaboration looks like."),
        ],
      },
      {
        slug: "contact",
        title: "Contact",
        blocks: [
          heading("creator-contact-h1", "Get in touch"),
          formBlock("creator-contact-form", "contact"),
        ],
      },
    ],
    entities: [
      {
        type: "product",
        template: "product-page",
        name: "Featured work",
        slug: "featured-work",
        kind: "digital",
        description: [
          heading("creator-product-h1", "This piece", 2),
          body("creator-product-body", "Describe the work, what is included, and how someone buys it."),
        ],
      },
    ],
    emails: [welcomeEmail("creator")],
    forms: [CONTACT_FORM],
    seed: { pages: 3, contacts: 0 },
    social: SOCIAL_SURFACE,
  },
  "service-business": {
    name: "Service business",
    tokens: { ...BENCH_TOKENS, radius: "sm" },
    pages: [
      {
        slug: "home",
        title: "Home",
        blocks: [
          heading("service-home-h1", "How we can help"),
          body(
            "service-home-intro",
            "Lead with the offer, the area you serve, and a way to get in touch. Times are arranged after that.",
          ),
          button("service-home-cta", "Request a booking", "/contact"),
        ],
      },
      {
        slug: "services",
        title: "Services",
        blocks: [
          heading("service-services-h1", "Services"),
          body("service-services-body", "List what you offer. Each item can later bind to a live service page."),
        ],
      },
      {
        slug: "about",
        title: "About",
        blocks: [
          heading("service-about-h1", "About the practice"),
          body("service-about-body", "A short introduction. Replace this copy."),
        ],
      },
      {
        slug: "contact",
        title: "Contact",
        blocks: [
          heading("service-contact-h1", "Request a booking"),
          formBlock("service-contact-form", "contact"),
        ],
      },
    ],
    entities: [
      {
        type: "service",
        template: "service-page",
        name: "Session",
        slug: "session",
        kind: "service",
        description: [
          heading("service-offering-h1", "Book a session", 2),
          body("service-offering-body", "Say what the sitting is, how long it lasts, and what happens next."),
        ],
      },
    ],
    emails: [bookingEmail("service")],
    forms: [CONTACT_FORM],
    seed: { pages: 4, contacts: 0 },
    social: SOCIAL_SURFACE,
  },
  shop: {
    name: "Shop",
    tokens: { ...BENCH_TOKENS },
    pages: [
      {
        slug: "home",
        title: "Home",
        blocks: [
          heading("shop-home-h1", "What we sell"),
          body(
            "shop-home-intro",
            "A storefront page. Add products below, then change this copy to match the season.",
          ),
          image("shop-home-image"),
          { id: "shop-home-index", type: "productsIndex", props: { showSubtitle: true } },
          button("shop-home-cta", "Shop now", "/products"),
        ],
      },
      {
        slug: "products",
        title: "Products",
        blocks: [
          heading("shop-products-h1", "Products"),
          { id: "shop-products-index", type: "productsIndex", props: { showSubtitle: true } },
        ],
      },
      {
        slug: "about",
        title: "About",
        blocks: [
          heading("shop-about-h1", "About the shop"),
          body("shop-about-body", "How things are made, and who they are for."),
        ],
      },
      {
        slug: "contact",
        title: "Contact",
        blocks: [
          heading("shop-contact-h1", "Contact"),
          formBlock("shop-contact-form", "contact"),
        ],
      },
    ],
    entities: [
      {
        type: "product",
        template: "product-page",
        name: "Featured product",
        slug: "featured-product",
        kind: "physical",
        description: [
          heading("shop-product-h1", "This product", 2),
          body("shop-product-body", "What it is, who it is for, and what arrives with it."),
        ],
      },
    ],
    emails: [receiptEmail("shop")],
    forms: [CONTACT_FORM],
    seed: { pages: 4, contacts: 0 },
    social: SOCIAL_SURFACE,
  },
  // C12.31: a site whose product is its members (MASTER.md §44).
  community: {
    name: "Community",
    tokens: { ...BENCH_TOKENS, radius: "lg" },
    pages: [
      {
        slug: "home",
        title: "Home",
        blocks: [
          heading("community-home-h1", "A place for people who make things"),
          body(
            "community-home-intro",
            "Join to post your work, follow people you like, talk privately, call each other, and buy and sell among members. Say who this community is for; this is only a start.",
          ),
          button("community-home-join", "Join", "/join"),
          button("community-home-feed", "See what members are sharing", "/feed?view=latest"),
          button("community-home-market", "Visit the market", "/market"),
        ],
      },
      {
        slug: "guidelines",
        title: "Community guidelines",
        blocks: [
          heading("community-guidelines-h1", "How we look after each other"),
          body(
            "community-guidelines-body",
            "Be kind, keep private things private, and sell only what you have the right to sell. Anything can be reported, and the site's moderators decide. What may not be sold is set out at /market/policy. Write your own rules here.",
          ),
        ],
      },
      {
        slug: "about",
        title: "About",
        blocks: [
          heading("community-about-h1", "About this community"),
          body("community-about-body", "Who runs it, why it exists, and how members are welcomed."),
        ],
      },
      {
        slug: "contact",
        title: "Contact",
        blocks: [
          heading("community-contact-h1", "Contact the organisers"),
          formBlock("community-contact-form", "contact"),
        ],
      },
    ],
    entities: [
      {
        type: "product",
        template: "product-page",
        name: "Supporter pass",
        slug: "supporter-pass",
        kind: "digital",
        description: [
          heading("community-product-h1", "Support the community", 2),
          body("community-product-body", "What a supporter's contribution pays for, and what they receive."),
        ],
      },
    ],
    emails: [welcomeEmail("community")],
    forms: [CONTACT_FORM],
    seed: { pages: 4, contacts: 0 },
    social: SOCIAL_SURFACE,
  },
};

export type PresetKey = keyof typeof PRESETS;

export function preset(key: PresetKey): BusinessPreset {
  return PRESETS[key];
}

export function listPresets(): PresetKey[] {
  return Object.keys(PRESETS) as PresetKey[];
}

export function cmsPageSlug(slug: string): string {
  return slug === "home" ? "" : slug;
}

export function designExtras(tokens: PresetTokens): { radius: string; measure: string } {
  return {
    radius: RADIUS_CSS[tokens.radius],
    measure: MEASURE_CSS[tokens.measure],
  };
}

export function emailTemplateKey(emailKey: string): string {
  return `email.${emailKey}`;
}

export function entityTemplateKey(template: PresetEntity["template"]): "product.default" | "service.default" {
  return template === "service-page" ? "service.default" : "product.default";
}
