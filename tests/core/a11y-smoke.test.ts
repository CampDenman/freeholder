// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: AGPL-3.0-only
// The a11y smoke test's own test (MASTER.md §15.7).
//
// This one exists for a specific reason. The gate runs axe *inside* a jsdom
// window, and every plausible way of getting that wrong — axe not injected,
// the rule list misspelled, the document empty by the time it runs — produces
// the same output as a clean page: no violations. A gate whose failure mode is
// silence has to be shown failing before anybody trusts its silence.
import { describe, expect, it } from "vitest";
import { auditHtml } from "../../scripts/a11y-smoke.mjs";

const doc = (body: string, attrs = 'lang="en"') =>
  `<!doctype html><html ${attrs}><head><title>A page</title>
   <meta name="viewport" content="width=device-width, initial-scale=1"></head>
   <body>${body}</body></html>`;

const ids = async (html: string) =>
  (await auditHtml(html, "https://example.test/")).violations.map(
    (violation: { id: string }) => violation.id,
  );

describe("the a11y smoke test", () => {
  it("passes a page that is put together properly", async () => {
    const html = doc(
      `<main><h1>Services</h1><h2>Weddings</h2>
       <img src="/a.jpg" alt="A boat at the dock">
       <a href="/contact">Get in touch</a>
       <button type="button">Open</button>
       <ul><li>One</li></ul></main>`,
    );
    expect(await ids(html)).toEqual([]);
  });

  it("catches an image nobody described", async () => {
    expect(await ids(doc(`<main><h1>S</h1><img src="/a.jpg"></main>`))).toContain(
      "image-alt",
    );
  });

  it("catches a control with no accessible name", async () => {
    const html = doc(`<main><h1>S</h1><button type="button"></button>
      <a href="/x"><img src="/i.png" alt=""></a></main>`);
    const found = await ids(html);
    expect(found).toContain("button-name");
    expect(found).toContain("link-name");
  });

  it("catches a document with no language", async () => {
    expect(await ids(doc(`<main><h1>S</h1></main>`, ""))).toContain("html-has-lang");
  });

  it("catches headings that skip a level", async () => {
    // h1 → h3 tells a screen-reader user a section is missing.
    expect(await ids(doc(`<main><h1>S</h1><h3>Sub</h3></main>`))).toContain(
      "heading-order",
    );
  });

  it("catches content adrift outside any landmark", async () => {
    expect(await ids(doc(`<h1>S</h1><p>Loose copy</p>`))).toContain("region");
  });

  it("reports the rules it could not decide, rather than counting them as passes", async () => {
    // Found while writing these tests: `page-has-heading-one` comes back
    // *incomplete* under jsdom, because axe needs layout to decide it. A gate
    // collecting only violations would have recorded that as a pass forever.
    // It is out of the rule list now, and anything else that lands in the same
    // state is surfaced rather than swallowed.
    const result = await auditHtml(
      doc(`<main><h2>Not a heading one</h2></main>`),
      "https://example.test/",
    );
    expect(result.violations).toEqual([]);
    expect(Array.isArray(result.undecided)).toBe(true);
  });

  it("ignores the page's own scripts rather than executing them", async () => {
    // The real pages arrive with React's hydration bundle attached. Running it
    // inside jsdom would fail for reasons that say nothing about the markup,
    // so scripts are stripped — and this asserts that stripping them does not
    // take the document with it.
    const html = doc(
      `<main><h1>S</h1></main><script>throw new Error("this must never run")</script>`,
    );
    expect(await ids(html)).toEqual([]);
  });
});
