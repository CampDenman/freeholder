// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// What a fresh instance's site is made of before anyone has edited anything.
//
// §32: "Default templates ship per business preset as seed data, so day one
// still looks designed." This is the smallest honest version of that — a
// header, a footer, and a home page that says something true about a business
// whose owner has only just finished the setup wizard.
//
// These are *data*, not a fallback rendered when the tables are empty. The
// difference matters: an owner can edit or delete any of it the moment it
// exists, which they could not do to a hardcoded default that only appears
// when a row is missing.
import type { BlockNode } from "./blocks/types";

export const HEADER_KEY = "header";
export const FOOTER_KEY = "footer";
export const NAV_KEY = "nav";
export const ANNOUNCEMENT_KEY = "announcement";

export function defaultHeader(): BlockNode[] {
  return [
    {
      id: "header-bar",
      type: "chromeBar",
      props: { align: "between" },
      children: [
        { id: "header-brand", type: "brand", props: { href: "/", showTagline: false } },
        { id: "header-locales", type: "locales", props: { separator: "·" } },
      ],
    },
  ];
}

export function defaultNav(): BlockNode[] {
  return [
    {
      id: "chrome-nav",
      type: "nav",
      props: { links: [], ariaLabelKey: "cms.nav.primary" },
    },
  ];
}

export function defaultAnnouncement(): BlockNode[] {
  return [
    {
      id: "chrome-announcement",
      type: "announcement",
      props: { text: "" },
    },
  ];
}

export function defaultFooter(businessName: string): BlockNode[] {
  return [
    {
      id: "footer-text",
      type: "text",
      props: {
        body: `© ${businessName}`,
        align: "start",
        measure: false,
      },
    },
  ];
}

/**
 * The home page a business gets on day one.
 *
 * Written as a real page rather than a placeholder screen, because the whole
 * point of §32 is that there is no difference — what ships is a block tree the
 * owner can rearrange, and the platform has no privileged version of it.
 */
export function defaultHome(business: {
  name: string;
  tagline: string | null;
}): { title: string; blocks: BlockNode[] } {
  return {
    title: business.name,
    blocks: [
      {
        id: "home-h1",
        type: "heading",
        props: { text: business.name, level: 1, align: "start" },
      },
      {
        id: "home-intro",
        type: "text",
        props: {
          body:
            business.tagline ??
            "This page is a block tree in your database. Rearranging it is a save, not a deploy.",
          align: "start",
          measure: true,
        },
      },
    ],
  };
}
