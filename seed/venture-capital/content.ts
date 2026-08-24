// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
import { contactForm, industrySeed, inquiryForm } from "../industry-kit";

const pack = industrySeed({
  name: "Your Fund",
  tagline: "Thesis they wrote. Companies they named.",
  schemaType: "InvestmentFund",
  locationSlug: "office",
  street: "1 Example Capital Street",
  unit: "Floor 12",
  email: "hello@example.fund",
  colors: ["#141820", "#2c3548", "#c9c2b0"],
  alts: {
    hero: "A quiet fund office with a blank whiteboard and two empty chairs",
    work: "A portfolio table with unmarked folders and a closed laptop",
    desk: "A thesis binder on a wooden desk beside a silent phone",
  },
  nav: [
    { label: "Thesis", href: "/thesis" },
    { label: "Portfolio", href: "/portfolio" },
    { label: "Team", href: "/team" },
    { label: "LPs", href: "/lp" },
    { label: "Submit", href: "/submit" },
    { label: "Ask", href: "/twin" },
    { label: "Contact", href: "/contact" },
  ],
  forms: [
    inquiryForm(
      "submit",
      "Founder submission",
      "Send a brief",
      "Thank you. This stays confidential until they say otherwise. This is not a commitment.",
      [{ key: "company", label: "Company name", kind: "text", required: true }],
    ),
    contactForm("Thank you. The fund will reply."),
  ],
  pages: [
    {
      slug: "",
      title: "Your Fund",
      seoTitle: "Your Fund",
      seoDesc: "Thesis they wrote. Companies they named. No invented performance.",
      h1: "Thesis they wrote. Companies they named.",
      body: "This is a starting site for a real fund. Replace the name, thesis, and portfolio with facts they approved.\n\nA submission is not a commitment. Do not invent performance.",
      image: "hero",
      cta: { label: "Send a brief", href: "/submit" },
      extraCtas: [
        { label: "Thesis", href: "/thesis" },
        { label: "Portfolio", href: "/portfolio" },
        { label: "Team", href: "/team" },
      ],
    },
    {
      slug: "thesis",
      title: "Thesis",
      seoTitle: "Sectors they named",
      seoDesc: "Strategy they wrote.",
      h1: "Thesis",
      body: "Publish sectors they named. Do not invent a mandate.",
      image: "desk",
    },
    {
      slug: "portfolio",
      title: "Portfolio",
      seoTitle: "Companies they named",
      seoDesc: "Holdings they approved.",
      h1: "Portfolio",
      body: "List companies they named. Do not invent performance.",
      image: "work",
    },
    {
      slug: "team",
      title: "Team",
      seoTitle: "People they named",
      seoDesc: "Partners who work here.",
      h1: "Team",
      body: "Name people who work here. Do not invent a partner.",
    },
    {
      slug: "lp",
      title: "LP interest",
      seoTitle: "Terms they approved",
      seoDesc: "Not a solicitation beyond those terms.",
      h1: "LP interest",
      body: "Publish terms they approved. This is not a solicitation beyond those terms.",
    },
    {
      slug: "submit",
      title: "Founders",
      seoTitle: "Send a brief",
      seoDesc: "Confidential until they say otherwise.",
      h1: "Founders",
      body: "Send a brief. It stays confidential until they say otherwise. This is not a commitment.",
      formSlug: "submit",
    },
    {
      slug: "brief",
      title: "Briefs",
      seoTitle: "Briefs they approved",
      seoDesc: "Market notes they signed off.",
      h1: "Briefs",
      body: "Publish briefs they approved. Do not invent a market call.",
    },
    {
      slug: "twin",
      title: "Ask the fund",
      seoTitle: "Ask the fund",
      seoDesc: "No invented performance.",
      h1: "Ask the fund",
      body: "The twin answers from facts they approved. It must not invent performance or a commitment.",
      cta: { label: "Send a brief", href: "/submit", variant: "quiet" },
    },
    {
      slug: "contact",
      title: "Contact",
      seoTitle: "Contact the fund",
      seoDesc: "Desk contacts they supplied.",
      h1: "Contact",
      body: "For deal flow, use Submit. Use this page for a general desk message.",
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
