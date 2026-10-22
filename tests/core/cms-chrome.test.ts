// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Chrome sections: announcement, nav, header, footer (C2.11).

import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { parseBlockTree } from "@/modules/cms/blocks/registry";
import { addNavLink, extractNavBlocks, navHasLinks } from "@/modules/cms/chrome-nav";
import {
  ANNOUNCEMENT_KEY,
  defaultHeader,
  NAV_KEY,
} from "@/modules/cms/defaults";
import {
  ensureDefaults,
  getSection,
  updateSection,
} from "@/modules/cms/service";
import { updateBusiness } from "@/core/settings/service";
import {
  ANONYMOUS,
  closeDb,
  hasDatabase,
  OWNER,
  truncateSpine,
} from "../helpers/spine";

const BUSINESS = {
  name: "Aurora Coast Photography",
  tagline: "Coastal light, honestly made",
  country: "CA",
  baseCurrency: "CAD",
  timezone: "America/Vancouver",
  schemaType: "Photographer",
};

describe("chrome nav helpers", () => {
  it("adds a link once and extracts nav out of a header tree", () => {
    const tree = parseBlockTree(defaultHeader(), "chrome");
    expect(addNavLink(tree, "About", "/about")).toBe(false);

    const withNav = parseBlockTree(
      [
        {
          id: "row",
          type: "chromeBar",
          props: {},
          children: [
            { id: "brand", type: "brand", props: { href: "/" } },
            {
              id: "menu",
              type: "nav",
              props: { links: [{ label: "About", href: "/about" }] },
            },
          ],
        },
      ],
      "chrome",
    );
    const pulled = extractNavBlocks(withNav);
    expect(pulled.nav).toHaveLength(1);
    expect(navHasLinks(pulled.nav)).toBe(true);
    expect(JSON.stringify(pulled.rest)).not.toContain('"nav"');
    expect(addNavLink(pulled.nav, "About", "/about")).toBe(false);
    expect(addNavLink(pulled.nav, "Work", "/work")).toBe(true);
  });
});

describe.runIf(hasDatabase)("cms chrome sections", { timeout: 30_000 }, () => {
  beforeEach(truncateSpine);
  afterAll(closeDb);

  it("seeds announcement and nav, and moves a leftover header menu", async () => {
    await updateBusiness.call(BUSINESS, OWNER);
    await ensureDefaults.call({}, OWNER);
    await updateSection.call(
      {
        key: "header",
        blocks: [
          {
            id: "row",
            type: "chromeBar",
            props: { align: "between" },
            children: [
              { id: "brand", type: "brand", props: { href: "/" } },
              {
                id: "old-nav",
                type: "nav",
                props: { links: [{ label: "Studio", href: "/studio" }] },
              },
            ],
          },
        ],
      },
      OWNER,
    );
    await updateSection.call(
      {
        key: NAV_KEY,
        blocks: [{ id: "empty", type: "nav", props: { links: [] } }],
      },
      OWNER,
    );

    const again = await ensureDefaults.call({}, OWNER);
    expect(again.created).toContain("section:nav-migrated");

    const header = await getSection.call({ key: "header" }, ANONYMOUS);
    const navigation = await getSection.call({ key: NAV_KEY }, ANONYMOUS);
    const announcement = await getSection.call({ key: ANNOUNCEMENT_KEY }, ANONYMOUS);
    expect(JSON.stringify(header?.blocks)).not.toContain("old-nav");
    expect(JSON.stringify(navigation?.blocks)).toContain("/studio");
    expect(announcement?.kind).toBe("chrome");
  });

  it("merges a header menu into a nav section that already has a platform link", async () => {
    // The demo's exact shape: the first location appended /locations to the
    // nav section, then a later ensureDefaults moved the header menu out.
    // Before the fix the header menu was discarded and the whole site's
    // menu was "Locations".
    await updateBusiness.call(BUSINESS, OWNER);
    await ensureDefaults.call({}, OWNER);
    await updateSection.call(
      {
        key: NAV_KEY,
        blocks: [{ id: "chrome-nav", type: "nav", props: { links: [{ label: "Locations", href: "/locations" }] } }],
      },
      OWNER,
    );
    await updateSection.call(
      {
        key: "header",
        blocks: [
          {
            id: "row",
            type: "columns",
            props: { count: 2 },
            children: [
              { id: "brand", type: "brand", props: { href: "/" } },
              {
                id: "old-nav",
                type: "nav",
                props: {
                  links: [
                    { label: "Services", href: "/services" },
                    { label: "About", href: "/about" },
                    { label: "Locations", href: "/locations" },
                  ],
                },
              },
            ],
          },
        ],
      },
      OWNER,
    );

    await ensureDefaults.call({}, OWNER);

    const header = await getSection.call({ key: "header" }, ANONYMOUS);
    const navigation = await getSection.call({ key: NAV_KEY }, ANONYMOUS);
    expect(JSON.stringify(header?.blocks)).not.toContain("old-nav");
    const links = ((navigation!.blocks as Array<{ props: { links: Array<{ href: string }> } }>)[0]!.props).links;
    expect(links.map((link) => link.href)).toEqual(["/services", "/about", "/locations"]);
  });
});
