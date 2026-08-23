// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
import { contactForm, industrySeed, inquiryForm } from "../industry-kit";

const pack = industrySeed({
  name: "Your Plumbing Company",
  tagline: "We show up. We fix it. We explain what we did.",
  schemaType: "Plumber",
  locationSlug: "shop",
  street: "410 Example Road",
  unit: "Bay 2",
  email: "hello@example.plumbing",
  colors: ["#1a2228", "#35505c", "#c5d0c8"],
  alts: {
    hero: "A quiet van bay with coiled hose and a closed side door",
    work: "A utility sink and exposed pipe against a painted block wall",
    desk: "A paper work order on a metal clipboard beside a silent radio",
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
      "Service request",
      "Request service",
      "Thank you. They will confirm from the work they actually do. This is not a remote diagnosis.",
      [{ key: "issue", label: "What is leaking or blocked?", kind: "text", required: true }],
    ),
    contactForm("Thank you. The company will reply."),
  ],
  pages: [
    {
      slug: "",
      title: "Your Plumbing Company",
      seoTitle: "Your Plumbing Company",
      seoDesc: "Show up, fix it, explain it. Work they actually do.",
      h1: "We show up. We fix it. We explain what we did.",
      body: "This is a starting site for a real plumbing company. Replace the name, services, and areas with facts you can stand behind.",
      image: "hero",
      cta: { label: "Request service", href: "/estimate" },
      extraCtas: [
        { label: "Services", href: "/services" },
        { label: "Emergency", href: "/emergency" },
      ],
    },
    {
      slug: "services",
      title: "Services",
      seoTitle: "Services they named",
      seoDesc: "Repairs they actually do. No invented emergency.",
      h1: "Services",
      body: "List work they actually do. Do not invent a service they will not take.",
      image: "work",
    },
    {
      slug: "estimate",
      title: "Estimate",
      seoTitle: "Request service",
      seoDesc: "Not a remote diagnosis. They confirm from the work they do.",
      h1: "Request service",
      body: "Describe the leak or the blockage. This is not a remote diagnosis.",
      formSlug: "estimate",
    },
    {
      slug: "emergency",
      title: "Emergency",
      seoTitle: "When to shut the water",
      seoDesc: "Safety first. When to call 911 versus the shop.",
      h1: "Emergency",
      body: "If water is near electrical panels, leave and call 911. For a burst pipe, shut the valve they showed you if you can, then call the shop.",
    },
    {
      slug: "areas",
      title: "Service area",
      seoTitle: "Areas they cover",
      seoDesc: "Places they named. Not another plumber's map.",
      h1: "Service area",
      body: "List cities they actually serve. Do not copy another company's map.",
    },
    {
      slug: "twin",
      title: "Ask the company",
      seoTitle: "Ask the company",
      seoDesc: "Answers from approved facts. No invented emergency.",
      h1: "Ask the company",
      body: "The twin answers from facts they approved. It must not invent an emergency or an open slot.",
      cta: { label: "Request service", href: "/estimate", variant: "quiet" },
    },
    {
      slug: "contact",
      title: "Contact",
      seoTitle: "Contact the company",
      seoDesc: "Phone, email, and hours they supplied.",
      h1: "Contact",
      body: "For a leak, use Estimate. Use this page for a general message.",
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
