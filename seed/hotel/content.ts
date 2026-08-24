// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
import { contactForm, industrySeed, inquiryForm } from "../industry-kit";

const pack = industrySeed({
  name: "Your Inn",
  tagline: "Rooms they have. Rates they published.",
  schemaType: "Hotel",
  locationSlug: "inn",
  street: "1 Example Lane",
  unit: "",
  email: "hello@example.inn",
  colors: ["#241c16", "#5a4636", "#e6d7c4"],
  alts: {
    hero: "An empty lobby with a wooden desk and late light on the floor",
    work: "A made guest room with closed curtains and a blank notepad",
    desk: "A reservation book and a key tray on a quiet front desk",
  },
  nav: [
    { label: "Rooms", href: "/rooms" },
    { label: "Reserve", href: "/reserve" },
    { label: "Packages", href: "/packages" },
    { label: "Events", href: "/events" },
    { label: "Guide", href: "/guide" },
    { label: "Ask", href: "/twin" },
    { label: "Contact", href: "/contact" },
  ],
  forms: [
    inquiryForm(
      "reserve",
      "Reservation request",
      "Request a stay",
      "Thank you. They will confirm from rooms they have. This is not a guaranteed room.",
      [
        { key: "arrive", label: "Arrival", kind: "text", required: true },
        { key: "depart", label: "Departure", kind: "text", required: true },
      ],
    ),
    contactForm("Thank you. The inn will reply."),
  ],
  pages: [
    {
      slug: "",
      title: "Your Inn",
      seoTitle: "Your Inn",
      seoDesc: "Rooms they have. Rates they published. No fabricated last room.",
      h1: "Rooms they have. Rates they published.",
      body: "This is a starting site for a real inn. Replace the name, rooms, and rates with facts you can stand behind.\n\nA request is not a guaranteed room.",
      image: "hero",
      cta: { label: "Request a stay", href: "/reserve" },
      extraCtas: [
        { label: "Rooms", href: "/rooms" },
        { label: "Packages", href: "/packages" },
      ],
    },
    {
      slug: "rooms",
      title: "Rooms",
      seoTitle: "Rooms they have",
      seoDesc: "Accessible facts labeled. No invented inventory.",
      h1: "Rooms",
      body: "Describe rooms they have. Label accessible facts they supplied. Do not invent a last room.",
      image: "work",
    },
    {
      slug: "reserve",
      title: "Reserve",
      seoTitle: "Request a stay",
      seoDesc: "Rates they published. A request is not a guaranteed room.",
      h1: "Reserve",
      body: "Ask for dates. Rates they published stay visible. This is not a guaranteed room and not fabricated scarcity.",
      formSlug: "reserve",
    },
    {
      slug: "packages",
      title: "Packages",
      seoTitle: "Packages they named",
      seoDesc: "Offers they actually sell.",
      h1: "Packages",
      body: "List packages they named. Do not invent a night.",
    },
    {
      slug: "events",
      title: "Events",
      seoTitle: "Spaces they rent",
      seoDesc: "Rooms they actually hire out.",
      h1: "Events",
      body: "Name spaces they rent. An inquiry is not a hold.",
    },
    {
      slug: "guide",
      title: "Guest guide",
      seoTitle: "Guides they wrote",
      seoDesc: "House facts they supplied.",
      h1: "Guest guide",
      body: "Publish guides they wrote. Do not invent a checkout time.",
    },
    {
      slug: "area",
      title: "Local area",
      seoTitle: "Places they recommend",
      seoDesc: "Recommendations they supplied.",
      h1: "Local area",
      body: "Recommend places they actually named. Do not invent a partner.",
    },
    {
      slug: "twin",
      title: "Ask the inn",
      seoTitle: "Ask the inn",
      seoDesc: "Answers from approved facts. No invented last room.",
      h1: "Ask the inn",
      body: "The twin answers from facts they approved. It must not invent a last room or a rate.",
      cta: { label: "Request a stay", href: "/reserve", variant: "quiet" },
    },
    {
      slug: "contact",
      title: "Contact",
      seoTitle: "Contact the inn",
      seoDesc: "Phone, email, and hours they supplied.",
      h1: "Contact",
      body: "For a stay, use Reserve. Use this page for a general message.",
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
