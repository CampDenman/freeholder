// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// The SEO gate (MASTER.md §5, §15.2).
//
// §5 is called "doctrine, enforced structurally" — the argument being that a
// platform which merely *documents* SEO practice has documented an aspiration.
// This is where the enforcement happens: crawl the seeded demo site as a
// search engine would, and fail the build on what §15.2 lists.
//
// It runs against a real server rendering real pages, not against the source,
// because every interesting failure lives in the gap between them: a canonical
// built from the wrong origin, a title that is unique in the database and
// duplicated after a template appends the site name, an image whose alt text
// is lost by the block that renders it.
//
// Usage: node scripts/seo-gate.mjs <base-url>
import { JSDOM } from "jsdom";

/** Surfaces that are deliberately not for crawlers (robots.txt agrees). */
const PRIVATE = [
  /^\/admin/,
  /^\/login/,
  /^\/preview/,
  /^\/portal/,
  /^\/api\//,
  /^\/checkout/,
  /^\/cart/,
  /^\/og(\/|$)/,
  /^\/feeds\//,
];

/** Things a link may point at that are not pages to crawl. */
const NOT_A_PAGE = [/^\/media\//, /^\/_next\//, /\.(xml|txt|json|jpg|png|webp|avif|svg|ico)$/];

const isPrivate = (path) => PRIVATE.some((rx) => rx.test(path));
const isPage = (path) => !NOT_A_PAGE.some((rx) => rx.test(path));

/**
 * Every schema.org type this platform emits, and what each must carry.
 *
 * "Validated against schema.org types" (§15.2) cannot mean fetching the whole
 * vocabulary at build time. It can mean this: the types we claim to emit are
 * enumerated, each with the properties that make it useful rather than merely
 * syntactically valid — a BreadcrumbList with no positions is valid JSON-LD
 * and worthless to Google.
 */
const REQUIRED_PROPERTIES = {
  WebSite: ["name", "url"],
  BreadcrumbList: ["itemListElement"],
  FAQPage: ["mainEntity"],
  Organization: ["name", "url"],
  Product: ["name", "offers"],
  Offer: ["price", "priceCurrency"],
  Service: ["name", "url"],
  Article: ["headline"],
};

/** schema.org business types an owner may pick in setup (§13). Open-ended. */
const BUSINESS_TYPE = /^[A-Z][A-Za-z]+$/;

/**
 * Audit one rendered page. Pure: no network, no state.
 *
 * Returns a list of problems, each naming the page and what is wrong in the
 * words somebody would need to fix it.
 */
export function auditPage({ url, html, status, locales = 1 }) {
  const problems = [];
  const at = (message) => problems.push({ url, message });

  if (status !== 200) {
    at(`answered ${status}`);
    return { problems, links: [], title: null, description: null, canonical: null };
  }

  const { document } = new JSDOM(html).window;

  const title = document.querySelector("title")?.textContent?.trim() ?? "";
  if (!title) at("has no <title>");

  const description = document
    .querySelector('meta[name="description"]')
    ?.getAttribute("content")
    ?.trim() ?? "";
  if (!description) at("has no meta description");

  // §5: "a canonical absolute URL on every page". Absolute, and pointing at
  // itself — a canonical that names a different page is how a site asks to be
  // deindexed.
  const canonical = document
    .querySelector('link[rel="canonical"]')
    ?.getAttribute("href");
  if (!canonical) {
    at("has no canonical link");
  } else if (!/^https?:\/\//.test(canonical)) {
    at(`has a relative canonical (${canonical}); §5 requires an absolute URL`);
  }

  // §5: "Full OG + Twitter card set; auto-generated OG images".
  const ogImage = document
    .querySelector('meta[property="og:image"]')
    ?.getAttribute("content");
  if (!ogImage) at("has no og:image");
  else if (!/^https?:\/\//.test(ogImage)) {
    at(`has a relative og:image (${ogImage}); social crawlers need an absolute URL`);
  }

  // The document's declared language against the one its URL claims. A French
  // page saying lang="en" passes every validator and is read aloud in the
  // wrong accent — the failure this caught on its first run.
  const prefixed = /^\/([a-z]{2}(?:-[A-Za-z]{2,4})?)(?:\/|$)/.exec(
    new URL(url).pathname,
  );
  const declared = document.documentElement.getAttribute("lang");
  if (!declared) {
    at("has no lang on <html>");
  } else if (prefixed && declared.toLowerCase() !== prefixed[1].toLowerCase()) {
    at(`is served under /${prefixed[1]}/ but declares lang="${declared}"`);
  }

  const h1s = document.querySelectorAll("h1");
  if (h1s.length !== 1) at(`has ${h1s.length} <h1> elements; exactly one is expected`);

  for (const img of document.querySelectorAll("img")) {
    const alt = img.getAttribute("alt");
    if (alt === null) at(`has an <img> with no alt attribute (${img.getAttribute("src")})`);
    else if (alt.trim() === "" && !img.hasAttribute("aria-hidden")) {
      at(`has an <img> with empty alt that is not marked decorative (${img.getAttribute("src")})`);
    }
  }

  // hreflang is only meaningful once a second locale exists. Checking it
  // unconditionally would train people to add tags that describe nothing.
  if (locales > 1) {
    const alternates = document.querySelectorAll('link[rel="alternate"][hreflang]');
    if (alternates.length === 0) at("emits no hreflang alternates, and this instance has more than one locale");
    const xDefault = [...alternates].some((l) => l.getAttribute("hreflang") === "x-default");
    if (!xDefault) at("emits hreflang alternates but no x-default");
  }

  for (const script of document.querySelectorAll('script[type="application/ld+json"]')) {
    let data;
    try {
      data = JSON.parse(script.textContent ?? "");
    } catch {
      at("has JSON-LD that is not valid JSON");
      continue;
    }
    for (const node of Array.isArray(data) ? data : [data]) {
      const type = node["@type"];
      if (node["@context"] !== "https://schema.org") {
        at(`has JSON-LD with @context "${String(node["@context"])}"`);
      }
      if (typeof type !== "string" || !BUSINESS_TYPE.test(type)) {
        at(`has JSON-LD with an unusable @type (${JSON.stringify(type)})`);
        continue;
      }
      for (const property of REQUIRED_PROPERTIES[type] ?? []) {
        if (node[property] === undefined) {
          at(`has ${type} JSON-LD without "${property}"`);
        }
      }
      if (type === "BreadcrumbList") {
        const items = node.itemListElement ?? [];
        if (!items.every((i) => typeof i.position === "number" && i.item)) {
          at("has a BreadcrumbList whose items lack position or item");
        }
      }
    }
  }

  const links = [...document.querySelectorAll("a[href]")]
    .map((a) => a.getAttribute("href"))
    .filter(Boolean);

  // A page that names *another* URL as canonical is not claiming to be a page
  // of its own — it is a second address for one. That is exactly what a
  // locale-prefixed URL for an untranslated page is, and holding it to the
  // uniqueness rules would demand it invent a different title for content that
  // is deliberately the same.
  const isCanonical =
    !canonical ||
    !/^https?:\/\//.test(canonical) ||
    new URL(canonical).pathname === new URL(url).pathname;

  return { problems, links, title, description, isCanonical };
}

/** Follow every internal link from the root, recording how deep each page is. */
async function crawl(base) {
  const origin = new URL(base).origin;
  const queue = [{ path: "/", depth: 0 }];
  const seen = new Map();
  const problems = [];
  const titles = new Map();
  const descriptions = new Map();
  /** Paths that name another URL as canonical — second addresses, not pages. */
  const alternates = new Set();

  while (queue.length > 0) {
    const { path, depth } = queue.shift();
    if (seen.has(path)) {
      seen.set(path, Math.min(seen.get(path), depth));
      continue;
    }
    seen.set(path, depth);

    const url = `${origin}${path}`;
    const response = await fetch(url, { redirect: "manual" });
    const html = response.status === 200 ? await response.text() : "";
    const page = auditPage({ url, html, status: response.status });
    problems.push(...page.problems);

    if (!page.isCanonical) alternates.add(path);
    if (page.title && page.isCanonical) {
      titles.set(page.title, [...(titles.get(page.title) ?? []), path]);
    }
    if (page.description && page.isCanonical) {
      descriptions.set(page.description, [
        ...(descriptions.get(page.description) ?? []),
        path,
      ]);
    }

    for (const href of page.links) {
      if (/^(https?:|mailto:|tel:|#)/.test(href) && !href.startsWith(origin)) continue;
      const target = new URL(href, url);
      if (target.origin !== origin) continue;
      const next = target.pathname;
      if (isPrivate(next) || !isPage(next)) continue;
      if (!seen.has(next)) queue.push({ path: next, depth: depth + 1 });
    }
  }

  // §5: "no page more than 3 clicks from home". Depth is the shortest path
  // found, which is what a crawler experiences.
  for (const [path, depth] of seen) {
    if (depth > 3) problems.push({ url: path, message: `is ${depth} clicks from the home page` });
  }

  // Uniqueness is a property of the *set*, so it cannot be checked per page.
  for (const [title, paths] of titles) {
    if (paths.length > 1) {
      problems.push({ url: paths.join(", "), message: `share the title "${title}"` });
    }
  }
  for (const [description, paths] of descriptions) {
    if (paths.length > 1) {
      problems.push({
        url: paths.join(", "),
        message: `share the meta description "${description.slice(0, 60)}…"`,
      });
    }
  }

  return { seen, problems, alternates };
}

/** Everything the sitemap claims, so orphans and lies both surface. */
async function sitemapPaths(base) {
  const origin = new URL(base).origin;
  const index = await (await fetch(`${origin}/sitemap.xml`)).text();
  const maps = [...index.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  const paths = new Set();
  for (const map of maps) {
    const xml = await (await fetch(map)).text();
    for (const [, loc] of xml.matchAll(/<loc>([^<]+)<\/loc>/g)) {
      paths.add(new URL(loc).pathname);
    }
  }
  return paths;
}

async function main() {
  const base = process.argv[2] ?? "http://localhost:3000";
  const { seen, problems, alternates } = await crawl(base);
  const sitemap = await sitemapPaths(base);

  // An orphan is in the sitemap and reachable by no link. It is the failure
  // §5's browse hierarchy exists to prevent, and it is invisible to anything
  // that only reads the sitemap.
  for (const path of sitemap) {
    if (!seen.has(path)) {
      problems.push({ url: path, message: "is in the sitemap but no page links to it" });
    }
  }
  // And the reverse: a page people can reach that the sitemap never mentions.
  for (const path of seen.keys()) {
    if (alternates.has(path)) continue;
    if (!sitemap.has(path)) {
      problems.push({ url: path, message: "is linked from the site but missing from the sitemap" });
    }
  }

  console.log(`SEO gate: crawled ${seen.size} pages from ${base}`);
  for (const [path, depth] of [...seen].sort()) {
    console.log(`  ${depth} ${path}`);
  }

  if (problems.length > 0) {
    console.error(`\nSEO gate (MASTER.md §5, §15.2): ${problems.length} problem(s).\n`);
    for (const problem of problems) {
      console.error(`  ${problem.url}\n    ${problem.message}`);
    }
    process.exit(1);
  }

  if (seen.size < 2) {
    console.error(
      "\nSEO gate: only the home page was crawled. The demo site is not installed, " +
        "so this gate checked almost nothing — boot with FREEHOLDER_SEED_DEMO=1.",
    );
    process.exit(1);
  }

  console.log("\nSEO gate: the crawled site obeys §5.");
}

if (process.argv[1] && process.argv[1].endsWith("seo-gate.mjs")) {
  await main();
}
