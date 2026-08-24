// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
import { contactForm, industrySeed, inquiryForm } from "../industry-kit";

const pack = industrySeed({
  name: "Your Electrical Company",
  tagline: "Safe work. Honest scope. No surprise panel.",
  schemaType: "ElectricalContractor",
  locationSlug: "shop",
  street: "420 Example Road",
  unit: "Bay 3",
  email: "hello@example.electric",
  colors: ["#1b1d24", "#3a4254", "#d2c9a8"],
  alts: {
    hero: "A quiet panel closet with a closed cover and a labeled breaker map",
    work: "A coil of unused cable on a clean workbench under shop light",
    desk: "A permit folder and a paper estimate on a metal desk",
  },
  nav: [
    { label: "Services", href: "/services" },
    { label: "Estimate", href: "/estimate" },
    { label: "Emergency", href: "/emergency" },
    { label: "Areas", href: "/areas" },
    { label: "Ask", href: "/twin" },
    { label: "Contact", href: "/contact" },
  ],
  forms: [
    inquiryForm(
      "estimate",
      "Estimate request",
      "Request an estimate",
      "Thank you. They will confirm from the work they actually do. This is not a remote inspection.",
      [{ key: "job", label: "What needs wiring or repair?", kind: "text", required: true }],
    ),
    contactForm("Thank you. The company will reply."),
  ],
  pages: [
    {
      slug: "",
      title: "Your Electrical Company",
      seoTitle: "Your Electrical Company",
      seoDesc: "Safe work they actually do. Not a remote inspection.",
      h1: "Safe work. Honest scope.",
      body: "This is a starting site for a real electrical company. Replace the name, services, and areas with facts you can stand behind.",
      image: "hero",
      cta: { label: "Request an estimate", href: "/estimate" },
      extraCtas: [
        { label: "Services", href: "/services" },
        { label: "Emergency", href: "/emergency" },
      ],
    },
    {
      slug: "services",
      title: "Services",
      seoTitle: "Services they named",
      seoDesc: "Install and repair they actually do.",
      h1: "Services",
      body: "List work they actually do. Do not invent a panel upgrade they will not take.",
      image: "work",
    },
    {
      slug: "estimate",
      title: "Estimate",
      seoTitle: "Request an estimate",
      seoDesc: "Not a remote inspection. They confirm from work they do.",
      h1: "Estimate",
      body: "Describe the job. This is not a remote inspection and not a permit.",
      formSlug: "estimate",
    },
    {
      slug: "emergency",
      title: "Emergency",
      seoTitle: "When to kill power",
      seoDesc: "Safety first. Sparking or burning is 911.",
      h1: "Emergency",
      body: "If you smell burning insulation or see sparks at the panel, leave and call 911. For an outage isolated to this building, call the shop using the number they supplied.",
    },
    {
      slug: "areas",
      title: "Service area",
      seoTitle: "Areas they cover",
      seoDesc: "Places they named. Not another contractor's map.",
      h1: "Service area",
      body: "List cities they actually serve. Do not copy another company's map.",
    },
    {
      slug: "twin",
      title: "Ask the company",
      seoTitle: "Ask the company",
      seoDesc: "Answers from approved facts. No invented code issue.",
      h1: "Ask the company",
      body: "The twin answers from facts they approved. It must not invent a code violation or an open slot.",
      cta: { label: "Request an estimate", href: "/estimate", variant: "quiet" },
    },
    {
      slug: "contact",
      title: "Contact",
      seoTitle: "Contact the company",
      seoDesc: "Phone, email, and hours they supplied.",
      h1: "Contact",
      body: "For a job, use Estimate. Use this page for a general message.",
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
