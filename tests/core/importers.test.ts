// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Importer contract and first-party parsers (C3.21, C3.22).
import { describe, expect, it } from "vitest";
import { defineImporter } from "@freeholder/plugin-kit";
import {
  assertPublicHttpUrl,
  enforceImporterLimits,
  robotsDisallow,
} from "@/core/import/contract";
import {
  parseRssOrAtom,
  parseSemanticHtml,
  parseSitemap,
  parseWordpressRest,
  parseWordpressWxr,
  discoverFromPublicOrigin,
} from "@/core/import/parsers";

describe("importer contract (C3.21)", () => {
  it("defines an importer only with network:external", () => {
    expect(() =>
      defineImporter({ name: "wxr", source: "wordpress-wxr", permissions: ["cms:write"] }),
    ).toThrow(/network:external/);
    expect(
      defineImporter({
        name: "wxr",
        source: "wordpress-wxr",
        permissions: ["cms:write", "network:external"],
      }).source,
    ).toBe("wordpress-wxr");
  });

  it("refuses private, link-local and credentialed origins", () => {
    const credentialedOrigin = new URL("https://example.com");
    credentialedOrigin.username = "fixture-user";
    credentialedOrigin.password = "fixture-password";
    expect(() => assertPublicHttpUrl("http://127.0.0.1/wp-json")).toThrow(/not a public origin/);
    expect(() => assertPublicHttpUrl("http://169.254.169.254/latest")).toThrow(/not a public origin/);
    expect(() => assertPublicHttpUrl(credentialedOrigin.href)).toThrow(/credentials/);
    expect(() => assertPublicHttpUrl("https://example.com/blog")).not.toThrow();
  });

  it("honours robots and page limits", () => {
    expect(robotsDisallow("User-agent: *\nDisallow: /private", "/private/page")).toBe(true);
    expect(robotsDisallow("User-agent: *\nDisallow: /private", "/about")).toBe(false);
    expect(() => enforceImporterLimits({ pages: 501, bytes: 1, depth: 1 })).toThrow(/page limit/);
  });
});

describe("first-party importers (C3.22)", () => {
  it("parses malformed HTML without retaining executable preview content", () => {
    const page = parseSemanticHtml(`<html lang=en><head><link href='/canonical' rel='alternate canonical'><title>A &#x26; B</title></head><body><main><h1>Welcome</h1><p onclick='steal()'>Copy<script data-x='>'>steal()</script><img src=x onerror='steal()'><a href='java&#115;cript:steal()'>Link</a></main></body>`, "https://example.com/old");
    expect(page).toMatchObject({ title: "A & B", canonical: "https://example.com/canonical", locale: "en", slug: "canonical" });
    expect(page.body).toContain("Copy");
    expect(page.body).not.toMatch(/<script|onclick|onerror|javascript:|steal\(/i);
  });

  it("decodes entities once and extracts title text with the HTML parser", () => {
    const rest = parseWordpressRest([{ title: { rendered: "<strong>A</strong> &amp;lt;B&amp;gt; &#169;" } }], "https://example.com");
    expect(rest[0]?.title).toBe("A &lt;B&gt; ©");
    expect(parseSemanticHtml("<h1>A <em>nested</em> heading</h1>", "https://example.com/page").title).toBe("A nested heading");
    expect(parseSemanticHtml("<link rel=canonical href='javascript:bad()'><h1>Good</h1>", "https://example.com/page").canonical).toBeUndefined();
  });

  it("parses WordPress REST, WXR, sitemap, RSS and semantic HTML", () => {
    const rest = parseWordpressRest(
      [{ link: "https://example.com/about", slug: "about", type: "page", title: { rendered: "About" }, content: { rendered: "<p>Hi</p>" } }],
      "https://example.com",
    );
    expect(rest[0]).toMatchObject({ slug: "about", title: "About", kind: "page" });

    const wxr = parseWordpressWxr(
      `<channel><item><title>Hello</title><link>https://example.com/hello</link><wp:post_type>post</wp:post_type><wp:post_name>hello</wp:post_name><content:encoded><![CDATA[<p>Hi</p>]]></content:encoded></item></channel>`,
    );
    expect(wxr[0]).toMatchObject({ slug: "hello", kind: "post" });

    expect(parseSitemap("<urlset><url><loc>https://example.com/a</loc></url></urlset>")[0]?.url).toBe(
      "https://example.com/a",
    );
    expect(parseRssOrAtom("<rss><item><title>Note</title><link>https://example.com/note</link></item></rss>")[0]?.slug).toBe(
      "note",
    );
    expect(parseSemanticHtml("<html lang='en'><title>About</title><article>Hi</article></html>", "https://example.com/about").title).toBe(
      "About",
    );
  });

  it("blocks off-origin and robots-disallowed URLs", () => {
    const discovered = discoverFromPublicOrigin(
      "https://example.com",
      [
        { url: "https://example.com/ok" },
        { url: "https://evil.example/x" },
        { url: "https://example.com/hidden" },
      ],
      "User-agent: *\nDisallow: /hidden",
    );
    expect(discovered.pages.map((page) => page.url)).toEqual(["https://example.com/ok"]);
    expect(discovered.blocked).toHaveLength(2);
  });
});
