// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Seeded page/post/product/service/email templates (C2.13).
//
// §32: "Default templates ship per business preset as seed data, so day one
// still looks designed." These are starting trees, never cages — create-from-
// template copies them, reset-to-default restores them.
import type { BlockNode } from "./blocks/types";
import type { TemplateKind, TemplatePreset } from "./schema";

export const TEMPLATE_KEYS = [
  "page.blank",
  "page.landing",
  "post.article",
  "product.default",
  "service.default",
  "email.transactional",
] as const;

export type TemplateKey = (typeof TEMPLATE_KEYS)[number];

export interface SeedTemplate {
  key: TemplateKey;
  kind: TemplateKind;
  name: string;
  blocks: BlockNode[];
}

function heading(id: string, text: string, level: 1 | 2 = 1): BlockNode {
  return { id, type: "heading", props: { text, level, align: "start" } };
}

function body(id: string, text: string): BlockNode {
  return { id, type: "text", props: { body: text, align: "start", measure: true } };
}

function button(id: string, label: string, href: string): BlockNode {
  return { id, type: "button", props: { label, href, variant: "solid" } };
}

const COPY: Record<
  TemplatePreset,
  {
    landingTitle: string;
    landingBody: string;
    landingCta: string;
    postTitle: string;
    postBody: string;
    productTitle: string;
    productBody: string;
    serviceTitle: string;
    serviceBody: string;
    emailTitle: string;
    emailBody: string;
  }
> = {
  creator: {
    landingTitle: "Work worth looking at",
    landingBody:
      "A short page for the work, the story, and how to hire you. Rearrange it; this is only a start.",
    landingCta: "See the work",
    postTitle: "A note from the studio",
    postBody: "Write the piece. The heading and this paragraph are only placeholders.",
    productTitle: "This piece",
    productBody: "Describe the work, what is included, and how someone buys it.",
    serviceTitle: "Book a session",
    serviceBody: "Say what the sitting is, how long it lasts, and what happens next.",
    emailTitle: "Hello {{contact.first_name}}",
    emailBody: "This is a starting letter. Variable slots stay as written until send time.",
  },
  "service-business": {
    landingTitle: "How we can help",
    landingBody:
      "Lead with the offer, the area you serve, and a way to get in touch. Times are arranged after that.",
    landingCta: "Request a booking",
    postTitle: "From the practice",
    postBody: "A short update for clients. Replace this copy.",
    productTitle: "This service",
    productBody: "What they get, how long it takes, and what happens after they book.",
    serviceTitle: "Book this service",
    serviceBody: "Introduce the session. The booking block below is a request, not a live calendar.",
    emailTitle: "Hello {{contact.first_name}}",
    emailBody: "Confirm the next step. Variable slots stay as written until send time.",
  },
  shop: {
    landingTitle: "What we sell",
    landingBody: "A storefront page. Add products below, then change this copy to match the season.",
    landingCta: "Shop now",
    postTitle: "From the shop",
    postBody: "A note about a drop, a restock, or how something is made.",
    productTitle: "This product",
    productBody: "What it is, who it is for, and what arrives with it.",
    serviceTitle: "This service",
    serviceBody: "If you also take bookings, start from here.",
    emailTitle: "Hello {{contact.first_name}}",
    emailBody: "A receipt or a dispatch note starts here. Variable slots stay as written until send time.",
  },
  everything: {
    landingTitle: "Welcome",
    landingBody:
      "This page is a block tree in your database. Rearranging it is a save, not a deploy.",
    landingCta: "Get in touch",
    postTitle: "A new post",
    postBody: "Write the piece. The heading and this paragraph are only placeholders.",
    productTitle: "This product",
    productBody: "Describe what they get. Bind this layout to a live product when you publish it.",
    serviceTitle: "This service",
    serviceBody: "Describe the session. The booking block is a request, not a live calendar.",
    emailTitle: "Hello {{contact.first_name}}",
    emailBody: "A transactional letter starts here. Variable slots stay as written until send time.",
  },
  custom: {
    landingTitle: "Welcome",
    landingBody:
      "This page is a block tree in your database. Rearranging it is a save, not a deploy.",
    landingCta: "Get in touch",
    postTitle: "A new post",
    postBody: "Write the piece. The heading and this paragraph are only placeholders.",
    productTitle: "This product",
    productBody: "Describe what they get. Bind this layout to a live product when you publish it.",
    serviceTitle: "This service",
    serviceBody: "Describe the session. The booking block is a request, not a live calendar.",
    emailTitle: "Hello {{contact.first_name}}",
    emailBody: "A transactional letter starts here. Variable slots stay as written until send time.",
  },
};

export function seedTemplates(preset: TemplatePreset): SeedTemplate[] {
  const copy = COPY[preset];
  const landingChildren: BlockNode[] = [
    heading(`${preset}-landing-h1`, copy.landingTitle),
    body(`${preset}-landing-intro`, copy.landingBody),
    button(
      `${preset}-landing-cta`,
      copy.landingCta,
      preset === "shop" ? "/products" : "/contact",
    ),
  ];
  if (preset === "shop") {
    landingChildren.push({
      id: `${preset}-landing-index`,
      type: "productsIndex",
      props: { showSubtitle: true },
    });
  }
  if (preset === "service-business") {
    landingChildren.push({
      id: `${preset}-landing-book`,
      type: "booking",
      props: { slug: "session", ctaHref: "/contact" },
    });
  }

  return [
    {
      key: "page.blank",
      kind: "page",
      name: "Blank page",
      blocks: [heading(`${preset}-blank-h1`, "Untitled page")],
    },
    {
      key: "page.landing",
      kind: "page",
      name: "Landing page",
      blocks: landingChildren,
    },
    {
      key: "post.article",
      kind: "post",
      name: "Article",
      blocks: [
        heading(`${preset}-post-h1`, copy.postTitle),
        body(`${preset}-post-body`, copy.postBody),
      ],
    },
    {
      key: "product.default",
      kind: "product",
      name: "Product page",
      blocks: [
        heading(`${preset}-product-h1`, copy.productTitle),
        body(`${preset}-product-body`, copy.productBody),
      ],
    },
    {
      key: "service.default",
      kind: "service",
      name: "Service page",
      blocks: [
        heading(`${preset}-service-h1`, copy.serviceTitle),
        body(`${preset}-service-body`, copy.serviceBody),
        {
          id: `${preset}-service-book`,
          type: "booking",
          props: { slug: "session", ctaHref: "/contact" },
        },
      ],
    },
    {
      key: "email.transactional",
      kind: "email",
      name: "Transactional email",
      blocks: [
        heading(`${preset}-email-h1`, copy.emailTitle),
        body(`${preset}-email-body`, copy.emailBody),
      ],
    },
  ];
}

export function slugFromTitle(title: string): string {
  const slug = title
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return slug;
}
