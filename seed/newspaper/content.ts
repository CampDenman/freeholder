// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
import { contactForm, industrySeed, inquiryForm } from "../industry-kit";

const pack = industrySeed({
  name: "Your Gazette",
  tagline: "The day’s paper they locked. The archive they keep.",
  schemaType: "NewsMediaOrganization",
  locationSlug: "press",
  street: "10 Example Press Street",
  unit: "",
  email: "desk@example.gazette",
  colors: ["#1a1814", "#4a4034", "#e6dcc8"],
  alts: {
    hero: "An empty press counter with a folded blank broadsheet",
    work: "A composing table with unused type drawers and a quiet lamp",
    desk: "A bound archive shelf with unlabeled year spines",
  },
  nav: [
    { label: "Today", href: "/today" },
    { label: "Archive", href: "/archive" },
    { label: "Obituaries", href: "/obituaries" },
    { label: "Classifieds", href: "/classifieds" },
    { label: "Subscribe", href: "/subscribe" },
    { label: "Ask", href: "/twin" },
    { label: "Contact", href: "/contact" },
  ],
  forms: [
    inquiryForm(
      "subscribe",
      "Subscription inquiry",
      "Ask about a subscription",
      "Thank you. They will confirm from products they actually sell. This is not a billed account.",
    ),
    contactForm("Thank you. The gazette will reply."),
  ],
  pages: [
    {
      slug: "",
      title: "Your Gazette",
      seoTitle: "Your Gazette",
      seoDesc: "The day’s paper they locked. The archive they keep.",
      h1: "The day’s paper they locked.",
      body: "This is a starting site for a real gazette. Replace the name, sections, and archive with issues they actually locked.\n\nThe twin must not write autonomous news.",
      image: "hero",
      cta: { label: "Ask about a subscription", href: "/subscribe" },
      extraCtas: [
        { label: "Today", href: "/today" },
        { label: "Archive", href: "/archive" },
      ],
    },
    {
      slug: "today",
      title: "Today",
      seoTitle: "Today’s paper they locked",
      seoDesc: "The issue they published. Not an invented front page.",
      h1: "Today",
      body: "Publish the issue they locked. Do not invent a front page.",
      image: "work",
    },
    {
      slug: "archive",
      title: "Archive",
      seoTitle: "Issues they keep",
      seoDesc: "The archive they actually retain.",
      h1: "Archive",
      body: "Keep issues they retain. Do not invent a back issue.",
      image: "desk",
    },
    {
      slug: "obituaries",
      title: "Obituaries",
      seoTitle: "Notices they published",
      seoDesc: "Only notices families supplied.",
      h1: "Obituaries",
      body: "Publish notices they received. Do not invent a death notice.",
    },
    {
      slug: "classifieds",
      title: "Classifieds",
      seoTitle: "Ads they accepted",
      seoDesc: "Listings they actually ran.",
      h1: "Classifieds",
      body: "Publish ads they accepted. Do not invent a listing.",
    },
    {
      slug: "subscribe",
      title: "Subscribe",
      seoTitle: "Products they sell",
      seoDesc: "Not a billed account until they confirm.",
      h1: "Subscribe",
      body: "Ask about products they sell. This is not a billed account.",
      formSlug: "subscribe",
    },
    {
      slug: "twin",
      title: "Ask the gazette",
      seoTitle: "Ask the gazette",
      seoDesc: "No autonomous news.",
      h1: "Ask the gazette",
      body: "The twin answers from issues they locked. It must not write autonomous news.",
      cta: { label: "Ask about a subscription", href: "/subscribe", variant: "quiet" },
    },
    {
      slug: "contact",
      title: "Contact",
      seoTitle: "Contact the gazette",
      seoDesc: "Desk contacts they supplied.",
      h1: "Contact",
      body: "For a subscription, use Subscribe. Use this page for a general desk message.",
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
