// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
import { contactForm, industrySeed, inquiryForm } from "../industry-kit";

const pack = industrySeed({
  name: "Your Newsroom",
  tagline: "Stories they published. Corrections they keep.",
  schemaType: "NewsMediaOrganization",
  locationSlug: "desk",
  street: "200 Example News Street",
  unit: "Floor 2",
  email: "desk@example.news",
  colors: ["#161616", "#3a3a3a", "#dcdcdc"],
  alts: {
    hero: "An empty newsroom with blank screens and a quiet assignment board",
    work: "A reporter desk with a closed notebook and a silent headset",
    desk: "A corrections log binder on a metal shelf",
  },
  nav: [
    { label: "Sections", href: "/sections" },
    { label: "Staff", href: "/staff" },
    { label: "Tips", href: "/tips" },
    { label: "Corrections", href: "/corrections" },
    { label: "Ask", href: "/twin" },
    { label: "Contact", href: "/contact" },
  ],
  forms: [
    inquiryForm(
      "tips",
      "Tip",
      "Send a tip",
      "Thank you. This stays confidential until they publish. This is not a guarantee of coverage.",
    ),
    contactForm("Thank you. The desk will reply."),
  ],
  pages: [
    {
      slug: "",
      title: "Your Newsroom",
      seoTitle: "Your Newsroom",
      seoDesc: "Stories they published. Corrections they keep.",
      h1: "Stories they published.",
      body: "This is a starting site for a real newsroom. Replace the name, sections, and staff with facts they published.\n\nThe twin must not write autonomous news.",
      image: "hero",
      cta: { label: "Send a tip", href: "/tips" },
      extraCtas: [
        { label: "Sections", href: "/sections" },
        { label: "Staff", href: "/staff" },
        { label: "Corrections", href: "/corrections" },
      ],
    },
    {
      slug: "video",
      title: "Video",
      seoTitle: "Bulletins they published",
      seoDesc: "Video they actually published.",
      h1: "Video",
      body: "Publish bulletins they published. Do not invent a clip.",
    },
    {
      slug: "sections",
      title: "Sections",
      seoTitle: "Sections they named",
      seoDesc: "Desks they actually run.",
      h1: "Sections",
      body: "List sections they named. Do not invent a beat.",
      image: "work",
    },
    {
      slug: "staff",
      title: "Journalists",
      seoTitle: "People they named",
      seoDesc: "Journalists who work here.",
      h1: "Journalists",
      body: "Name people who work here. Do not invent a correspondent.",
    },
    {
      slug: "alerts",
      title: "Alerts",
      seoTitle: "Alerts they issued",
      seoDesc: "Breaking items they actually sent.",
      h1: "Alerts",
      body: "Publish alerts they issued. Do not invent breaking news.",
    },
    {
      slug: "tips",
      title: "Tips",
      seoTitle: "Send a tip",
      seoDesc: "Confidential until they publish.",
      h1: "Tips",
      body: "Send a tip. It stays confidential until they publish. This is not a guarantee of coverage.",
      formSlug: "tips",
    },
    {
      slug: "corrections",
      title: "Corrections",
      seoTitle: "Corrections they published",
      seoDesc: "The archive they keep.",
      h1: "Corrections",
      body: "Keep corrections they published. Do not hide one.",
      image: "desk",
    },
    {
      slug: "twin",
      title: "Ask the newsroom",
      seoTitle: "Ask the newsroom",
      seoDesc: "No autonomous news.",
      h1: "Ask the newsroom",
      body: "The twin answers from stories they published. It must not write autonomous news.",
      cta: { label: "Send a tip", href: "/tips", variant: "quiet" },
    },
    {
      slug: "contact",
      title: "Contact",
      seoTitle: "Contact the desk",
      seoDesc: "Desk contacts they supplied.",
      h1: "Contact",
      body: "For a tip, use Tips. Use this page for a general desk message.",
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
