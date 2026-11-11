// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Navigation import cannot move a child under an unrelated owner link (C3.22).
import { describe, expect, it } from "vitest";
import { flattenNavigation, mergeNavigation, navigationTree, removeNavigation } from "@/modules/cms/navigation-tree";

describe("semantic navigation hierarchy", () => {
  it("retains arbitrary grandchildren and safely normalizes old orphan depths", () => {
    const tree = navigationTree([{ label: "A", href: "/a" }, { label: "B", href: "/b", depth: 1 }, { label: "C", href: "/c", depth: 2 }, { label: "D", href: "/d" }]);
    expect(tree[0]?.children[0]?.children[0]?.link.href).toBe("/c");
    expect(flattenNavigation(tree)).toEqual([{ label: "A", href: "/a" }, { label: "B", href: "/b", depth: 1 }, { label: "C", href: "/c", depth: 2 }, { label: "D", href: "/d" }]);
    expect(flattenNavigation(navigationTree([{ label: "Orphan", href: "/o", depth: 4 }]))).toEqual([{ label: "Orphan", href: "/o" }]);
  });

  it("attaches imported children to the matching existing owner parent, preserving owner order", () => {
    const existing = [{ label: "Our about page", href: "/about" }, { label: "Work", href: "/work" }];
    const result = mergeNavigation(existing, [{ id: "import-parent", label: "Source about", href: "/about" }, { id: "import-child", label: "Team", href: "/about/team", depth: 1 }]);
    expect(result.links).toEqual([{ label: "Our about page", href: "/about" }, { id: "import-child", label: "Team", href: "/about/team", depth: 1 }, { label: "Work", href: "/work" }]);
    expect(result.added).toEqual([{ id: "import-child", label: "Team", href: "/about/team", depth: 1 }]);
    expect(existing).toHaveLength(2);
  });

  it("keeps repeated destinations under distinct parents and query-specific links", () => {
    const result = mergeNavigation([{ label: "A", href: "/a" }, { label: "Contact", href: "/contact", depth: 1 }], [{ label: "B", href: "/b" }, { label: "Contact", href: "/contact", depth: 1 }, { label: "Search one", href: "/search?q=one" }, { label: "Search two", href: "/search?q=two" }]);
    expect(result.links.filter(link => link.href === "/contact")).toHaveLength(2);
    expect(result.links.filter(link => link.href.startsWith("/search"))).toHaveLength(2);
  });

  it("removes only owned IDs and preserves new owner descendants with correct parentage", () => {
    const result = removeNavigation([{ id: "import-parent", label: "Imported", href: "/import" }, { label: "Owner child", href: "/owner", depth: 1 }, { id: "other", label: "Same label", href: "/import" }], [{ id: "import-parent", label: "Old label", href: "/old" }]);
    expect(result).toEqual([{ label: "Owner child", href: "/owner" }, { id: "other", label: "Same label", href: "/import" }]);
  });
});

// These are the shapes the owner editor and HTTP/MCP save, not only helpers.
describe("navigation schema and public semantic output", () => {
  it("refuses missing parents, depth jumps and repeated stored identities", async () => {
    const { navigationLinksSchema } = await import("@/modules/cms/navigation-schema");
    expect(navigationLinksSchema.safeParse([{ label: "Orphan", href: "/o", depth: 1 }]).success).toBe(false);
    expect(navigationLinksSchema.safeParse([{ label: "Root", href: "/" }, { label: "Jump", href: "/j", depth: 2 }]).success).toBe(false);
    expect(navigationLinksSchema.safeParse([{ id: "same", label: "A", href: "/a" }, { id: "same", label: "B", href: "/b" }]).success).toBe(false);
  });

  it("renders nested lists with localized child links and only exact current-page markers", async () => {
    const { renderBlocks } = await import("@/modules/cms/render");
    const { parseBlockTree } = await import("@/modules/cms/blocks/registry");
    const { createElement, Fragment } = await import("react");
    const { renderToStaticMarkup } = await import("react-dom/server");
    const { JSDOM } = await import("jsdom");
    const nodes = parseBlockTree([{ id: "nav", type: "nav", props: { links: [{ label: "About", href: "/about" }, { label: "Team", href: "/about/team", depth: 1 }, { label: "Member", href: "/about/team/member", depth: 2 }] } }], "chrome");
    const markup = renderToStaticMarkup(createElement(Fragment, null, ...await renderBlocks(nodes, { locale: "fr", path: "/about/team/member", business: null, t: key => key, localizeHref: href => `/fr${href}` })));
    const document = new JSDOM(markup).window.document;
    expect(document.querySelectorAll('li > a[href="/fr/about"] + ul > li > a[href="/fr/about/team"] + ul > li > a[href="/fr/about/team/member"]')).toHaveLength(2);
    expect([...document.querySelectorAll("[aria-current=page]")].every(node => node.getAttribute("href") === "/fr/about/team/member")).toBe(true);
    expect(document.querySelector("details > summary")).not.toBeNull();
  });
});
