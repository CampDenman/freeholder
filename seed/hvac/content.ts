// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
import { contactForm, industrySeed, inquiryForm } from "../industry-kit";

const pack = industrySeed({
  name: "Your HVAC Company",
  tagline: "We'll tell you when not to replace.",
  schemaType: "HVACBusiness",
  locationSlug: "shop",
  street: "400 Example Road",
  unit: "Bay 1",
  email: "hello@example.hvac",
  colors: ["#1c242c", "#3e5360", "#c9d4cc"],
  alts: {
    hero: "A quiet mechanical yard with stacked filters and overcast light",
    work: "A furnace closet with a closed panel and a clipboard on the floor",
    desk: "A dispatch desk with a paper work order and a silent phone",
  },
  nav: [
    { label: "Services", href: "/services" },
    { label: "Estimate", href: "/estimate" },
    { label: "Emergency", href: "/emergency" },
    { label: "Plans", href: "/plans" },
    { label: "Areas", href: "/areas" },
    { label: "Ask", href: "/twin" },
    { label: "Contact", href: "/contact" },
  ],
  forms: [
    inquiryForm(
      "estimate",
      "Estimate request",
      "Request an estimate",
      "Thank you. They will confirm from the work they actually do. This is not a remote diagnosis.",
      [{ key: "system", label: "What needs service?", kind: "text", required: true }],
    ),
    contactForm("Thank you. The company will reply."),
  ],
  pages: [
    {
      slug: "",
      title: "Your HVAC Company",
      seoTitle: "Your HVAC Company",
      seoDesc: "Repair versus replace, honestly. Work they actually do.",
      h1: "We'll tell you when not to replace.",
      body: "This is a starting site for a real HVAC company. Replace the name, services, and areas with facts you can stand behind.\n\nAn estimate request is not a remote diagnosis and not a guaranteed appointment.",
      image: "hero",
      cta: { label: "Request an estimate", href: "/estimate" },
      extraCtas: [
        { label: "Services", href: "/services" },
        { label: "Emergency", href: "/emergency" },
        { label: "Service area", href: "/areas" },
      ],
    },
    {
      slug: "services",
      title: "Services",
      seoTitle: "Services they named",
      seoDesc: "Install and repair they actually do. No invented rebate.",
      h1: "Services",
      body: "List work they actually do. Do not invent a rebate, a part, or an emergency they will not take.",
      image: "work",
    },
    {
      slug: "estimate",
      title: "Estimate",
      seoTitle: "Request an estimate",
      seoDesc: "Ranges they publish. Assumptions shown. Not a remote diagnosis.",
      h1: "Estimate",
      body: "Ask for a visit. Ranges they publish stay visible. This is not a remote diagnosis.",
      formSlug: "estimate",
    },
    {
      slug: "emergency",
      title: "Emergency",
      seoTitle: "When to call",
      seoDesc: "Safety first. When to shut off gas or call 911.",
      h1: "Emergency",
      body: "If you smell gas or this is life-threatening, leave and call 911. For no-heat or no-cool, call the number they supplied. This page does not diagnose a system.",
    },
    {
      slug: "plans",
      title: "Plans",
      seoTitle: "Plans they sell",
      seoDesc: "Terms they versioned. Missing club stays empty.",
      h1: "Plans",
      body: "Name maintenance plans they actually sell. Terms they wrote. Do not invent coverage.",
    },
    {
      slug: "areas",
      title: "Service area",
      seoTitle: "Areas they cover",
      seoDesc: "Places they named. Not another company's map.",
      h1: "Service area",
      body: "List cities they actually serve. Do not copy another company's map.",
    },
    {
      slug: "twin",
      title: "Ask the company",
      seoTitle: "Ask the company",
      seoDesc: "Answers from approved facts. No invented failure.",
      h1: "Ask the company",
      body: "The twin answers from facts they approved. It must not invent a failure, a rebate, or an open slot.",
      cta: { label: "Request an estimate", href: "/estimate", variant: "quiet" },
    },
    {
      slug: "contact",
      title: "Contact",
      seoTitle: "Contact the company",
      seoDesc: "Phone, email, and hours they supplied.",
      h1: "Contact",
      body: "For an estimate, use Estimate. Use this page for a general message.",
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
