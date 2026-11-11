// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import { stageImportSource } from "@/core/import/service";
import { parseGenericHtml } from "@/core/import/generic-plan";
import { parseGenericFeed } from "@/core/import/generic-feed";

const HTML = `<!doctype html><html lang="fr"><head><title>Actual source title</title>
<meta name="description" content="Actual source description">
<meta name="robots" content="noindex,nofollow"><link rel="canonical" href="/legacy/team.html">
<meta property="og:title" content="Actual social title"></head><body><main>
<h1>Our team</h1><p>Our actual source content.</p><img src="../images/team.png" alt="Fictional team">
<a href="../guide.pdf">Read the guide</a><script>untrustedSource()</script></main></body></html>`;

describe("generic source preservation (C3.22)", () => {
  it("stages semantic HTML with media, exact source path and SEO instead of a raw truncated block", () => {
    const staged = stageImportSource("html", HTML, "https://source.example/legacy/team.html");
    expect(staged.counts).toMatchObject({ pages: 1, media: 2, redirects: 1 });
    expect(staged.preview).toMatchObject({ sourceFormat: "generic-site", pages: [{ url: "https://source.example/legacy/team.html", slug: "legacy/team", seo: { title: "Actual source title", description: "Actual source description", noindex: true, nofollow: true, ogTitle: "Actual social title" } }] });
    expect(JSON.stringify(staged.preview)).toContain("https://source.example/images/team.png");
    expect(JSON.stringify(staged.preview)).toContain("https://source.example/guide.pdf");
    expect(JSON.stringify(staged.preview)).not.toContain("untrustedSource()");
  });
  it("retains complete RSS encoded content, dates, source post identity and enclosures", () => {
    const rss = `<rss xmlns:content="urn:content"><channel><item source="fixture"><title><![CDATA[Stories &amp; people]]></title><link>https://source.example/news/story.html</link><pubDate>Tue, 02 Apr 2024 09:00:00 GMT</pubDate><content:encoded><![CDATA[<p>Complete body <strong>with emphasis</strong>.</p><img src="../images/story.png" alt="Story">]]></content:encoded><description>Short fallback</description><enclosure url="https://source.example/audio/story.mp3" type="audio/mpeg"/></item></channel></rss>`;
    const staged = stageImportSource("rss", rss, "https://source.example/feed.xml");
    expect(staged.counts).toMatchObject({ pages: 1, media: 2, redirects: 1 });
    expect(staged.preview).toMatchObject({ pages: [{ title: "Stories & people", kind: "post", publishedAt: "2024-04-02T09:00:00.000Z", status: "publish", slug: "news/story" }] });
    expect(JSON.stringify(staged.preview)).toContain("Complete body");
    expect(JSON.stringify(staged.preview)).not.toContain("Short fallback");
    expect(JSON.stringify(staged.preview)).toContain("https://source.example/images/story.png");
    expect(JSON.stringify(staged.preview)).toContain("https://source.example/audio/story.mp3");
  });
  it("handles namespaced Atom, single-quoted alternate links, XHTML order and xml:base", () => {
    const atom = `<atom:feed xmlns:atom="urn:atom" xml:base="https://source.example/journal/"><atom:entry><atom:title>Actual title</atom:title><atom:link rel='self' href='entry.xml'/><atom:link rel='alternate' href='story.html'/><atom:updated>2024-04-02T09:00:00Z</atom:updated><atom:content type="xhtml" xml:base="/assets/"><div xmlns="http://www.w3.org/1999/xhtml"><p>Before <em>middle</em> after.</p><img src="images/story.png" alt="Story"/></div></atom:content></atom:entry></atom:feed>`;
    const staged = stageImportSource("atom", atom, "https://source.example/feeds/atom.xml");
    expect(staged.preview).toMatchObject({ pages: [{ url: "https://source.example/journal/story.html", slug: "journal/story", kind: "post", publishedAt: "2024-04-02T09:00:00.000Z" }] });
    expect(JSON.stringify(staged.preview)).toContain("Before <em>middle</em> after.");
    expect(JSON.stringify(staged.preview)).toContain("https://source.example/assets/images/story.png");
  });
  it("keeps future feed entries as unpublished drafts", () => {
    expect(parseGenericFeed(`<feed><entry><title>Future source entry</title><link href="https://source.example/future"/><published>2050-01-02T09:00:00Z</published><content>Future body</content></entry></feed>`, "https://source.example/feed.xml")[0]).toMatchObject({ status: "draft", publishedAt: "2050-01-02T09:00:00.000Z" });
  });
  it("refuses malformed/DTD feeds and off-origin bases instead of inventing addresses", () => {
    for (const payload of ["<rss><channel>", '<!DOCTYPE rss [<!ENTITY secret "no">]><rss><channel/></rss>', '<feed xml:base="https://other.example/"><entry><title>Other</title><link href="private"/></entry></feed>']) expect(() => parseGenericFeed(payload, "https://source.example/feed.xml")).toThrow();
    expect(() => parseGenericFeed('<feed><entry><id>urn:example:opaque</id><title>Opaque</title></entry></feed>', "https://source.example/feed.xml")).toThrow();
  });
  it("bounds HTML nesting and rejects a foreign declared base", () => {
    expect(() => parseGenericHtml(`${"<div>".repeat(205)}Deep${"</div>".repeat(205)}`, "https://source.example/deep")).toThrow(/nesting/);
    expect(() => parseGenericHtml('<base href="https://other.example/"><main>Other origin</main>', "https://source.example/page")).toThrow(/origin/);
  });
  it("preserves distinct media query identities and exposes blocked source media", () => {
    const staged = stageImportSource("html", '<title>Variants</title><main><img src="/image?size=1"><img src="/image?size=2"><img src="https://other.example/a.png"><img src="/private/a.png"></main>', "https://source.example/page", "User-agent: *\nDisallow: /private/");
    expect(staged.counts).toMatchObject({ media: 2, mediaWarnings: 2 });
    expect(staged.preview).toMatchObject({ generic: { media: [{ key: "https://source.example/image?size=1" }, { key: "https://source.example/image?size=2" }], report: { unresolvedMedia: ["https://other.example/a.png", "https://source.example/private/a.png"] } } });
  });
  it("marks pasted sitemap addresses as discovery-only before any CMS mutation", () => {
    expect(stageImportSource("sitemap", "<urlset><url><loc>https://source.example/team.html</loc></url></urlset>", "https://source.example/sitemap.xml").preview).toMatchObject({ generic: { report: { sourceWarnings: [{ code: "discovery-only", url: "https://source.example/team.html" }] } } });
  });
  it("keeps the outer semantic content's own fragment target", () => {
    expect(parseGenericHtml('<main id="source-root"><h1>Root target</h1></main>', "https://source.example/page").body).toContain('<span id="source-root"></span>');
  });
  it("reports inline responsive images without inventing a source fetch from their data bytes", () => {
    const staged = stageImportSource("html", '<title>Inline image</title><main><img srcset="data:image/png;base64,QUFB 1x"></main>', "https://source.example/page");
    expect(staged.counts).toMatchObject({ media: 0, mediaWarnings: 1 });
    expect(staged.preview).toMatchObject({ generic: { media: [], report: { unresolvedMedia: ["data:image/png;base64,QUFB 1x"] } } });
  });
});
