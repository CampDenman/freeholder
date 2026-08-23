// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
import { contactForm, industrySeed, inquiryForm } from "../industry-kit";

const pack = industrySeed({
  name: "Your Real Estate Team",
  tagline: "Listings they have. Valuations they can defend.",
  schemaType: "RealEstateAgent",
  locationSlug: "office",
  street: "44 Example Realty Street",
  unit: "Suite 100",
  email: "hello@example.realty",
  colors: ["#1c2420", "#3e5448", "#d6cbb4"],
  alts: {
    hero: "A quiet realty lobby with a blank listings board and morning light",
    work: "A conference table with unmarked floor plans and two empty chairs",
    desk: "A valuation folder and a paper CMA pad on a wooden desk",
  },
  nav: [
    { label: "Buy", href: "/buy" },
    { label: "Sell", href: "/sell" },
    { label: "Agents", href: "/agents" },
    { label: "Valuation", href: "/valuation" },
    { label: "Ask", href: "/twin" },
    { label: "Contact", href: "/contact" },
  ],
  forms: [
    inquiryForm(
      "valuation",
      "Valuation request",
      "Request a valuation conversation",
      "Thank you. This is not an appraisal and not a guaranteed list price.",
      [{ key: "address", label: "Property address", kind: "text", required: true }],
    ),
    contactForm("Thank you. The team will reply."),
  ],
  pages: [
    {
      slug: "",
      title: "Your Real Estate Team",
      seoTitle: "Your Real Estate Team",
      seoDesc: "Listings they have. Valuations they can defend.",
      h1: "Listings they have. Valuations they can defend.",
      body: "This is a starting site for a real team. Replace the name, listings, and agents with facts they can prove.\n\nA valuation conversation is not an appraisal.",
      image: "hero",
      cta: { label: "Request a valuation conversation", href: "/valuation" },
      extraCtas: [
        { label: "Buy", href: "/buy" },
        { label: "Sell", href: "/sell" },
        { label: "Agents", href: "/agents" },
      ],
    },
    {
      slug: "buy",
      title: "Buy",
      seoTitle: "Listings they have",
      seoDesc: "Active inventory they actually represent.",
      h1: "Buy",
      body: "Show listings they have. Do not invent a sold price or an open house.",
      image: "work",
    },
    {
      slug: "sell",
      title: "Sell",
      seoTitle: "How they list",
      seoDesc: "Process they actually run.",
      h1: "Sell",
      body: "Explain how they list. A valuation request is not an appraisal.",
    },
    {
      slug: "agents",
      title: "Agents",
      seoTitle: "People they named",
      seoDesc: "Licenses they can prove.",
      h1: "Agents",
      body: "Name agents. Use licenses they can prove. Do not invent a board award.",
    },
    {
      slug: "valuation",
      title: "Valuation",
      seoTitle: "Request a conversation",
      seoDesc: "Not an appraisal. Not a guaranteed list price.",
      h1: "Valuation",
      body: "Ask for a conversation. This is not an appraisal and not a guaranteed list price.",
      formSlug: "valuation",
    },
    {
      slug: "neighborhoods",
      title: "Neighborhoods",
      seoTitle: "Places they named",
      seoDesc: "Areas they actually work.",
      h1: "Neighborhoods",
      body: "Name areas they work. Do not invent a school score.",
    },
    {
      slug: "twin",
      title: "Ask the team",
      seoTitle: "Ask the team",
      seoDesc: "No invented sold price.",
      h1: "Ask the team",
      body: "The twin answers from facts they approved. It must not invent a sold price or an open house.",
      cta: { label: "Request a valuation conversation", href: "/valuation", variant: "quiet" },
      image: "desk",
    },
    {
      slug: "contact",
      title: "Contact",
      seoTitle: "Contact the team",
      seoDesc: "Phone, email, and hours they supplied.",
      h1: "Contact",
      body: "For a listing conversation, use Valuation. Use this page for a general message.",
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
