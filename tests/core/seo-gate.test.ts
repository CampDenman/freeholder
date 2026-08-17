// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// The SEO gate's own tests (MASTER.md §5, §15.2).
//
// A gate is worth what its failures are worth, and this one guards a doctrine
// the whole project is sold on. So each rule is fed a page that breaks it and
// asserted to complain — and, just as important, a page that *nearly* breaks
// it and asserted to stay quiet. A gate that fires on a decorative image or a
// legitimate second heading gets suppressed, and a suppressed gate is a
// worse outcome than no gate at all.
import { describe, expect, it } from "vitest";
import { auditPage } from "../../scripts/seo-gate.mjs";

const page = (body: string, head = "") => `<!doctype html>
<html lang="en"><head>
<title>A page · Aurora Coast</title>
<meta name="description" content="Something true about this page.">
<link rel="canonical" href="https://example.test/services">
<meta property="og:image" content="https://example.test/og/services">
${head}
</head><body>${body}</body></html>`;

const audit = (html: string, extra: Partial<Parameters<typeof auditPage>[0]> = {}) =>
  auditPage({ url: "https://example.test/services", html, status: 200, ...extra });

const messages = (html: string, extra = {}) =>
  audit(html, extra).problems.map((p: { message: string }) => p.message);

describe("a page that obeys §5", () => {
  it("produces no problems", () => {
    const html = page(
      `<h1>Services</h1><img src="/a.jpg" alt="A boat at the dock">
       <script type="application/ld+json">
       {"@context":"https://schema.org","@type":"BreadcrumbList",
        "itemListElement":[{"@type":"ListItem","position":1,"name":"Home","item":"https://example.test/"}]}
       </script>`,
    );
    expect(messages(html)).toEqual([]);
  });

  it("collects the links a crawler would follow", () => {
    const html = page(`<h1>Services</h1><a href="/about">About</a><a href="https://elsewhere.test">Away</a>`);
    expect(audit(html).links).toEqual(["/about", "https://elsewhere.test"]);
  });
});

describe("what it refuses", () => {
  it("a page that did not answer 200", () => {
    expect(
      auditPage({ url: "https://example.test/gone", html: "", status: 404 }).problems,
    ).toEqual([{ url: "https://example.test/gone", message: "answered 404" }]);
  });

  it("a missing title or description", () => {
    const html = `<!doctype html><html lang="en"><head>
      <link rel="canonical" href="https://example.test/services"></head>
      <body><h1>Services</h1></body></html>`;
    expect(messages(html)).toContain("has no <title>");
    expect(messages(html)).toContain("has no meta description");
  });

  it("a missing or relative og:image", () => {
    const html = page(`<h1>S</h1>`).replace(
      '<meta property="og:image" content="https://example.test/og/services">',
      "",
    );
    expect(messages(html)).toContain("has no og:image");

    const relative = page(`<h1>S</h1>`).replace(
      "https://example.test/og/services",
      "/og/services",
    );
    expect(messages(relative)).toContain(
      "has a relative og:image (/og/services); social crawlers need an absolute URL",
    );
  });

  it("a canonical that is relative, absent, or points elsewhere", () => {
    const noCanonical = `<!doctype html><html lang="en"><head><title>T</title>
      <meta name="description" content="d"></head><body><h1>S</h1></body></html>`;
    expect(messages(noCanonical)).toContain("has no canonical link");

    const relative = page(`<h1>S</h1>`).replace(
      'href="https://example.test/services"',
      'href="/services"',
    );
    expect(messages(relative)).toContain(
      "has a relative canonical (/services); §5 requires an absolute URL",
    );

    // A canonical naming a different URL is not an error: it is what a second
    // address for one page looks like — a locale-prefixed URL for an
    // untranslated page, say. The crawler stops holding it to the uniqueness
    // rules instead of complaining about it.
    const elsewhere = page(`<h1>S</h1>`).replace("/services\">", "/about\">");
    expect(messages(elsewhere)).toEqual([]);
    expect(audit(elsewhere).isCanonical).toBe(false);
    expect(audit(page(`<h1>S</h1>`)).isCanonical).toBe(true);
  });

  it("zero or several H1s", () => {
    expect(messages(page(`<p>No heading</p>`))).toContain(
      "has 0 <h1> elements; exactly one is expected",
    );
    expect(messages(page(`<h1>One</h1><h1>Two</h1>`))).toContain(
      "has 2 <h1> elements; exactly one is expected",
    );
  });

  it("an image with no alt attribute at all", () => {
    expect(messages(page(`<h1>S</h1><img src="/a.jpg">`))).toContain(
      "has an <img> with no alt attribute (/a.jpg)",
    );
  });

  it("but accepts an empty alt when the image is marked decorative", () => {
    // alt="" is the correct markup for an image that carries no meaning, and a
    // gate that rejected it would be teaching people to describe wallpaper.
    expect(
      messages(page(`<h1>S</h1><img src="/border.svg" alt="" aria-hidden="true">`)),
    ).toEqual([]);
    expect(messages(page(`<h1>S</h1><img src="/x.jpg" alt="">`))).toContain(
      "has an <img> with empty alt that is not marked decorative (/x.jpg)",
    );
  });

  it("JSON-LD that is broken, foreign, or hollow", () => {
    const bad = (json: string) =>
      messages(page(`<h1>S</h1><script type="application/ld+json">${json}</script>`));

    expect(bad("{not json")).toContain("has JSON-LD that is not valid JSON");
    expect(bad('{"@context":"https://example.org","@type":"WebSite","name":"n","url":"u"}')).toContain(
      'has JSON-LD with @context "https://example.org"',
    );
    // Syntactically fine, useless to a search engine: this is what "validated
    // against schema.org types" has to mean if it is to mean anything.
    expect(bad('{"@context":"https://schema.org","@type":"WebSite","url":"u"}')).toContain(
      'has WebSite JSON-LD without "name"',
    );
    expect(
      bad('{"@context":"https://schema.org","@type":"BreadcrumbList","itemListElement":[{"name":"Home"}]}'),
    ).toContain("has a BreadcrumbList whose items lack position or item");
    expect(
      bad('{"@context":"https://schema.org","@type":"Product","name":"Print"}'),
    ).toContain('has Product JSON-LD without "offers"');
    expect(
      bad('{"@context":"https://schema.org","@type":"Service","name":"Weddings"}'),
    ).toContain('has Service JSON-LD without "url"');
    expect(
      bad('{"@context":"https://schema.org","@type":"Product","name":"Print","offers":{"@type":"Offer","price":"50.00","priceCurrency":"CAD"}}'),
    ).toEqual([]);
  });

  it("accepts whatever business type the owner chose", () => {
    // §13 lets an owner pick any schema.org business type, so the gate cannot
    // hold an allowlist of them without breaking the setup wizard's promise.
    for (const type of ["Photographer", "HairSalon", "ProfessionalService"]) {
      expect(
        messages(
          page(
            `<h1>S</h1><script type="application/ld+json">{"@context":"https://schema.org","@type":"${type}","name":"n","url":"u"}</script>`,
          ),
        ),
      ).toEqual([]);
    }
  });
});

describe("hreflang", () => {
  const html = page(`<h1>S</h1>`);

  it("is not demanded of a single-locale site", () => {
    // Otherwise every instance is told to add tags describing a translation
    // that does not exist.
    expect(messages(html, { locales: 1 })).toEqual([]);
  });

  it("is demanded once a second locale exists", () => {
    expect(messages(html, { locales: 2 })).toContain(
      "emits no hreflang alternates, and this instance has more than one locale",
    );
  });

  it("still wants x-default when alternates are present", () => {
    const withAlternates = page(
      `<h1>S</h1>`,
      `<link rel="alternate" hreflang="fr" href="https://example.test/fr/services">`,
    );
    expect(messages(withAlternates, { locales: 2 })).toEqual([
      "emits hreflang alternates but no x-default",
    ]);
  });
});
