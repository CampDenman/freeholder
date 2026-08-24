// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
import { contactForm, industrySeed, inquiryForm } from "../industry-kit";

const pack = industrySeed({
  name: "Your Wealth Practice",
  tagline: "How they work. Meetings they offer.",
  schemaType: "FinancialService",
  locationSlug: "practice",
  street: "90 Example Plaza",
  unit: "Suite 800",
  email: "hello@example.wealth",
  colors: ["#1c1a16", "#3f3a32", "#d8d0c4"],
  alts: {
    hero: "A quiet meeting room with two chairs and a closed notebook",
    work: "A bookshelf of unlabeled binders beside a closed laptop",
    desk: "A disclosure folder and a blank notepad on a wooden desk",
  },
  nav: [
    { label: "Services", href: "/services" },
    { label: "Advisors", href: "/advisors" },
    { label: "Fit", href: "/fit" },
    { label: "Discovery", href: "/discovery" },
    { label: "Ask", href: "/twin" },
    { label: "Contact", href: "/contact" },
  ],
  forms: [
    inquiryForm(
      "discovery",
      "Discovery request",
      "Request a discovery meeting",
      "Thank you. This is not a personalized recommendation and not an offer of securities.",
      [{ key: "topic", label: "What would you like to discuss?", kind: "text", required: true }],
    ),
    contactForm("Thank you. The practice will reply."),
  ],
  pages: [
    {
      slug: "",
      title: "Your Wealth Practice",
      seoTitle: "Your Wealth Practice",
      seoDesc: "How they work. Meetings they offer. Not a personalized recommendation.",
      h1: "How they work. Meetings they offer.",
      body: "This is a starting site for a real wealth practice. Replace the name, credentials, and disclosures with facts they approved.\n\nA discovery request is not a personalized recommendation.",
      image: "hero",
      cta: { label: "Request a discovery meeting", href: "/discovery" },
      extraCtas: [
        { label: "Services", href: "/services" },
        { label: "Advisors", href: "/advisors" },
      ],
    },
    {
      slug: "services",
      title: "Services",
      seoTitle: "Services they named",
      seoDesc: "Disclosures they approved.",
      h1: "Services",
      body: "List services they named, with disclosures they approved. Do not invent a product.",
      image: "work",
    },
    {
      slug: "advisors",
      title: "Advisors",
      seoTitle: "Credentials they supplied",
      seoDesc: "People they named. No invented license.",
      h1: "Advisors",
      body: "Name advisors. Use credentials they supplied.",
    },
    {
      slug: "fit",
      title: "Fit",
      seoTitle: "Educational only",
      seoDesc: "No personalized recommendation.",
      h1: "Fit",
      body: "Educational questions they approved. This page does not recommend a security or a strategy.",
    },
    {
      slug: "discovery",
      title: "Discovery",
      seoTitle: "Meetings they offer",
      seoDesc: "Not a personalized recommendation.",
      h1: "Discovery",
      body: "Ask for a meeting they offer. This is not a personalized recommendation.",
      formSlug: "discovery",
    },
    {
      slug: "insights",
      title: "Insights",
      seoTitle: "Notes they approved",
      seoDesc: "Published only with their sign-off.",
      h1: "Insights",
      body: "Publish notes they approved. Do not invent performance.",
      image: "desk",
    },
    {
      slug: "twin",
      title: "Ask the practice",
      seoTitle: "Ask the practice",
      seoDesc: "No personalized recommendation.",
      h1: "Ask the practice",
      body: "The twin answers from facts they approved. It must not recommend a security or invent performance.",
      cta: { label: "Request a discovery meeting", href: "/discovery", variant: "quiet" },
    },
    {
      slug: "contact",
      title: "Contact",
      seoTitle: "Contact the practice",
      seoDesc: "Phone, email, and hours they supplied.",
      h1: "Contact",
      body: "For a meeting, use Discovery. Use this page for a general message.",
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
