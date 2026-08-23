// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
import { contactForm, industrySeed, inquiryForm } from "../industry-kit";

const pack = industrySeed({
  name: "Your Dental Practice",
  tagline: "Care they actually provide. Results they consented.",
  schemaType: "Dentist",
  locationSlug: "practice",
  street: "210 Example Street",
  unit: "Suite 2",
  email: "hello@example.dental",
  colors: ["#1a2a32", "#3d5c66", "#d7e4e0"],
  alts: {
    hero: "A quiet dental reception with a low desk and morning window light",
    work: "An empty treatment room with a made chair and folded towel",
    desk: "A front desk with a closed chart and a single lamp",
  },
  nav: [
    { label: "Services", href: "/services" },
    { label: "Providers", href: "/providers" },
    { label: "Gallery", href: "/gallery" },
    { label: "Book", href: "/book" },
    { label: "Emergency", href: "/emergency" },
    { label: "Insurance", href: "/insurance" },
    { label: "Ask", href: "/twin" },
    { label: "Contact", href: "/contact" },
  ],
  forms: [
    inquiryForm(
      "book",
      "Appointment request",
      "Request an appointment",
      "Thank you. The practice will confirm from the types they offer. This is not a diagnosis.",
      [{ key: "reason", label: "What do you need?", kind: "text", required: true }],
    ),
    contactForm("Thank you. The practice will reply."),
  ],
  pages: [
    {
      slug: "",
      title: "Your Dental Practice",
      seoTitle: "Your Dental Practice",
      seoDesc: "Care they actually provide. Results they consented. Not a diagnosis.",
      h1: "Care they provide. Results they consented.",
      body: "This is a starting site for a real dental practice. Replace the name, services, and photos with facts you can prove.\n\nA request is not a diagnosis and not a reserved slot.",
      image: "hero",
      cta: { label: "Request an appointment", href: "/book" },
      extraCtas: [
        { label: "Services", href: "/services" },
        { label: "Providers", href: "/providers" },
        { label: "Emergency", href: "/emergency" },
      ],
    },
    {
      slug: "services",
      title: "Services",
      seoTitle: "Services they named",
      seoDesc: "Care they actually provide. No invented specialty.",
      h1: "Services",
      body: "List services they named. Do not invent a specialty or a result.",
      image: "work",
    },
    {
      slug: "providers",
      title: "Providers",
      seoTitle: "Providers they can prove",
      seoDesc: "Names and credentials they supplied. No invented license.",
      h1: "Providers",
      body: "Name the people who work here. Use credentials they can prove.",
    },
    {
      slug: "assessment",
      title: "Assessment",
      seoTitle: "Questions they approved",
      seoDesc: "Scores urgency. Never diagnoses or prescribes.",
      h1: "Assessment",
      body: "Ask questions they approved. This page does not diagnose or prescribe.",
      cta: { label: "Request an appointment", href: "/book", variant: "quiet" },
    },
    {
      slug: "gallery",
      title: "Smile gallery",
      seoTitle: "Results they consented",
      seoDesc: "Photos publish only with recorded consent.",
      h1: "Smile gallery",
      body: "Publish only cases with recorded consent. Leave this page empty rather than use another practice's photos.",
      image: "desk",
    },
    {
      slug: "book",
      title: "Book",
      seoTitle: "Request an appointment",
      seoDesc: "Types they offer. A request is not a reserved slot.",
      h1: "Book",
      body: "Ask for a visit they actually offer. This form does not diagnose.",
      formSlug: "book",
    },
    {
      slug: "emergency",
      title: "Emergency",
      seoTitle: "When to call",
      seoDesc: "When to call 911 or an ER, and when to call the office.",
      h1: "Emergency",
      body: "If this is life-threatening, call 911. For urgent dental pain, call the office using the number they supplied. This page does not diagnose.",
    },
    {
      slug: "insurance",
      title: "Insurance",
      seoTitle: "Plans they accept",
      seoDesc: "Plans they named. No invented network.",
      h1: "Insurance",
      body: "List plans they accept. Do not invent a network or a covered amount.",
    },
    {
      slug: "twin",
      title: "Ask the practice",
      seoTitle: "Ask the practice",
      seoDesc: "Answers from approved facts. Never diagnoses.",
      h1: "Ask the practice",
      body: "The twin answers from facts they approved. It must not diagnose or invent a slot.",
      cta: { label: "Request an appointment", href: "/book", variant: "quiet" },
    },
    {
      slug: "contact",
      title: "Contact",
      seoTitle: "Contact the practice",
      seoDesc: "Phone, email, and hours they supplied.",
      h1: "Contact",
      body: "For a visit, use Book. Use this page for hours or a general message.",
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
