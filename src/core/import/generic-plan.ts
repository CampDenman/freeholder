// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C3.22: source HTML/feed content keeps its own identity and typed media plan.
import { parse, type DefaultTreeAdapterTypes } from "parse5";
import { z } from "zod";
import { assertPublicHttpUrl, enforceImporterLimits, robotsDisallow } from "./contract";
import { safeImportHref } from "./content-links";
import { sourceContentBody } from "./archive-content";
import { toCmsSlug, type WordpressSeo } from "./wordpress";
import type { ParsedPage } from "./parsers";

type Node = DefaultTreeAdapterTypes.Node;
type Element = DefaultTreeAdapterTypes.Element;
const attr = (node: Element | undefined, name: string) => node?.attrs.find(item => item.name === name)?.value;
const children = (node: Node): Node[] => "childNodes" in node ? node.childNodes : [];
function elements(root: Node): Element[] {
  const result: Element[] = [], pending = [{ node: root, depth: 0 }];
  let count = 0;
  while (pending.length) {
    const { node, depth } = pending.pop()!;
    if (++count > 100_000 || depth > 200) throw new Error("A source document exceeds its element or nesting limit.");
    if ("tagName" in node) result.push(node);
    const nested = children(node);
    for (let index = nested.length - 1; index >= 0; index--) pending.push({ node: nested[index]!, depth: depth + 1 });
  }
  return result;
}
function text(node: Node | undefined): string {
  if (!node) return "";
  const output: string[] = [], pending = [node];
  while (pending.length) {
    const current = pending.pop()!;
    if (current.nodeName === "#text") output.push((current as DefaultTreeAdapterTypes.TextNode).value);
    else if (!("tagName" in current) || !["script", "style"].includes(current.tagName)) {
      const nested = children(current);
      for (let index = nested.length - 1; index >= 0; index--) pending.push(nested[index]!);
    }
  }
  return output.join("");
}
function setAttr(node: Element, name: string, value: string) {
  const current = node.attrs.find(item => item.name === name);
  if (current) current.value = value;
  else node.attrs.push({ name, value });
}
function inert(root: Node): void {
  const pending = [root];
  while (pending.length) {
    const current = pending.pop()!;
    if (!("childNodes" in current)) continue;
    current.childNodes = current.childNodes.filter(node => !("tagName" in node) || !["script", "style", "noscript", "template"].includes(node.tagName));
    for (const child of current.childNodes) {
      if ("tagName" in child) child.attrs = child.attrs.filter(item => !item.name.startsWith("on") && !["srcdoc", "style"].includes(item.name));
      pending.push(child);
    }
  }
}

export const genericPlanSchema = z.object({
  version: z.literal(1),
  site: z.object({ url: z.string().url(), hosts: z.array(z.string()), basePath: z.string() }),
  robotsTxt: z.string().max(512 * 1024),
  media: z.array(z.object({ key: z.string(), sourceUrl: z.string().url(), filename: z.string(), aliases: z.array(z.string()), referenced: z.boolean(), altText: z.string().optional() })).max(500),
  report: z.object({ unresolvedMedia: z.array(z.string()), sourceWarnings: z.array(z.object({ code: z.enum(["query-address", "discovery-only"]), url: z.string().max(2_048) })).max(100) }),
});
export type GenericPlan = z.infer<typeof genericPlanSchema>;
export type GenericPage = ParsedPage & { status?: "publish" | "draft"; publishedAt?: string; seo?: WordpressSeo; redirectFromPath?: string };

/** Keep raw semantic content for the final shared typed-block sanitizer. */
export function parseGenericHtml(html: string, raw: string): GenericPage {
  const url = assertPublicHttpUrl(raw);
  if (Buffer.byteLength(html) > 2 * 1024 * 1024) throw new Error("A source HTML page exceeds its 2 MB content limit.");
  enforceImporterLimits({ pages: 1, bytes: Buffer.byteLength(html), depth: 1 });
  const document = parse(html), nodes = elements(document);
  const first = (tag: string) => nodes.find(node => node.tagName === tag);
  const meta = (name: string) => attr(nodes.find(node => node.tagName === "meta" && [attr(node, "name")?.toLowerCase(), attr(node, "property")?.toLowerCase()].includes(name.toLowerCase())), "content");
  const declared = attr(first("base"), "href");
  const base = declared ? assertPublicHttpUrl(new URL(declared, url).href) : url;
  if (base.origin !== url.origin) throw new Error("A source page declares a base outside its approved origin.");
  for (const node of nodes) {
    const names = node.tagName === "a" ? ["href"] : node.tagName === "img" ? ["src", "data-src", "data-lazy-src", "data-original"] : ["source", "video", "audio", "embed"].includes(node.tagName) ? ["src", "poster"] : node.tagName === "object" ? ["data"] : [];
    for (const name of names) {
      const value = attr(node, name);
      if (!value) continue;
      if (!safeImportHref(value, base.href)) {
        // Keep an inert data source only for the omission report. It is never
        // a network URL or rendered media; the typed converter requires Asset IDs.
        if (name !== "href" && value.startsWith("data:")) continue;
        setAttr(node, name, ""); continue;
      }
      try { setAttr(node, name, new URL(value, base).href); } catch { setAttr(node, name, ""); }
    }
    if (node.tagName === "img") {
      const candidates = [attr(node, "data-src"), attr(node, "data-lazy-src"), attr(node, "data-original")];
      let inlineFallback: string | undefined, selected = false;
      for (const sourceSet of [attr(node, "data-srcset"), attr(node, "srcset")]) {
        if (sourceSet?.trim().startsWith("data:")) { inlineFallback ??= sourceSet.trim(); continue; }
        const entries = (sourceSet ?? "").split(",").slice(0, 20).map(entry => /^\s*(\S+)(?:\s+(\d+(?:\.\d+)?)[wx])?\s*$/.exec(entry)).filter(Boolean);
        entries.sort((left, right) => Number(right?.[2] ?? 0) - Number(left?.[2] ?? 0));
        candidates.push(...entries.map(entry => entry![1]));
      }
      candidates.push(attr(node, "src"));
      for (const candidate of candidates) {
        if (!candidate || !safeImportHref(candidate, base.href)) continue;
        try {
          const target = assertPublicHttpUrl(new URL(candidate, base).href);
          setAttr(node, "src", target.href); selected = true; break;
        } catch { /* A non-HTTP placeholder is not a usable source image. */ }
      }
      if (!selected && inlineFallback) setAttr(node, "src", inlineFallback);
      node.attrs = node.attrs.filter(item => !["srcset", "data-srcset"].includes(item.name));
    }
  }
  const title = (text(first("title")).trim() || text(first("h1")).trim() || url.pathname).slice(0, 1_000);
  const robots = meta("robots") ?? "";
  let canonical: string | undefined;
  const canonicalHref = attr(nodes.find(node => node.tagName === "link" && (attr(node, "rel") ?? "").toLowerCase().split(/\s+/).includes("canonical")), "href");
  if (canonicalHref) try { canonical = assertPublicHttpUrl(new URL(canonicalHref, base).href).href; } catch { /* Invalid canonical metadata is omitted. */ }
  const publication = meta("article:published_time") ?? meta("datePublished");
  const published = publication ? Date.parse(publication) : NaN;
  const content = first("article") ?? first("main") ?? first("body") ?? document;
  inert(content);
  const sourcePath = url.pathname.replace(/^\/+|\/+$/g, "");
  const slug = toCmsSlug(sourcePath.replace(/(?:^|\/)index\.html?$/i, "").replace(/\.html?$/i, ""));
  return {
    url: url.href, slug, title, kind: "page", body: sourceContentBody(content), locale: attr(first("html"), "lang"),
    ...(Number.isFinite(published) ? { publishedAt: new Date(published).toISOString(), status: published > Date.now() ? "draft" as const : "publish" as const } : {}),
    ...(sourcePath !== slug ? { redirectFromPath: sourcePath } : {}),
    seo: { title, preserveTitle: true, ...(meta("description") ? { description: meta("description")!.slice(0, 1_000), preserveDescription: true } : {}), noindex: /\bnoindex\b/i.test(robots), nofollow: /\bnofollow\b/i.test(robots), canonical, ogTitle: meta("og:title")?.slice(0, 1_000), ogDescription: meta("og:description")?.slice(0, 1_000), ogImage: meta("og:image") },
    provenance: { url: url.href, source: "html" },
  };
}

export function stageGenericPages(pages: GenericPage[], origin: string, robotsTxt = "") {
  const site = assertPublicHttpUrl(origin), media = new Map<string, GenericPlan["media"][number]>();
  const unresolved = new Set<string>(), warnings: GenericPlan["report"]["sourceWarnings"] = [], paths = new Set<string>();
  let bytes = 0;
  const accepted = pages.map(page => {
    const url = assertPublicHttpUrl(page.url);
    if (url.href.length > 2_048) throw new Error("A source page URL exceeds its 2,048-character limit.");
    if (url.origin !== site.origin) throw new Error("A generic import page is outside the approved source origin.");
    if (robotsDisallow(robotsTxt, `${url.pathname}${url.search}`)) throw new Error("The source robots policy blocks this page.");
    if (paths.has(url.href)) throw new Error("The source repeated a page identity.");
    paths.add(url.href); bytes += Buffer.byteLength(page.body);
    enforceImporterLimits({ pages: paths.size, bytes, depth: 1 });
    const parsed = parseGenericHtml(page.body, page.url);
    const body = page.seo ? page.body : parsed.body;
    const nodes = elements(parse(body));
    for (const node of nodes) {
      const value = attr(node, node.tagName === "a" ? "href" : node.tagName === "object" ? "data" : "src");
      if (!value || !(node.tagName === "img" || ["video", "audio", "source", "embed", "object"].includes(node.tagName) || node.tagName === "a" && /\.(?:pdf|mp[34]|webm|wav|ogg|m4a)(?:[?#]|$)/i.test(value))) continue;
      let target: URL;
      try { target = assertPublicHttpUrl(new URL(value, url).href); } catch { unresolved.add(value.slice(0, 2_048)); continue; }
      target.hash = "";
      if (target.href.length > 2_048 || target.origin !== site.origin || robotsDisallow(robotsTxt, `${target.pathname}${target.search}`)) { unresolved.add(target.href.slice(0, 2_048)); continue; }
      const key = target.href;
      let filename = target.pathname.split("/").at(-1) || "source-file";
      try { filename = decodeURIComponent(filename); } catch { /* Keep literal invalid escapes. */ }
      filename = filename.replace(/[\x00-\x1f\\/]/g, "-").slice(0, 255);
      media.set(key, { key, sourceUrl: target.href, filename, aliases: [key], referenced: true, altText: attr(node, "alt")?.slice(0, 500) });
      if (media.size > 500) throw new Error("This source exceeds the current 500-file media batch.");
    }
    if (warnings.length < 100 && url.search) warnings.push({ code: "query-address", url: url.href });
    if (warnings.length < 100 && page.provenance.source === "sitemap") warnings.push({ code: "discovery-only", url: url.href });
    const sourcePath = url.pathname.replace(/^\/+|\/+$/g, "");
    const slug = toCmsSlug(sourcePath.replace(/(?:^|\/)index\.html?$/i, "").replace(/\.html?$/i, ""));
    return { ...page, body, slug, seo: page.seo ?? { ...parsed.seo, title: page.title, preserveTitle: true }, ...(sourcePath !== slug ? { redirectFrom: sourcePath } : {}) };
  });
  const plan = genericPlanSchema.parse({ version: 1, site: { url: site.origin, hosts: [site.host.toLowerCase()], basePath: "" }, robotsTxt, media: [...media.values()], report: { unresolvedMedia: [...unresolved].slice(0, 100), sourceWarnings: warnings } });
  return { preview: { sourceFormat: "generic-site", pages: accepted, generic: plan }, counts: { pages: accepted.length, media: media.size, redirects: accepted.filter(page => page.redirectFrom).length, mediaWarnings: unresolved.size, sourceWarnings: warnings.length } };
}

export function genericPreview(preview: unknown): GenericPlan | null {
  if (!preview || typeof preview !== "object" || (preview as Record<string, unknown>).sourceFormat !== "generic-site") return null;
  return genericPlanSchema.parse((preview as Record<string, unknown>).generic);
}
