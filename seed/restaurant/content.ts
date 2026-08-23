// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
import { contactForm, industrySeed, inquiryForm } from "../industry-kit";

const pack = industrySeed({
  name: "Your Restaurant",
  tagline: "The menu they cook today. The tables they can seat.",
  schemaType: "Restaurant",
  locationSlug: "dining-room",
  street: "12 Example Avenue",
  unit: "",
  email: "hello@example.restaurant",
  colors: ["#2a1812", "#6b3a28", "#e4c9a0"],
  alts: {
    hero: "An empty dining room with set tables and late-afternoon light",
    work: "A pass window with empty plates stacked beside a quiet stove",
    desk: "A reservation book and a pencil on a wooden host stand",
  },
  nav: [
    { label: "Menu", href: "/menu" },
    { label: "Reservations", href: "/reservations" },
    { label: "Order", href: "/order" },
    { label: "Events", href: "/events" },
    { label: "Ask", href: "/twin" },
    { label: "Contact", href: "/contact" },
  ],
  forms: [
    inquiryForm(
      "reservations",
      "Reservation request",
      "Request a table",
      "Thank you. They will confirm from tables they can actually seat. This is not a guaranteed table.",
      [
        { key: "date", label: "Requested date", kind: "text", required: true },
        { key: "party", label: "Party size", kind: "text", required: true },
      ],
    ),
    contactForm("Thank you. The restaurant will reply."),
  ],
  pages: [
    {
      slug: "",
      title: "Your Restaurant",
      seoTitle: "Your Restaurant",
      seoDesc: "The menu they cook today. Tables they can actually seat.",
      h1: "The menu they cook today.",
      body: "This is a starting site for a real restaurant. Replace the name, menu, and hours with facts you can stand behind.\n\nA request is not a guaranteed table. Do not invent a wait or a sold-out night.",
      image: "hero",
      cta: { label: "Request a table", href: "/reservations" },
      extraCtas: [
        { label: "Menu", href: "/menu" },
        { label: "Order", href: "/order" },
        { label: "Events", href: "/events" },
      ],
    },
    {
      slug: "menu",
      title: "Menu",
      seoTitle: "Menu they cook today",
      seoDesc: "Items they named. Allergens they supplied. Prices they set.",
      h1: "Menu",
      body: "Publish items they cook today, at prices they set, with allergens they supplied. Do not invent scarcity.",
      image: "work",
    },
    {
      slug: "reservations",
      title: "Reservations",
      seoTitle: "Tables they can seat",
      seoDesc: "Times they offer. A request is not a guaranteed table.",
      h1: "Reservations",
      body: "Ask for a time they offer. This is not a guaranteed table and not a fabricated wait.",
      formSlug: "reservations",
    },
    {
      slug: "order",
      title: "Order",
      seoTitle: "Pickup or delivery they run",
      seoDesc: "Zones they configured. Prices they set.",
      h1: "Order",
      body: "Use this page only if they run pickup or delivery. Zones they configured. Do not invent a zone.",
    },
    {
      slug: "events",
      title: "Private events",
      seoTitle: "Rooms they rent",
      seoDesc: "Spaces they named. Inquiry is not a hold.",
      h1: "Private events",
      body: "Name rooms they actually rent. An inquiry is not a hold.",
    },
    {
      slug: "experiences",
      title: "Experiences",
      seoTitle: "Experiences they run",
      seoDesc: "Tastings they named. Missing list stays empty.",
      h1: "Experiences",
      body: "List tastings or chef's table they actually run. Do not invent a night.",
    },
    {
      slug: "gifts",
      title: "Gifts",
      seoTitle: "Cards they sell",
      seoDesc: "Terms they supplied. No invented balance.",
      h1: "Gifts and loyalty",
      body: "Publish cards they sell and terms they wrote. Do not invent a balance.",
    },
    {
      slug: "twin",
      title: "Ask the restaurant",
      seoTitle: "Ask the restaurant",
      seoDesc: "Answers from approved facts. No invented wait.",
      h1: "Ask the restaurant",
      body: "The twin answers from facts they approved. It must not invent a wait time or a sold-out night.",
      cta: { label: "Request a table", href: "/reservations", variant: "quiet" },
    },
    {
      slug: "contact",
      title: "Contact",
      seoTitle: "Contact the restaurant",
      seoDesc: "Phone, email, and hours they supplied.",
      h1: "Contact",
      body: "For a table, use Reservations. Use this page for a general message.",
      formSlug: "contact",
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
