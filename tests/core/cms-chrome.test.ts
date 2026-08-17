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
});
