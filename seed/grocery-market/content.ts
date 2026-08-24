// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
import { contactForm, industrySeed, inquiryForm } from "../industry-kit";

const pack = industrySeed({
  name: "Your Market",
  tagline: "What they have today. Windows they can fill.",
  schemaType: "GroceryStore",
  locationSlug: "market",
  street: "7 Example Market Street",
  unit: "",
  email: "hello@example.market",
  colors: ["#1e2418", "#4a5a32", "#e2d8b8"],
  alts: {
    hero: "A quiet produce aisle with empty bins and morning skylight",
    work: "A butcher paper roll and a blank specials board",
    desk: "A pickup clipboard and paper bags on a wooden counter",
  },
  nav: [
    { label: "Departments", href: "/departments" },
    { label: "Specials", href: "/specials" },
    { label: "Prepared", href: "/prepared" },
    { label: "Pickup", href: "/pickup" },
    { label: "Ask", href: "/twin" },
    { label: "Visit", href: "/contact" },
  ],
  forms: [
    inquiryForm(
      "pickup",
      "Pickup request",
      "Request a pickup window",
      "Thank you. They will confirm from windows they configured. This is not guaranteed stock.",
      [{ key: "items", label: "What do you need?", kind: "multiline", required: true }],
    ),
    contactForm("Thank you. The market will reply."),
  ],
  pages: [
    {
      slug: "",
      title: "Your Market",
      seoTitle: "Your Market",
      seoDesc: "What they have today. Pickup windows they can fill.",
      h1: "What they have today.",
      body: "This is a starting site for a real market. Replace the name, departments, and specials with facts they published.\n\nA pickup request is not guaranteed stock.",
      image: "hero",
      cta: { label: "Request a pickup window", href: "/pickup" },
      extraCtas: [
        { label: "Departments", href: "/departments" },
        { label: "Specials", href: "/specials" },
      ],
    },
    {
      slug: "departments",
      title: "Departments",
      seoTitle: "Departments they run",
      seoDesc: "Sections they actually operate.",
      h1: "Departments",
      body: "List departments they run. Do not invent stock.",
      image: "work",
    },
    {
      slug: "specials",
      title: "Specials",
      seoTitle: "Specials they published",
      seoDesc: "Timestamps they set. No invented price.",
      h1: "Specials",
      body: "Publish specials they named, with the time they set. Do not invent a price.",
    },
    {
      slug: "prepared",
      title: "Prepared",
      seoTitle: "Items they make today",
      seoDesc: "Prepared food they actually make.",
      h1: "Prepared",
      body: "List items they make today. Missing list stays empty.",
    },
    {
      slug: "vendors",
      title: "Vendors",
      seoTitle: "Suppliers they named",
      seoDesc: "Stories they approved.",
      h1: "Vendors",
      body: "Name suppliers they actually buy from. Do not invent a farm.",
    },
    {
      slug: "pickup",
      title: "Pickup",
      seoTitle: "Windows they configured",
      seoDesc: "Not guaranteed stock.",
      h1: "Pickup",
      body: "Ask for a window they configured. This is not guaranteed stock.",
      formSlug: "pickup",
    },
    {
      slug: "recipes",
      title: "Recipes",
      seoTitle: "Recipes they wrote",
      seoDesc: "Notes they approved.",
      h1: "Recipes",
      body: "Publish recipes they wrote. Do not invent an ingredient they do not sell.",
      image: "desk",
    },
    {
      slug: "twin",
      title: "Ask the market",
      seoTitle: "Ask the market",
      seoDesc: "No invented stock.",
      h1: "Ask the market",
      body: "The twin answers from facts they approved. It must not invent stock or a price.",
      cta: { label: "Request a pickup window", href: "/pickup", variant: "quiet" },
    },
    {
      slug: "contact",
      title: "Hours and location",
      seoTitle: "Visit the market",
      seoDesc: "Address and hours they supplied.",
      h1: "Hours and location",
      body: "For pickup, use Pickup. Use this page for hours and the address they supplied.",
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
