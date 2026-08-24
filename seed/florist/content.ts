// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
import { contactForm, industrySeed, inquiryForm } from "../industry-kit";

const pack = industrySeed({
  name: "Your Flower Shop",
  tagline: "Stems they have today. Deliveries they can make.",
  schemaType: "Florist",
  locationSlug: "shop",
  street: "18 Example Street",
  unit: "",
  email: "hello@example.florist",
  colors: ["#2a1e22", "#6e3d4a", "#e8d3c4"],
  alts: {
    hero: "A quiet shop counter with empty buckets and morning window light",
    work: "A work table with shears, ribbon, and a blank order slip",
    desk: "A delivery clipboard and a paper map folded on a wooden desk",
  },
  nav: [
    { label: "Shop", href: "/shop" },
    { label: "Weddings", href: "/weddings" },
    { label: "Delivery", href: "/delivery" },
    { label: "Gallery", href: "/gallery" },
    { label: "Ask", href: "/twin" },
    { label: "Contact", href: "/contact" },
  ],
  forms: [
    inquiryForm(
      "order",
      "Order inquiry",
      "Ask about an arrangement",
      "Thank you. They will confirm from stems they have today. This is not a same-day guarantee.",
      [{ key: "occasion", label: "Occasion", kind: "text", required: true }],
    ),
    contactForm("Thank you. The shop will reply."),
  ],
  pages: [
    {
      slug: "",
      title: "Your Flower Shop",
      seoTitle: "Your Flower Shop",
      seoDesc: "Stems they have today. Deliveries they can actually make.",
      h1: "Stems they have today.",
      body: "This is a starting site for a real florist. Replace the name, catalog, and zones with facts you can stand behind.\n\nAn inquiry is not a same-day slot.",
      image: "hero",
      cta: { label: "Ask about an arrangement", href: "/contact" },
      extraCtas: [
        { label: "Shop", href: "/shop" },
        { label: "Weddings", href: "/weddings" },
        { label: "Delivery", href: "/delivery" },
      ],
    },
    {
      slug: "shop",
      title: "Shop",
      seoTitle: "Items they stock",
      seoDesc: "Catalog they have. Substitution rules they set.",
      h1: "Shop",
      body: "List items they stock. Substitution rules they wrote. Do not invent a same-day arrangement.",
      image: "work",
    },
    {
      slug: "concept",
      title: "Bouquet concept",
      seoTitle: "A concept, not a product photo",
      seoDesc: "Labeled as a sketch. Not a finished product.",
      h1: "Bouquet concept",
      body: "Use this page for a sketch they approved. Label it as a concept. Do not present it as a finished product photo.",
    },
    {
      slug: "weddings",
      title: "Weddings",
      seoTitle: "Packages they named",
      seoDesc: "Event work they actually take.",
      h1: "Weddings",
      body: "Name packages they actually take. An inquiry is not a hold.",
    },
    {
      slug: "delivery",
      title: "Delivery",
      seoTitle: "Zones they cover",
      seoDesc: "Coverage they configured. No invented same-day slot.",
      h1: "Delivery",
      body: "Publish zones they actually cover. Do not invent a same-day window.",
    },
    {
      slug: "gallery",
      title: "Seasonal work",
      seoTitle: "Work they approved",
      seoDesc: "Collections they consented. Empty until they add photos.",
      h1: "Seasonal work",
      body: "Publish collections they approved. Leave this page empty rather than use another shop's photos.",
      image: "desk",
    },
    {
      slug: "journal",
      title: "Journal",
      seoTitle: "Notes they wrote",
      seoDesc: "Local notes they approved.",
      h1: "Journal",
      body: "Publish notes they wrote. Do not invent a farm or a season.",
    },
    {
      slug: "twin",
      title: "Ask the shop",
      seoTitle: "Ask the shop",
      seoDesc: "Answers from approved facts. No invented same-day slot.",
      h1: "Ask the shop",
      body: "The twin answers from facts they approved. It must not invent a same-day slot or a stem they do not have.",
    },
    {
      slug: "contact",
      title: "Contact",
      seoTitle: "Contact the shop",
      seoDesc: "Phone, email, and hours they supplied.",
      h1: "Contact",
      body: "Ask about an arrangement they can actually make. This is not a same-day guarantee.",
      formSlug: "order",
    },
  ],
});

export const BUSINESS = pack.BUSINESS;
export const LOCATION = pack.LOCATION;
export const HOURS = pack.HOURS;
export const IMAGES = pack.IMAGES;
export const FORMS = pack.FORMS;
export const TRANSLATIONS = pack.TRANSLATIONS;
export const PAGES = pack.PAGES;
export const header = pack.header;
export const footer = pack.footer;
