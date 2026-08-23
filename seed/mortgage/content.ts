// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
import { contactForm, industrySeed, inquiryForm } from "../industry-kit";

const pack = industrySeed({
  name: "Your Mortgage Team",
  tagline: "Programs they offer. Rates they timestamped.",
  schemaType: "FinancialService",
  locationSlug: "office",
  street: "88 Example Plaza",
  unit: "Suite 400",
  email: "hello@example.mortgage",
  colors: ["#1a2430", "#35506a", "#d5cbb8"],
  alts: {
    hero: "A quiet lending desk with a closed folder and a blank calculator pad",
    work: "A conference table with unmarked documents and two empty chairs",
    desk: "A rate sheet placeholder dated only as an example, not a live quote",
  },
  nav: [
    { label: "Programs", href: "/programs" },
    { label: "Rates", href: "/rates" },
    { label: "Calculator", href: "/calculator" },
    { label: "Apply", href: "/apply" },
    { label: "Ask", href: "/twin" },
    { label: "Contact", href: "/contact" },
  ],
  forms: [
    inquiryForm(
      "application",
      "Application start",
      "Start an application",
      "Thank you. This is not an approval and not a guaranteed rate.",
      [{ key: "purpose", label: "Purchase or refinance?", kind: "text", required: true }],
    ),
    contactForm("Thank you. The team will reply."),
  ],
  pages: [
    {
      slug: "",
      title: "Your Mortgage Team",
      seoTitle: "Your Mortgage Team",
      seoDesc: "Programs they offer. Rates they timestamped. Not an approval.",
      h1: "Programs they offer. Rates they timestamped.",
      body: "This is a starting site for a real mortgage team. Replace the name, programs, and disclosures with facts they approved.\n\nAn application is not an approval. A published rate is not a guaranteed rate.",
      image: "hero",
      cta: { label: "Start an application", href: "/apply" },
      extraCtas: [
        { label: "Programs", href: "/programs" },
        { label: "Rates", href: "/rates" },
      ],
    },
    {
      slug: "programs",
      title: "Programs",
      seoTitle: "Programs they named",
      seoDesc: "Disclosures they approved. No invented product.",
      h1: "Programs",
      body: "List programs they named, with disclosures they approved.",
      image: "work",
    },
    {
      slug: "rates",
      title: "Rates",
      seoTitle: "Rates they timestamped",
      seoDesc: "Source and time shown. Not a guaranteed rate.",
      h1: "Rates",
      body: "Publish rates they timestamped, with the source they named. This is not a guaranteed rate.",
      image: "desk",
    },
    {
      slug: "calculator",
      title: "Calculator",
      seoTitle: "Assumptions displayed",
      seoDesc: "Educational only. Not a quote.",
      h1: "Calculator",
      body: "Show assumptions. This worksheet is educational. It is not a quote.",
    },
    {
      slug: "apply",
      title: "Apply",
      seoTitle: "Start an application",
      seoDesc: "Not an approval. Resumable later.",
      h1: "Apply",
      body: "Start an application. This is not an approval.",
      formSlug: "application",
    },
    {
      slug: "partners",
      title: "Partners",
      seoTitle: "Partners they approved",
      seoDesc: "Referrals they named.",
      h1: "Partners",
      body: "Name partners they approved. Do not invent a referral.",
    },
    {
      slug: "twin",
      title: "Ask the team",
      seoTitle: "Ask the team",
      seoDesc: "No guaranteed approval.",
      h1: "Ask the team",
      body: "The twin answers from facts they approved. It must not promise an approval or a rate.",
      cta: { label: "Start an application", href: "/apply", variant: "quiet" },
    },
    {
      slug: "contact",
      title: "Contact",
      seoTitle: "Contact the team",
      seoDesc: "Phone, email, and hours they supplied.",
      h1: "Contact",
      body: "For a loan, use Apply. Use this page for a general message.",
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
