// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// First-party WordPress and generic-site importers (C3.22).
import { parse, parseFragment, serialize, type DefaultTreeAdapterTypes } from "parse5";
import { sanitizeOwnerHtml } from "@/modules/cms/blocks/html";
import {
  assertPublicHttpUrl,
  DEFAULT_IMPORTER_LIMITS,
  enforceImporterLimits,
  robotsDisallow,
  type ImporterDiscovery,
  type ImporterMapping,
} from "./contract";

export type ParsedPage = ImporterMapping & {
  body: string;
  locale?: string;
  redirectFrom?: string[];
  provenance: { url: string; source: string };
};

function textOf(xml: string, tag: string): string {
  const match = new RegExp(`<${tag}[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]></${tag}>|<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "i").exec(
    xml,
  );
  return (match?.[1] ?? match?.[2] ?? "").trim();
}

type HtmlNode = DefaultTreeAdapterTypes.Node;

function children(node: HtmlNode): HtmlNode[] {
  return "childNodes" in node ? node.childNodes : [];
}

/** Browser parsing decodes character references once, including numeric ones. */
function textContent(root: HtmlNode): string {
  const text: string[] = [];
  const pending = [root];
  while (pending.length) {
    const node = pending.pop()!;
    if (node.nodeName === "#text") text.push((node as DefaultTreeAdapterTypes.TextNode).value);
    else if (!("tagName" in node) || !["script", "style"].includes(node.tagName)) {
      const nested = children(node);
      for (let index = nested.length - 1; index >= 0; index -= 1) pending.push(nested[index]!);
    }
  }
  return text.join("");
}

function decodeEntities(value: string): string {
  return textContent(parseFragment(value));
}

function slugFromUrl(url: string): string {
  try {
    const parsed = new URL(url);
    const tail = parsed.pathname.replace(/\/+$/, "").split("/").filter(Boolean).at(-1);
    return tail && tail !== "index.html" ? tail : "home";
  } catch {
    return "page";
  }
}

export function parseWordpressRest(payload: unknown, origin: string): ParsedPage[] {
  if (!Array.isArray(payload)) {
    throw new Error("WordPress REST expected an array of posts or pages.");
  }
  const pages: ParsedPage[] = [];
  let bytes = 0;
  for (const item of payload) {
    if (!item || typeof item !== "object") continue;
    const row = item as {
      link?: string;
      slug?: string;
      type?: string;
      title?: { rendered?: string };
      content?: { rendered?: string };
    };
    const url = row.link ?? `${origin}/${row.slug ?? "item"}`;
    const body = row.content?.rendered ?? "";
    bytes += body.length;
    enforceImporterLimits({ pages: pages.length + 1, bytes, depth: 1 });
    pages.push({
      url,
      slug: row.slug ?? slugFromUrl(url),
      title: decodeEntities(row.title?.rendered ?? row.slug ?? "Untitled"),
      kind: row.type === "post" ? "post" : "page",
      body,
      provenance: { url, source: "wordpress-rest" },
    });
  }
  return pages;
}

export function parseWordpressWxr(xml: string): ParsedPage[] {
  const items = xml.split(/<item>/i).slice(1);
  const pages: ParsedPage[] = [];
  let bytes = 0;
  for (const item of items) {
    const type = textOf(item, "wp:post_type") || textOf(item, "post_type");
    if (type && type !== "post" && type !== "page") continue;
    const url = textOf(item, "link");
    const title = decodeEntities(textOf(item, "title") || "Untitled");
    const body = textOf(item, "content:encoded") || textOf(item, "description");
    bytes += body.length + xml.length * 0;
    enforceImporterLimits({ pages: pages.length + 1, bytes, depth: 1 });
    pages.push({
      url,
      slug: textOf(item, "wp:post_name") || slugFromUrl(url),
      title,
      kind: type === "post" ? "post" : "page",
      body,
      provenance: { url, source: "wordpress-wxr" },
    });
  }
  return pages;
}

export function parseSitemap(xml: string): ImporterDiscovery["pages"] {
  const locs = [...xml.matchAll(/<loc>\s*([^<]+)\s*<\/loc>/gi)].map((match) =>
    decodeEntities(match[1] ?? "").trim(),
  );
  enforceImporterLimits({ pages: locs.length, bytes: xml.length, depth: 1 });
  return locs.map((url) => ({ url, title: slugFromUrl(url) }));
}

export function parseRssOrAtom(xml: string): ParsedPage[] {
  const isAtom = /<feed[\s>]/i.test(xml);
  const chunks = isAtom ? xml.split(/<entry[\s>]/i).slice(1) : xml.split(/<item>/i).slice(1);
  const pages: ParsedPage[] = [];
  let bytes = 0;
  for (const chunk of chunks) {
    const url = isAtom
      ? (/<link[^>]+href="([^"]+)"/i.exec(chunk)?.[1] ?? textOf(chunk, "id"))
      : textOf(chunk, "link") || textOf(chunk, "guid");
    const title = decodeEntities(textOf(chunk, "title") || "Untitled");
    const body = textOf(chunk, "content") || textOf(chunk, "description") || textOf(chunk, "summary");
    bytes += body.length;
    enforceImporterLimits({ pages: pages.length + 1, bytes, depth: 1 });
    pages.push({
      url,
      slug: slugFromUrl(url),
      title,
      kind: "post",
      body,
      provenance: { url, source: isAtom ? "atom" : "rss" },
    });
  }
  return pages;
}

export function parseSemanticHtml(html: string, url: string): ParsedPage {
  enforceImporterLimits({ pages: 1, bytes: html.length, depth: 1 });
  const document = parse(html);
  const elements: DefaultTreeAdapterTypes.Element[] = [];
  const pending: HtmlNode[] = [document];
  while (pending.length) {
    const node = pending.pop()!;
    if ("tagName" in node) elements.push(node);
    const nested = children(node);
    for (let index = nested.length - 1; index >= 0; index -= 1) pending.push(nested[index]!);
  }
  const first = (tag: string) => elements.find((node) => node.tagName === tag);
  const attribute = (node: DefaultTreeAdapterTypes.Element | undefined, name: string) => node?.attrs.find((attr) => attr.name === name)?.value;
  const title = textContent(first("title") ?? parseFragment("")).trim() || textContent(first("h1") ?? parseFragment("")).trim() || slugFromUrl(url);
  const canonicalNode = elements.find((node) => node.tagName === "link" && (attribute(node, "rel") ?? "").toLowerCase().split(/\s+/).includes("canonical"));
  const canonicalHref = attribute(canonicalNode, "href");
  let canonical: string | undefined;
  try {
    if (canonicalHref) {
      const candidate = new URL(canonicalHref, url);
      if (["http:", "https:"].includes(candidate.protocol) && !candidate.username && !candidate.password) canonical = candidate.href;
    }
  } catch { /* Malformed source metadata does not become canonical metadata. */ }
  const locale = attribute(first("html"), "lang");
  const article = first("article") ?? first("main") ?? first("body") ?? document;
  return {
    url,
    slug: slugFromUrl(canonical ?? url),
    title,
    kind: "page",
    // Use the same allowlist as committed CMS content for import previews too.
    body: sanitizeOwnerHtml(serialize(article)).trim(),
    locale,
    canonical,
    provenance: { url, source: "html" },
  };
}

export function discoverFromPublicOrigin(
  origin: string,
  pages: ImporterDiscovery["pages"],
  robotsTxt = "",
): ImporterDiscovery {
  const url = assertPublicHttpUrl(origin);
  const blocked: string[] = [];
  const allowed: ImporterDiscovery["pages"] = [];
  for (const page of pages) {
    const target = assertPublicHttpUrl(page.url);
    if (target.origin !== url.origin) {
      blocked.push(page.url);
      continue;
    }
    if (robotsDisallow(robotsTxt, target.pathname)) {
      blocked.push(page.url);
      continue;
    }
    allowed.push(page);
  }
  enforceImporterLimits({
    pages: allowed.length,
    bytes: 0,
    depth: 1,
    ...DEFAULT_IMPORTER_LIMITS,
  });
  return { origin: url.origin, pages: allowed, blocked };
}
