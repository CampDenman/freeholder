// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
import { industrySeed, inquiryForm } from "../industry-kit";

const pack = industrySeed({
  name: "Your Company",
  tagline: "Work they actually do. Proof they consented.",
  schemaType: "ProfessionalService",
  locationSlug: "office",
  street: "50 Example Business Street",
  unit: "Suite 10",
  email: "hello@example.company",
  colors: ["#1a1e24", "#3a4554", "#d5cfc4"],
  alts: {
    hero: "A quiet office lobby with a blank capabilities board and morning light",
    work: "A conference table with unmarked folders and two empty chairs",
    desk: "A contact form pad and a closed laptop on a wooden desk",
  },
  nav: [
    { label: "Work", href: "/capabilities" },
    { label: "Team", href: "/team" },
    { label: "Proof", href: "/work" },
    { label: "Locations", href: "/locations" },
    { label: "Ask", href: "/twin" },
    { label: "Contact", href: "/contact" },
  ],
  forms: [
    inquiryForm(
      "contact",
      "Inquiry",
      "Send an inquiry",
      "Thank you. They will reply from work they actually do. This is not a retained engagement.",
      [{ key: "need", label: "What do you need?", kind: "text", required: true }],
    ),
  ],
  pages: [
    {
      slug: "",
      title: "Your Company",
      seoTitle: "Your Company",
      seoDesc: "Work they actually do. Proof they consented.",
      h1: "Work they actually do.",
      body: "This is a starting site for a real company. Replace the name, capabilities, and cases with facts they can prove.\n\nAn inquiry is not a retained engagement.",
      image: "hero",
      cta: { label: "Send an inquiry", href: "/contact" },
      extraCtas: [
        { label: "Capabilities", href: "/capabilities" },
        { label: "Team", href: "/team" },
        { label: "Proof", href: "/work" },
      ],
    },
    {
      slug: "capabilities",
      title: "Capabilities",
      seoTitle: "Capabilities they named",
      seoDesc: "Work they actually do.",
      h1: "Capabilities",
      body: "List capabilities they named. Do not invent a service.",
      image: "work",
    },
    {
      slug: "team",
      title: "Team",
      seoTitle: "People they named",
      seoDesc: "Leadership they can prove.",
      h1: "Team",
      body: "Name people who work here. Do not invent a title.",
    },
    {
      slug: "work",
      title: "Case studies",
      seoTitle: "Cases they consented",
      seoDesc: "Proof they approved. Empty until they add cases.",
      h1: "Case studies",
      body: "Publish cases they consented. Leave this page empty rather than invent a client.",
      image: "desk",
    },
    {
      slug: "locations",
      title: "Locations",
      seoTitle: "Places they operate",
      seoDesc: "Offices they named.",
      h1: "Locations",
      body: "List locations they operate. Do not invent an office.",
    },
    {
      slug: "news",
      title: "News",
      seoTitle: "Items they approved",
      seoDesc: "Notes they signed off.",
      h1: "News",
      body: "Publish items they approved. Do not invent an award.",
    },
    {
      slug: "careers",
      title: "Careers",
      seoTitle: "Openings they listed",
      seoDesc: "Roles they actually hire.",
      h1: "Careers",
      body: "List openings they named. Do not invent a role.",
    },
    {
      slug: "twin",
      title: "Ask the company",
      seoTitle: "Ask the company",
      seoDesc: "No invented client.",
      h1: "Ask the company",
      body: "The twin answers from facts they approved. It must not invent a client or a result.",
      cta: { label: "Send an inquiry", href: "/contact", variant: "quiet" },
    },
    {
      slug: "contact",
      title: "Contact",
      seoTitle: "Contact the company",
      seoDesc: "Routes they configured.",
      h1: "Contact",
      body: "Send an inquiry about work they actually do. This is not a retained engagement.",
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
