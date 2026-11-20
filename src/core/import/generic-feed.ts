// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C3.22: real RSS/Atom content, dates and enclosures, without WordPress records.
import { XMLBuilder, XMLParser, XMLValidator } from "fast-xml-parser";
import { parseFragment, type DefaultTreeAdapterTypes } from "parse5";
import { assertPublicHttpUrl, DEFAULT_IMPORTER_LIMITS, enforceImporterLimits } from "./contract";
import { parseGenericHtml, type GenericPage } from "./generic-plan";

type XmlNode = Record<string, unknown>;
const object = (value: unknown): XmlNode => value && typeof value === "object" && !Array.isArray(value) ? value as XmlNode : {};
const tag = (node: XmlNode) => Object.keys(node).find(key => ![":@", "#text", "#comment"].includes(key));
const local = (node: XmlNode) => tag(node)?.split(":").at(-1)?.toLowerCase();
const nested = (node: XmlNode): XmlNode[] => { const name = tag(node); return name && Array.isArray(node[name]) ? node[name] as XmlNode[] : []; };
const matching = (nodes: XmlNode[], name: string) => nodes.filter(node => local(node) === name.toLowerCase());
const first = (nodes: XmlNode[], name: string) => matching(nodes, name)[0];
const attr = (node: XmlNode | undefined, name: string) => { const value = object(node?.[":@"]) [name]; return typeof value === "string" ? value : undefined; };
function xmlText(node: XmlNode | undefined): string {
  if (!node) return "";
  const pieces: string[] = [], pending = [node];
  while (pending.length) {
    const current = pending.pop()!;
    if (typeof current["#text"] === "string") pieces.push(current["#text"]);
    const children = nested(current);
    for (let index = children.length - 1; index >= 0; index--) pending.push(children[index]!);
  }
  return pieces.join("").trim();
}
function titleText(raw: string): string {
  const pieces: string[] = [], pending: DefaultTreeAdapterTypes.Node[] = [parseFragment(raw)];
  while (pending.length) {
    const node = pending.pop()!;
    if (node.nodeName === "#text") pieces.push((node as DefaultTreeAdapterTypes.TextNode).value);
    else if (!("tagName" in node) || !["script", "style"].includes(node.tagName)) {
      const children = "childNodes" in node ? node.childNodes : [];
      for (let index = children.length - 1; index >= 0; index--) pending.push(children[index]!);
    }
  }
  return pieces.join("").trim();
}
const builder = new XMLBuilder({ preserveOrder: true, ignoreAttributes: false, attributeNamePrefix: "", processEntities: true });
function html(node: XmlNode | undefined): string {
  if (!node) return "";
  const children = nested(node);
  return children.some(child => tag(child)) ? builder.build(children) : xmlText(node);
}
const escape = (value: string) => value.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
function baseFor(node: XmlNode | undefined, parent: string): string {
  const value = attr(node, "xml:base");
  if (!value) return parent;
  const base = assertPublicHttpUrl(new URL(value, parent).href);
  if (base.origin !== new URL(parent).origin) throw new Error("A feed base is outside its approved source origin.");
  return base.href;
}

function originalFeed(payload: string, origin: string) {
  if (Buffer.byteLength(payload) > DEFAULT_IMPORTER_LIMITS.maxBytes) throw new Error("This feed exceeds its 20 MB source limit.");
  if (/<!DOCTYPE|<!ENTITY/i.test(payload) || XMLValidator.validate(payload) !== true) throw new Error("The source is not safe, well-formed RSS or Atom XML.");
  const parsed: unknown = new XMLParser({ preserveOrder: true, ignoreAttributes: false, attributeNamePrefix: "", trimValues: false, parseTagValue: false, ignoreDeclaration: true, ignorePiTags: true, processEntities: { maxTotalExpansions: 100_000, maxExpandedLength: DEFAULT_IMPORTER_LIMITS.maxBytes, maxEntitySize: 1_000 } }).parse(payload);
  if (!Array.isArray(parsed)) throw new Error("The feed has no XML document.");
  const document = parsed as XmlNode[];
  const pending = document.map(node => ({ node, depth: 0 })); let count = 0;
  while (pending.length) {
    const { node, depth } = pending.pop()!;
    if (++count > 100_000 || depth > 200) throw new Error("This feed exceeds its element or nesting limit.");
    for (const child of nested(node)) pending.push({ node: child, depth: depth + 1 });
  }
  const atom = first(document, "feed");
  const channel = atom ? undefined : first(nested(first(document, "rss") ?? {}), "channel");
  if (!atom && !channel) throw new Error("The source has no RSS channel or Atom feed.");
  const entries = matching(nested(atom ?? channel!), atom ? "entry" : "item");
  const feedBase = baseFor(atom ?? channel, origin);
  return { atom, entries, feedBase };
}

export function parseGenericFeed(payload: string, origin: string): GenericPage[] {
  const { atom, entries, feedBase } = originalFeed(payload, origin);
  const result: GenericPage[] = []; let bytes = 0;
  for (const entry of entries) {
    const fields = nested(entry);
    const entryBase = baseFor(entry, feedBase);
    const link = atom ? matching(fields, "link").find(node => !attr(node, "rel") || attr(node, "rel") === "alternate") : first(fields, "link");
    const guid = first(fields, atom ? "id" : "guid");
    const href = atom ? attr(link, "href") || xmlText(guid) : xmlText(link) || (attr(guid, "isPermaLink") !== "false" ? xmlText(guid) : "");
    if (!href) throw new Error("A feed entry has no public permalink.");
    const url = assertPublicHttpUrl(new URL(href, entryBase).href);
    const content = [first(fields, "encoded"), ...matching(fields, "content").filter(node => !attr(node, "url")), first(fields, "description"), first(fields, "summary")].find(node => html(node));
    let body = html(content);
    for (const enclosure of fields.filter(node => ["enclosure", "content", "thumbnail"].includes(local(node) ?? "") && attr(node, "url"))) {
      const target = assertPublicHttpUrl(new URL(attr(enclosure, "url")!, entryBase).href), type = attr(enclosure, "type") ?? "";
      const source = escape(target.href);
      if (type.startsWith("image/") || /\.(?:png|jpe?g|gif|webp|avif)(?:[?#]|$)/i.test(target.href)) body += `<img src="${source}" alt="">`;
      else if (type.startsWith("audio/")) body += `<audio src="${source}"></audio>`;
      else if (type.startsWith("video/")) body += `<video src="${source}"></video>`;
      else body += `<a href="${source}">${escape(attr(enclosure, "title") ?? target.pathname.split("/").at(-1) ?? "")}</a>`;
    }
    bytes += Buffer.byteLength(body);
    enforceImporterLimits({ pages: result.length + 1, bytes, depth: 1 });
    const declaredBase = atom || feedBase !== origin || entryBase !== feedBase || attr(content, "xml:base");
    const page = parseGenericHtml(`${declaredBase ? `<base href="${escape(baseFor(content, entryBase))}">` : ""}${body}`, url.href), title = titleText(xmlText(first(fields, "title"))) || page.title;
    const date = xmlText(first(fields, atom ? "published" : "pubdate")) || xmlText(first(fields, "updated"));
    const publication = date ? Date.parse(date) : NaN;
    result.push({ ...page, title, kind: "post", seo: { ...page.seo, title, preserveTitle: true }, provenance: { url: url.href, source: atom ? "atom" : "rss" }, ...(Number.isFinite(publication) ? { publishedAt: new Date(publication).toISOString(), status: publication > Date.now() ? "draft" as const : "publish" as const } : {}) });
  }
  return result;
}

/** Durable discovery records actual permalinks and publication metadata only.
 * It never parses a feed excerpt as the later original rendered page body.
 * The ordinary synchronous parser keeps its existing500-entry limit above.
 */
export function parseGenericFeedLinks(payload: string, origin: string): Array<{ url: string; title: string; publishedAt?: string; status?: "draft" | "publish" }> {
  const { atom, entries, feedBase } = originalFeed(payload, origin);
  if (entries.length > 10_000) throw new Error("The complete feed exceeds its 10,000-entry frontier budget.");
  return entries.map(entry => {
    const fields = nested(entry), entryBase = baseFor(entry, feedBase);
    const link = atom ? matching(fields, "link").find(node => !attr(node, "rel") || attr(node, "rel") === "alternate") : first(fields, "link");
    const guid = first(fields, atom ? "id" : "guid");
    const href = atom ? attr(link, "href") || xmlText(guid) : xmlText(link) || (attr(guid, "isPermaLink") !== "false" ? xmlText(guid) : "");
    if (!href) throw new Error("A feed entry has no original public permalink.");
    const url = assertPublicHttpUrl(new URL(href, entryBase).href), title = titleText(xmlText(first(fields, "title"))) || url.pathname;
    const date = xmlText(first(fields, atom ? "published" : "pubdate")) || xmlText(first(fields, "updated")), publication = date ? Date.parse(date) : NaN;
    return { url: url.href, title, ...(Number.isFinite(publication) ? { publishedAt: new Date(publication).toISOString(), status: publication > Date.now() ? "draft" as const : "publish" as const } : {}) };
  });
}
