// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
import { contactForm, industrySeed, inquiryForm } from "../industry-kit";

const pack = industrySeed({
  name: "Your Roofing Company",
  tagline: "Inspect. Explain. Replace only if it is time.",
  schemaType: "RoofingContractor",
  locationSlug: "yard",
  street: "500 Example Way",
  unit: "Yard 1",
  email: "hello@example.roofing",
  colors: ["#2a2118", "#5c4a32", "#d8cbb4"],
  alts: {
    hero: "A quiet roofing yard with stacked unused shingles under overcast sky",
    work: "A ladder against an unmarked wall and a coiled safety rope",
    desk: "An inspection clipboard and a paper photo log on a metal desk",
  },
  nav: [
    { label: "Services", href: "/services" },
    { label: "Estimate", href: "/estimate" },
    { label: "Storm", href: "/storm" },
    { label: "Projects", href: "/projects" },
    { label: "Ask", href: "/twin" },
    { label: "Contact", href: "/contact" },
  ],
  forms: [
    inquiryForm(
      "estimate",
      "Inspection request",
      "Request an inspection",
      "Thank you. They will confirm from work they actually do. This is not a remote certification.",
      [{ key: "roof", label: "What should they look at?", kind: "text", required: true }],
    ),
    contactForm("Thank you. The company will reply."),
  ],
  pages: [
    {
      slug: "",
      title: "Your Roofing Company",
      seoTitle: "Your Roofing Company",
      seoDesc: "Inspect, explain, replace only if it is time.",
      h1: "Inspect. Explain. Replace only if it is time.",
      body: "This is a starting site for a real roofing company. Replace the name, services, and areas with facts you can stand behind.\n\nAn inspection request is not a remote certification.",
      image: "hero",
      cta: { label: "Request an inspection", href: "/estimate" },
      extraCtas: [
        { label: "Services", href: "/services" },
        { label: "Storm", href: "/storm" },
      ],
    },
    {
      slug: "services",
      title: "Services",
      seoTitle: "Services they named",
      seoDesc: "Work they actually do.",
      h1: "Services",
      body: "List work they actually do. Do not invent a certification.",
      image: "work",
    },
    {
      slug: "assessment",
      title: "Assessment",
      seoTitle: "Questions they ask",
      seoDesc: "Not a remote certification.",
      h1: "Assessment",
      body: "Ask questions they approved. This page does not certify a roof from a photo.",
    },
    {
      slug: "projects",
      title: "Projects",
      seoTitle: "Jobs they finished",
      seoDesc: "Work they completed and consented to show.",
      h1: "Projects",
      body: "Publish jobs they finished. Leave this page empty rather than use another company's photos.",
      image: "desk",
    },
    {
      slug: "inspect",
      title: "Inspections",
      seoTitle: "Methods they use",
      seoDesc: "How they inspect. Media they captured.",
      h1: "Inspections",
      body: "Describe methods they use. Do not invent a drone flight they do not run.",
    },
    {
      slug: "estimate",
      title: "Estimate",
      seoTitle: "Request an inspection",
      seoDesc: "Not a remote certification.",
      h1: "Estimate",
      body: "Ask for a visit. This is not a remote certification.",
      formSlug: "estimate",
    },
    {
      slug: "storm",
      title: "Storm",
      seoTitle: "Storm status they set",
      seoDesc: "No fabricated urgency.",
      h1: "Storm",
      body: "Publish status they set. Do not invent urgency or a queue.",
    },
    {
      slug: "insurance",
      title: "Insurance",
      seoTitle: "Education they approved",
      seoDesc: "Not claim advice.",
      h1: "Insurance",
      body: "Publish education they approved. This is not claim advice.",
    },
    {
      slug: "areas",
      title: "Service area",
      seoTitle: "Areas they cover",
      seoDesc: "Places they named.",
      h1: "Service area",
      body: "List cities they actually serve.",
    },
    {
      slug: "twin",
      title: "Ask the company",
      seoTitle: "Ask the company",
      seoDesc: "No remote certification.",
      h1: "Ask the company",
      body: "The twin answers from facts they approved. It must not certify a roof from a photo.",
      cta: { label: "Request an inspection", href: "/estimate", variant: "quiet" },
    },
    {
      slug: "contact",
      title: "Contact",
      seoTitle: "Contact the company",
      seoDesc: "Phone, email, and hours they supplied.",
      h1: "Contact",
      body: "For an inspection, use Estimate. Use this page for a general message.",
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
