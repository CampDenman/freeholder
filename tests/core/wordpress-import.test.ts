// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// WordPress WXR reading, URL planning and body conversion (C3.22).
// The fixture is a fictional site; no real site, person or business.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseBlockTree } from "@/modules/cms/blocks/registry";
import { parseWordpressWxr } from "@/core/import/parsers";
import {
  bodyImageRefs,
  parseWordpressExport,
  planWordpressImport,
  preprocessBody,
  wordpressBodyToBlocks,
  wordpressExportFromRest,
  wordpressPath,
  type BodyContext,
} from "@/core/import/wordpress";

const FIXTURE = readFileSync(
  fileURLToPath(new URL("../fixtures/wordpress/sample-export.xml", import.meta.url)),
  "utf8",
);
const ORIGIN = "https://old.example.org";
const KILN = "00000000-0000-4000-8000-000000000010";
const GLAZE = "00000000-0000-4000-8000-000000000011";

function context(overrides: Partial<BodyContext> = {}): BodyContext {
  return {
    slug: "blog/sample",
    title: "Sample",
    resolveImage: (src, wpId) =>
      wpId === "10" || src.includes("kiln")
        ? { assetId: KILN, alt: "A brick kiln stacked with bowls" }
        : wpId === "11" || src.includes("glaze")
          ? { assetId: GLAZE }
          : null,
    rewriteHref: (href) => href.replace("https://old.example.org/glaze-notes/", "/glaze-notes"),
    ...overrides,
  };
}

describe("WordPress WXR export (C3.22)", () => {
  const exported = parseWordpressExport(FIXTURE);

  it("reads pages, posts, attachments, authors, menus and what it left out", () => {
    expect(exported.site).toMatchObject({ title: "Fernwood Kiln", url: "https://old.example.org" });
    expect(exported.items.map((item) => [item.kind, item.slug, item.status])).toEqual([
      ["page", "about", "publish"],
      ["page", "team", "publish"],
      ["post", "first-wood-firing", "publish"],
      ["post", "glaze-notes", "publish"],
      ["post", "upcoming-sale", "draft"],
    ]);
    expect(exported.attachments.map((media) => [media.wpId, media.altText])).toEqual([
      ["10", "A brick kiln stacked with bowls"],
      ["11", "Six glaze test tiles"],
    ]);
    expect(exported.authors).toEqual([{ login: "maple", displayName: "Maple Rivers", email: "maple@example.org" }]);
    expect(exported.menus).toEqual([{ slug: "primary-menu", name: "Primary Menu" }]);
    expect(exported.menuItems).toHaveLength(3);
    expect(exported.skipped).toEqual({ "status: trash": 1, "post type: product": 1 });
  });

  it("preserves reader paragraph boundaries while removing executable HTML", () => {
    const changed = FIXTURE.replace("Lovely kiln!", "<p>First paragraph.</p><p>Next<br>line.</p><script>hidden()</script>");
    const parsed = parseWordpressExport(changed);
    const post = parsed.items.find(item => item.comments.entries?.length);
    expect(post?.comments.entries?.find(comment => comment.status === "approved")?.body).toBe("First paragraph.\n\nNext\nline.");
  });

  it("preserves a source home page at the empty CMS path", () => {
    const changed = FIXTURE.replace("<link>https://old.example.org/about/</link>", "<link>https://old.example.org/</link>");
    const plan = planWordpressImport(parseWordpressExport(changed), ORIGIN);
    expect(plan.pages.find(page => page.wpId === "30")?.slug).toBe("");
  });

  it("keeps dates, terms, SEO, featured images and comment counts", () => {
    const post = exported.items.find((item) => item.slug === "first-wood-firing")!;
    expect(post.publishedAt).toBe("2025-03-14T18:00:00.000Z");
    expect(post.categories).toEqual([{ slug: "studio-news", name: "Studio News" }]);
    expect(post.tags).toEqual([{ slug: "firing", name: "Firing" }]);
    expect(post.seo.title).toBe("Our First Wood Firing – Wood firing diary from a very small studio in the hills");
    expect(post.seo.description).toBe("Three days of loading and two of stoking.");
    expect(post.featuredWpId).toBe("10");
    expect(post.comments).toMatchObject({ total: 2, approved: 1 });
    // A body that says </item> inside CDATA does not end the item.
    expect(post.body).toContain("</item> on purpose");
    const about = exported.items.find((item) => item.slug === "about")!;
    expect(about.seo).toMatchObject({
      title: "About the Studio – Fernwood Kiln",
      description: "A small studio making wood-fired stoneware by hand.",
    });
    expect(exported.items.find((item) => item.slug === "glaze-notes")!.title).toBe("Glaze Notes & Tests");
    expect(exported.items.find((item) => item.slug === "upcoming-sale")!.publishedAt).toBeUndefined();
  });

  it("still answers the generic page shape", () => {
    expect(parseWordpressWxr(FIXTURE).map((page) => page.slug)).toEqual([
      "about",
      "team",
      "first-wood-firing",
      "glaze-notes",
      "upcoming-sale",
    ]);
  });
});

describe("WordPress import plan (C3.22)", () => {
  const plan = planWordpressImport(parseWordpressExport(FIXTURE), ORIGIN);

  it("keeps original page and post permalinks; query-only posts get a blog address", () => {
    expect(plan.pages.map((page) => [page.slug, page.redirectFrom ?? null])).toEqual([
      ["about", null],
      ["about/team", null],
      ["2025/03/first-wood-firing", null],
      ["glaze-notes", null],
      // `/?p=22` has no path of its own, so there is nothing to redirect.
      ["blog/upcoming-sale", null],
    ]);
    expect(plan.pages.find((page) => page.slug === "blog/upcoming-sale")!.status).toBe("draft");
    expect(plan.report.drafts).toBe(1);
  });

  it("plans every attachment, matched by id and by resized URL, and reports outside images", () => {
    expect(plan.media.map((media) => [media.filename, media.referenced])).toEqual([
      ["kiln.jpg", true],
      ["glaze-scaled.png", true],
    ]);
    expect(plan.media[1]!.aliases).toContain("old.example.org/wp-content/uploads/2025/04/glaze.png");
    expect(plan.pages.find((page) => page.slug === "2025/03/first-wood-firing")!.featuredMedia).toBe(plan.media[0]!.key);
    expect(plan.report.externalImages).toEqual(["https://cdn.other.example.net/borrowed.jpg"]);
  });

  it("records terms, authors and comments instead of inventing places for them", () => {
    expect(plan.taxonomy.categories).toEqual([
      { slug: "studio-news", name: "Studio News", posts: 1 },
      { slug: "glazes", name: "Glazes & Tests", posts: 1 },
    ]);
    expect(plan.authors).toEqual([
      { login: "maple", displayName: "Maple Rivers", email: "maple@example.org", posts: 3 },
    ]);
    expect(plan.report.comments).toEqual({ total: 2, approved: 1 });
    expect(plan.report.seoTrimmed).toBe(0);
    expect(plan.pages.find((page) => page.slug === "2025/03/first-wood-firing")!.seo.title).toBe("Our First Wood Firing – Wood firing diary from a very small studio in the hills");
  });

  it("maps menu items to imported pages, custom links and nesting", () => {
    expect(plan.menus).toEqual([
      {
        slug: "primary-menu",
        name: "Primary Menu",
        items: [
          { label: "About", depth: 0, targetWpId: "30", note: undefined },
          { label: "Team", depth: 1, targetWpId: "31", note: undefined },
          { label: "Journal", depth: 0, href: "/2025/03/first-wood-firing" },
        ],
      },
    ]);
  });

  it("reads only site-relative paths", () => {
    const hosts = ["old.example.org", "www.old.example.org"];
    expect(wordpressPath("https://www.old.example.org/a/b/", hosts, "")).toBe("a/b");
    expect(wordpressPath("/about/", hosts, "")).toBe("about");
    expect(wordpressPath("https://old.example.org/?p=4", hosts, "")).toBeNull();
    expect(wordpressPath("https://elsewhere.example/a", hosts, "")).toBeNull();
    expect(wordpressPath("https://old.example.org/wp/news/x/", hosts, "wp")).toBe("news/x");
    expect(wordpressPath("javascript:alert(1)", hosts, "")).toBeNull();
  });
});

describe("WordPress body conversion (C3.22)", () => {
  const exported = parseWordpressExport(FIXTURE);

  it("turns a block-editor post into typed, valid CMS blocks", () => {
    const post = exported.items.find((item) => item.slug === "first-wood-firing")!;
    const converted = wordpressBodyToBlocks(post.body, context({ title: post.title }));
    expect(converted.overBudget).toBeNull();
    expect(converted.droppedEmbeds).toBe(1);
    expect(converted.unresolvedImages).toEqual([]);
    expect(converted.blocks.map((block) => block.type)).toEqual(["heading", "heading", "text", "image", "text", "html"]);
    const [title, section, prose, image, after, quote] = converted.blocks;
    expect(title!.props).toMatchObject({ text: "Our First Wood Firing", level: 1 });
    expect(section!.props).toMatchObject({ text: "Loading the kiln", level: 2 });
    expect(JSON.stringify(prose!.props.body)).toContain('"marks":["strong"]');
    expect(JSON.stringify(prose!.props.body)).toContain('"href":"/glaze-notes"');
    expect(image!.props).toEqual({ assetId: KILN, alt: "A brick kiln stacked with bowls" });
    expect(JSON.stringify(after!.props.body)).toContain("Packed and ready.");
    expect(JSON.stringify(after!.props.body)).toContain('"type":"bulletList"');
    expect(quote!.props.markup).toBe("<blockquote><p>Patience is a glaze.</p></blockquote>");
    // Exactly what cms.createPage will accept.
    expect(() => parseBlockTree(converted.blocks, "page")).not.toThrow();
  });

  it("adds paragraphs and expands captions for classic-editor posts", () => {
    const post = exported.items.find((item) => item.slug === "glaze-notes")!;
    expect(preprocessBody(post.body)).toContain("<figcaption>Six tiles, one kiln.</figcaption>");
    const converted = wordpressBodyToBlocks(post.body, context({ title: post.title }));
    expect(converted.blocks.map((block) => block.type)).toEqual(["heading", "image", "text"]);
    expect(converted.blocks[1]!.props).toEqual({ assetId: GLAZE, alt: "Tiles after the glaze firing" });
    expect(converted.unresolvedImages).toEqual(["https://cdn.other.example.net/borrowed.jpg"]);
    const text = JSON.stringify(converted.blocks[2]!.props.body);
    expect(text).toContain("Six tiles, one kiln.");
    expect(text).toContain('"marks":["em"]');
    expect(() => parseBlockTree(converted.blocks, "page")).not.toThrow();
  });

  it("adds a featured image once and turns galleries into gallery blocks", () => {
    const featured = wordpressBodyToBlocks("<p>Hello</p>", context({ featured: { assetId: KILN } }));
    expect(featured.blocks.map((block) => block.type)).toEqual(["heading", "image", "text"]);
    const gallery = wordpressBodyToBlocks('[gallery ids="10,11"]', context());
    expect(gallery.blocks[1]).toMatchObject({ type: "gallery", props: { items: [{ assetId: KILN }, { assetId: GLAZE }] } });
    expect(() => parseBlockTree(gallery.blocks, "page")).not.toThrow();
    expect(bodyImageRefs('[gallery ids="10,11"]').map((ref) => ref.wpId)).toEqual(["10", "11"]);
  });

  it("keeps executable content out and never emits a second H1", () => {
    const converted = wordpressBodyToBlocks(
      '<h1>Inner title</h1><script>steal()</script><p onclick="steal()">Hi <a href="javascript:steal()">there</a></p><table><tr><td><a href="https://old.example.org/glaze-notes/">x</a></td></tr></table>',
      context(),
    );
    expect(converted.blocks.filter((block) => block.type === "heading" && block.props.level === 1)).toHaveLength(1);
    const json = JSON.stringify(converted.blocks);
    expect(json).not.toMatch(/steal|javascript:|onclick|<script/i);
    expect(json).toContain("Inner title");
    expect(() => parseBlockTree(converted.blocks, "page")).not.toThrow();
  });

  it("refuses a page that cannot fit the CMS budgets rather than truncating it", () => {
    const paragraphs = Array.from({ length: 120 }, (_, i) => `<h2>Part ${i}</h2>`).join("");
    expect(wordpressBodyToBlocks(paragraphs, context()).overBudget).toMatch(/limit is 80/);
  });
});

describe("WordPress REST payloads (C3.22)", () => {
  it("reads dates, Yoast fields and embedded terms when present", () => {
    const exported = wordpressExportFromRest(
      [
        {
          id: 7,
          type: "post",
          status: "publish",
          slug: "hello",
          link: "https://old.example.org/2025/01/hello/",
          date_gmt: "2025-01-05T08:00:00",
          title: { rendered: "Hello &amp; welcome" },
          content: { rendered: "<p>Hi</p>" },
          yoast_head_json: { title: "Hello – Fernwood Kiln", description: "A first note." },
          _embedded: {
            author: [{ slug: "maple", name: "Maple Rivers" }],
            "wp:term": [[{ taxonomy: "category", slug: "studio-news", name: "Studio News" }]],
          },
        },
        { id: 8, type: "wp_block", slug: "pattern" },
      ],
      ORIGIN,
    );
    expect(exported.items[0]).toMatchObject({
      title: "Hello & welcome",
      publishedAt: "2025-01-05T08:00:00.000Z",
      seo: { title: "Hello – Fernwood Kiln", description: "A first note." },
      categories: [{ slug: "studio-news", name: "Studio News" }],
      author: "maple",
    });
    expect(exported.skipped).toEqual({ "post type: wp_block": 1 });
    expect(planWordpressImport(exported, ORIGIN).pages[0]).toMatchObject({
      slug: "2025/01/hello",
      redirectFrom: undefined,
    });
  });
});

describe("WordPress menu hierarchy and target intent (C3.22)", () => {
  it("reconstructs parent order and genuine grandchildren from unsorted source rows", () => {
    const exported = parseWordpressExport(FIXTURE);
    exported.menuItems = [
      { wpId: "c", menu: "primary-menu", label: "Member", order: 0, type: "post_type", object: "post", objectId: "20", parentItemId: "b" },
      { wpId: "b", menu: "primary-menu", label: "Team", order: 1, type: "post_type", object: "page", objectId: "31", parentItemId: "a" },
      { wpId: "a", menu: "primary-menu", label: "About", order: 2, type: "post_type", object: "page", objectId: "30" },
    ];
    expect(planWordpressImport(exported, ORIGIN).menus[0]?.items.map(item => [item.label, item.depth])).toEqual([["About", 0], ["Team", 1], ["Member", 2]]);
  });

  it("keeps category/tag targets, custom query/fragments and WordPress query-ID links", () => {
    const exported = parseWordpressExport(FIXTURE);
    const base = { menu: "primary-menu", order: 0, type: "taxonomy", object: "category" };
    exported.menuItems = [
      { ...base, wpId: "a", label: "News", objectId: "3" },
      { ...base, wpId: "b", label: "Firing", object: "post_tag", objectId: "5" },
      { ...base, wpId: "c", label: "Details", type: "custom", url: `${ORIGIN}/about/?view=profile#team` },
      { ...base, wpId: "d", label: "Old post link", type: "custom", url: `${ORIGIN}/?p=20#firing` },
      { ...base, wpId: "e", label: "Unsafe", type: "custom", url: "javascript:alert(1)" },
      { ...base, wpId: "f", label: "Current-page section", type: "custom", url: "#section" },
    ];
    const planned = planWordpressImport(exported, ORIGIN).menus[0]!.items;
    expect(planned[0]).toMatchObject({ href: "/category/studio-news" });
    expect(planned[1]).toMatchObject({ href: "/tag/firing" });
    expect(planned[2]).toMatchObject({ href: "/about?view=profile#team" });
    expect(planned[3]).toMatchObject({ targetWpId: "20", fragment: "#firing" });
    expect(planned[4]?.href).toBeUndefined();
    expect(planned[5]?.href).toBe("#section");
  });

  it.each(["/about/", "/?p=20"])("refuses raw credentialed custom URLs before rewriting %s", (path) => {
    const exported = parseWordpressExport(FIXTURE);
    const address = new URL(path, ORIGIN);
    address.username = "synthetic-owner";
    address.password = "synthetic-proof";
    exported.menuItems = [{ ...exported.menuItems[0]!, wpId: "review", label: "", type: "custom", url: address.href }];
    const planned = planWordpressImport(exported, ORIGIN).menus[0]!.items[0]!;
    expect(planned.href).toBeUndefined();
    expect(planned.targetWpId).toBeUndefined();
    expect(planned.note).toBe("unsafe or invalid source link");
    expect(planned.label).toBe("");
  });

  it.each([
    { base: "", path: "/?p=20", target: "20" },
    { base: "", path: "/index.php?page_id=1", target: "1" },
    { base: "/legacy", path: "/legacy/?p=20", target: "20" },
    { base: "/legacy", path: "/legacy/index.php?page_id=1", target: "1" },
  ])("maps valid query-ID targets within the source base $base: $path", ({ base, path, target }) => {
    const exported = parseWordpressExport(FIXTURE);
    exported.site.baseUrl = `${ORIGIN}${base}`;
    exported.menuItems = [{ ...exported.menuItems[0]!, wpId: "review", label: "Valid", type: "custom", url: `${ORIGIN}${path}` }];
    expect(planWordpressImport(exported, ORIGIN).menus[0]!.items[0]!.targetWpId).toBe(target);
  });

  it.each(["/elsewhere/?p=20", "/legacy-other/?page_id=1", "/elsewhere/about/"])("preserves same-host links outside the source base: %s", (path) => {
    const exported = parseWordpressExport(FIXTURE);
    exported.site.baseUrl = `${ORIGIN}/legacy`;
    exported.menuItems = [{ ...exported.menuItems[0]!, wpId: "review", label: "Elsewhere", type: "custom", url: `${ORIGIN}${path}` }];
    const planned = planWordpressImport(exported, ORIGIN).menus[0]!.items[0]!;
    expect(planned.targetWpId).toBeUndefined();
    expect(planned.href).toBe(`${ORIGIN}${path}`);
  });

  it("retains disconnected/cyclic links with an explicit warning instead of losing or hanging them", () => {
    const exported = parseWordpressExport(FIXTURE);
    const base = { menu: "primary-menu", order: 0, type: "custom", object: "custom", url: "/about" };
    exported.menuItems = [{ ...base, wpId: "orphan", label: "Orphan", parentItemId: "absent" }, { ...base, wpId: "a", label: "A", parentItemId: "b" }, { ...base, wpId: "b", label: "B", parentItemId: "a" }];
    const plan = planWordpressImport(exported, ORIGIN);
    expect(plan.menus[0]?.items).toHaveLength(3);
    expect(plan.report.skipped).toMatchObject({ "menu parent missing: promoted item": 1, "menu hierarchy cycle: link retained as a root": 1 });
  });
});
