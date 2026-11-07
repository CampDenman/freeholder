// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// WordPress export reading, URL planning and body conversion (C3.22).
//
// Everything here is pure: no database, no network. `service.ts` owns the
// staged run, the downloads and the writes; this file decides what a
// WordPress export *means* in Freeholder terms, so it can be tested against a
// fixture without either.
//
// What a WordPress export maps onto, and where it honestly cannot:
//
// - Posts become CMS pages under `blog/`, the prefix the blog listing reads,
//   and keep their publication date. Pages keep their WordPress path.
// - Attachments become media-library files; image URLs in a body become
//   image blocks pointing at them.
// - Old permalinks that changed become `Redirect` rows.
// - Yoast / Rank Math titles and descriptions become page SEO fields.
// - Menus become links on the site's nav section, at publish.
// - Categories, tags and authors have no CMS home yet (a page has no author
//   and the blog has no taxonomy), so they are recorded on the import run.
// - Reader comments have no public home on CMS pages, so they are counted
//   and left behind rather than invented a place for.
import {
  parseFragment,
  serializeOuter,
  type DefaultTreeAdapterTypes,
} from "parse5";
import { z } from "zod";
import { sanitizeOwnerHtml } from "@/modules/cms/blocks/html";
import {
  richBlockSchema,
  safeRichHref,
  type RichBlock,
  type RichInline,
  type RichMark,
  type RichTextSpan,
} from "@/modules/cms/blocks/rich";
import type { BlockNode } from "@/modules/cms/blocks/types";
import {
  budgetMessage,
  PAGE_BLOCK_BUDGET,
  PAGE_HTML_CHARS_BUDGET,
  PAGE_IMAGE_BUDGET,
} from "@/modules/cms/budgets";
import { DEFAULT_IMPORTER_LIMITS, enforceImporterLimits } from "./contract";

/* ------------------------------------------------------------------ limits */

/**
 * Media limits for one run. A file is fetched through the proxied upload
 * path, whose ceiling is 25 MB; larger files are reported, not fetched.
 */
export const WORDPRESS_MEDIA_LIMITS = {
  maxFiles: 500,
  maxBytesPerFile: 25 * 1024 * 1024,
  timeoutMs: 30_000,
} as const;

/** CMS field limits the importer has to fit (cms.createPage `seo`). */
const SEO_TITLE_MAX = 1000;
const SEO_DESCRIPTION_MAX = 1000;
const HTML_BLOCK_MAX = 20_000;
const RICH_BLOCKS_PER_TEXT = 200;
const GALLERY_MAX = 24;

/* ------------------------------------------------------------------- types */

export type WordpressStatus = "publish" | "draft";

export type WordpressTerm = { slug: string; name: string; parentSlug?: string; description?: string };
export type WordpressComment = { id: string; parentId?: string; name: string; email: string | null; body: string; status: "pending" | "approved" | "spam" | "trash"; createdAt?: string };

export type WordpressSeo = { title?: string; description?: string; preserveTitle?: boolean; preserveDescription?: boolean; noindex?: boolean; nofollow?: boolean; canonical?: string; ogTitle?: string; ogDescription?: string; ogImage?: string };

export type WordpressItem = {
  wpId?: string;
  url: string;
  slug: string;
  title: string;
  kind: "page" | "post";
  body: string;
  status: WordpressStatus;
  /** The raw WordPress status, for the report ("private", "future", ...). */
  wpStatus: string;
  publishedAt?: string;
  modifiedAt?: string;
  author?: string;
  categories: WordpressTerm[];
  tags: WordpressTerm[];
  seo: WordpressSeo;
  featuredWpId?: string;
  /** For REST exports with `_embed`, the featured image's URL directly. */
  featuredUrl?: string;
  passwordProtected: boolean;
  comments: { total: number; approved: number; entries?: WordpressComment[] };
};

export type WordpressAttachment = {
  url?: string;
  wpId?: string;
  sourceUrl: string;
  title?: string;
  altText?: string;
  caption?: string;
  parentWpId?: string;
};

export type WordpressMenuItem = {
  wpId: string;
  menu: string;
  label: string;
  order: number;
  type: string;
  object: string;
  objectId?: string;
  url?: string;
  parentItemId?: string;
};

export type WordpressAuthor = { login: string; displayName?: string; email?: string };

export type WordpressExport = {
  site: { title: string; url: string; baseUrl?: string };
  items: WordpressItem[];
  attachments: WordpressAttachment[];
  authors: WordpressAuthor[];
  taxonomy?: { categories: WordpressTerm[]; tags: WordpressTerm[] };
  menus: { slug: string; name: string }[];
  menuItems: WordpressMenuItem[];
  /** Items left out on purpose, by reason ("post type: product", "status: trash"). */
  skipped: Record<string, number>;
};

/** One staged page or post, as stored in the run preview. */
export type PlannedPage = {
  url: string;
  slug: string;
  title: string;
  body: string;
  kind: "page" | "post";
  status: WordpressStatus;
  wpStatus: string;
  publishedAt?: string;
  modifiedAt?: string;
  /** The old WordPress path, when it differs from the new slug. */
  redirectFrom?: string;
  seo: WordpressSeo;
  author?: string;
  categories: string[];
  tags: string[];
  categorySlugs?: string[];
  tagSlugs?: string[];
  featuredMedia?: string;
  wpId?: string;
  comments: number;
  readerComments?: WordpressComment[];
};

export type PlannedMedia = {
  /** Stable key: the normalized source URL. */
  key: string;
  sourceUrl: string;
  filename: string;
  altText?: string;
  caption?: string;
  wpId?: string;
  /** Normalized URL spellings a body may use for this file (sizes, -scaled). */
  aliases: string[];
  referenced: boolean;
};

export type PlannedMenu = {
  slug: string;
  name: string;
  items: Array<{
    label: string;
    depth: number;
    /** Exactly one of these resolves the link at commit. */
    targetWpId?: string;
    href?: string;
    note?: string;
  }>;
};

export type WordpressPlan = {
  site: { title: string; url: string; hosts: string[]; basePath: string };
  pages: PlannedPage[];
  media: PlannedMedia[];
  menus: PlannedMenu[];
  authors: Array<WordpressAuthor & { posts: number }>;
  taxonomy: {
    categories: Array<WordpressTerm & { posts: number }>;
    tags: Array<WordpressTerm & { posts: number }>;
  };
  report: {
    skipped: Record<string, number>;
    externalImages: string[];
    mediaOverLimit: number;
    comments: { total: number; approved: number };
    seoTrimmed: number;
    drafts: number;
  };
};

/* ----------------------------------------------------------- XML reading */

/**
 * A WordPress export is regular, machine-written XML, but its bodies are
 * arbitrary HTML inside CDATA. Masking CDATA first means a post that contains
 * the text `</item>` or `<title>` cannot change the structure we read.
 */
type Masked = { text: string; cdata: string[] };

/** XML comments out, by scanning rather than a single regex pass. */
function withoutXmlComments(text: string): string {
  let out = "";
  let at = 0;
  for (;;) {
    const open = text.indexOf("<!--", at);
    if (open === -1) return out + text.slice(at);
    out += text.slice(at, open);
    const close = text.indexOf("-->", open + 4);
    if (close === -1) return out;
    at = close + 3;
  }
}

function maskCdata(xml: string): Masked {
  const cdata: string[] = [];
  const masked = xml.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, (_match, inner: string) => {
    cdata.push(inner);
    return `\u0000${cdata.length - 1}\u0000`;
  });
  return { text: withoutXmlComments(masked), cdata };
}

function decodeXml(value: string): string {
  return value.replace(/&(#x[0-9a-f]+|#\d+|lt|gt|amp|quot|apos);/gi, (match, entity: string) => {
    const lower = entity.toLowerCase();
    if (lower === "lt") return "<";
    if (lower === "gt") return ">";
    if (lower === "amp") return "&";
    if (lower === "quot") return '"';
    if (lower === "apos") return "'";
    const code = lower.startsWith("#x") ? parseInt(lower.slice(2), 16) : parseInt(lower.slice(1), 10);
    return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match;
  });
}

/**
 * `raw` keeps the text exactly as written (CDATA as-is, entities intact) for
 * fields that are HTML and will be parsed as HTML. `xml` decodes XML entities
 * for fields that are plain values: URLs, slugs, names.
 */
function unmask(value: string, masked: Masked, mode: "raw" | "xml"): string {
  return value
    .split(/\u0000(\d+)\u0000/)
    .map((part, index) => (index % 2 === 1 ? (masked.cdata[Number(part)] ?? "") : mode === "xml" ? decodeXml(part) : part))
    .join("")
    .trim();
}

function escapeTag(tag: string): string {
  return tag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function elements(xml: string, tag: string): Array<{ attrs: string; inner: string }> {
  const name = escapeTag(tag);
  const pattern = new RegExp(`<${name}(\\s[^>]*)?(?:/>|>([\\s\\S]*?)</${name}>)`, "gi");
  return [...xml.matchAll(pattern)].map((match) => ({ attrs: match[1] ?? "", inner: match[2] ?? "" }));
}

function child(xml: string, tag: string, masked: Masked, mode: "raw" | "xml" = "xml"): string {
  const found = elements(xml, tag)[0];
  return found ? unmask(found.inner, masked, mode) : "";
}

function attr(attrs: string, name: string): string {
  const match = new RegExp(`\\s${escapeTag(name)}\\s*=\\s*("([^"]*)"|'([^']*)')`, "i").exec(attrs);
  return decodeXml(match?.[2] ?? match?.[3] ?? "");
}

/** HTML text, decoded once with the browser's rules. */
function htmlText(value: string): string {
  return textContentOf(parseFragment(value)).replace(/\s+/g, " ").trim();
}

function wordpressDate(value: string): string | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(value.trim());
  if (!match || match[1] === "0000") return undefined;
  const date = new Date(`${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:${match[6]}Z`);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function rfcDate(value: string): string | undefined {
  if (!value.trim()) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function safeDecodeUri(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function bump(record: Record<string, number>, key: string, by = 1): void {
  record[key] = (record[key] ?? 0) + by;
}

const SKIPPED_STATUSES = new Set(["trash", "auto-draft", "inherit"]);

function itemStatus(wpStatus: string): WordpressStatus {
  return wpStatus === "publish" || wpStatus === "" ? "publish" : "draft";
}

/** Yoast writes `%%title%%`, Rank Math `%title%`; both mean the same few things. */
function expandSeoTemplate(value: string, title: string, siteTitle: string): string {
  return value
    .replace(/%%?title%%?/g, title)
    .replace(/%%?sitename%%?/g, siteTitle)
    .replace(/%%?sep%%?/g, "–")
    .replace(/%%?[a-z_]+%%?/gi, "")
    .replace(/\s+/g, " ")
    .replace(/^[\s–|-]+|[\s–|-]+$/g, "")
    .trim();
}

/** The largest single `<item>` the streaming reader will hold (a post plus its comments). */
export const WXR_ITEM_MAX_CHARS = 32 * 1024 * 1024;
/** The channel header (site, authors, terms) before the first item. */
export const WXR_HEAD_MAX_CHARS = 32 * 1024 * 1024;

/**
 * Splits a WXR stream into its channel header and one `<item>` at a time,
 * so a large export is read with memory bounded by its largest item rather
 * than its size. CDATA sections and comments are skipped while looking for
 * `<item` and `</item>`, so a post that quotes them cannot cut an item short,
 * and a marker split across two chunks is found once the next chunk arrives.
 */
export class WxrStreamReader {
  private buffer = "";
  private scanFrom = 0;
  private itemStart = -1;
  private headDone = false;
  private head = "";

  constructor(
    private readonly onHead: (xml: string) => void,
    private readonly onItem: (xml: string) => void,
  ) {}

  push(chunk: string): void {
    this.buffer += chunk;
    for (;;) {
      if (this.itemStart < 0) {
        const open = this.find("open");
        if (open === null) {
          if (!this.headDone && this.buffer.length > WXR_HEAD_MAX_CHARS) {
            throw new Error("This export's header is too large to read.");
          }
          // Between items nothing is kept but an unfinished marker.
          if (this.headDone) this.discardBefore(this.scanFrom);
          return;
        }
        if (!this.headDone) {
          this.head = this.buffer.slice(0, open);
          this.headDone = true;
          this.onHead(this.head);
        }
        this.discardBefore(open);
        this.itemStart = 0;
        this.scanFrom = 5;
      }
      const close = this.find("close");
      if (close === null) {
        if (this.buffer.length > WXR_ITEM_MAX_CHARS) {
          throw new Error("One item in this export is too large to read.");
        }
        return;
      }
      this.onItem(this.buffer.slice(0, close));
      this.discardBefore(close);
      this.itemStart = -1;
      this.scanFrom = 0;
    }
  }

  /** Call once the stream has ended. */
  end(): void {
    if (this.itemStart >= 0) throw new Error("This export ends in the middle of an item.");
    if (!this.headDone) {
      this.head = this.buffer;
      this.headDone = true;
      this.onHead(this.head);
    }
    this.buffer = "";
  }

  private discardBefore(index: number): void {
    this.buffer = this.buffer.slice(index);
    this.scanFrom = Math.max(0, this.scanFrom - index);
  }

  /**
   * Where the next `<item` starts (or just past the next `</item>`), outside
   * CDATA and comments; null when more input is needed to know. One forward
   * scan to the nearest marker per step, so the whole stream is read once.
   */
  private find(target: "open" | "close"): number | null {
    const pattern = target === "open" ? /<!\[CDATA\[|<!--|<item[\s>/]/g : /<!\[CDATA\[|<!--|<\/item\s*>/g;
    let at = this.scanFrom;
    for (;;) {
      pattern.lastIndex = at;
      const match = pattern.exec(this.buffer);
      if (!match) {
        // Keep enough tail that a marker split across chunks is seen whole.
        this.scanFrom = Math.max(at, this.buffer.length - 16);
        return null;
      }
      const token = match[0];
      if (token === "<![CDATA[" || token === "<!--") {
        const terminator = token === "<!--" ? "-->" : "]]>";
        const ends = this.buffer.indexOf(terminator, match.index + token.length);
        if (ends < 0) {
          this.scanFrom = match.index;
          return null;
        }
        at = ends + terminator.length;
        this.scanFrom = at;
        continue;
      }
      return target === "open" ? match.index : match.index + token.length;
    }
  }
}

/**
 * Builds a `WordpressExport` from a channel header and then one item at a
 * time. The whole-string reader and the streaming upload share it.
 */
export function wordpressExportBuilder() {
  let siteTitle = "";
  let site: WordpressExport["site"] = { title: "", url: "" };
  let authors: WordpressAuthor[] = [];
  let taxonomy: NonNullable<WordpressExport["taxonomy"]> = { categories: [], tags: [] };
  let menus: WordpressExport["menus"] = [];
  const items: WordpressItem[] = [];
  const attachments: WordpressAttachment[] = [];
  const menuItems: WordpressMenuItem[] = [];
  const skipped: Record<string, number> = {};
  let bytes = 0;

  const head = (xml: string): void => {
    const masked = maskCdata(xml);
    const text = masked.text;
    siteTitle = htmlText(child(text, "title", masked, "raw"));
    site = {
      title: siteTitle,
      url: child(text, "link", masked) || child(text, "wp:base_blog_url", masked),
      baseUrl: child(text, "wp:base_blog_url", masked) || child(text, "wp:base_site_url", masked) || undefined,
    };
    authors = elements(text, "wp:author").map(({ inner }) => ({
      login: child(inner, "wp:author_login", masked),
      displayName: htmlText(child(inner, "wp:author_display_name", masked, "raw")) || undefined,
      email: child(inner, "wp:author_email", masked) || undefined,
    })).filter((author) => author.login);
    taxonomy = {
      categories: elements(text, "wp:category").map(({ inner }) => ({
        slug: child(inner, "wp:category_nicename", masked),
        name: htmlText(child(inner, "wp:cat_name", masked, "raw")),
        parentSlug: child(inner, "wp:category_parent", masked) || undefined,
        description: htmlText(child(inner, "wp:category_description", masked, "raw")) || undefined,
      })).filter(term => term.slug),
      tags: elements(text, "wp:tag").map(({ inner }) => ({
        slug: child(inner, "wp:tag_slug", masked), name: htmlText(child(inner, "wp:tag_name", masked, "raw")),
        description: htmlText(child(inner, "wp:tag_description", masked, "raw")) || undefined,
      })).filter(term => term.slug),
    };
    menus = elements(text, "wp:term")
      .filter(({ inner }) => child(inner, "wp:term_taxonomy", masked) === "nav_menu")
      .map(({ inner }) => ({
        slug: child(inner, "wp:term_slug", masked),
        name: htmlText(child(inner, "wp:term_name", masked, "raw")),
      }))
      .filter((menu) => menu.slug);
  };

  const item = (xml: string): void => {
    const masked = maskCdata(xml);
    const raw = masked.text;
    const comments = elements(raw, "wp:comment");
    const fields = raw.replace(/<wp:comment(\s[^>]*)?>[\s\S]*?<\/wp:comment>/gi, "");
    const type = child(fields, "wp:post_type", masked) || child(fields, "post_type", masked);
    const wpId = child(fields, "wp:post_id", masked) || undefined;
    const wpStatus = child(fields, "wp:status", masked);
    const meta = new Map<string, string>();
    for (const { inner } of elements(fields, "wp:postmeta")) {
      meta.set(child(inner, "wp:meta_key", masked), child(inner, "wp:meta_value", masked, "raw"));
    }
    const terms = elements(fields, "category").map(({ attrs, inner }) => ({
      domain: attr(attrs, "domain"),
      slug: attr(attrs, "nicename"),
      name: htmlText(unmask(inner, masked, "raw")),
    }));
    const title = htmlText(child(fields, "title", masked, "raw"));

    if (type === "attachment") {
      const sourceUrl = child(fields, "wp:attachment_url", masked) || child(fields, "guid", masked);
      if (!sourceUrl) return;
      attachments.push({
        wpId, url: child(fields, "link", masked) || undefined,
        sourceUrl,
        title: title || undefined,
        altText: htmlText(meta.get("_wp_attachment_image_alt") ?? "") || undefined,
        caption: htmlText(child(fields, "excerpt:encoded", masked, "raw")) || undefined,
        parentWpId: child(fields, "wp:post_parent", masked) || undefined,
      });
      return;
    }
    if (type === "nav_menu_item") {
      const menu = terms.find((term) => term.domain === "nav_menu");
      if (!menu || !wpId) return;
      menuItems.push({
        wpId,
        menu: menu.slug,
        label: title,
        order: Number(child(fields, "wp:menu_order", masked)) || 0,
        type: meta.get("_menu_item_type") ?? "",
        object: meta.get("_menu_item_object") ?? "",
        objectId: meta.get("_menu_item_object_id") || undefined,
        url: decodeXml(meta.get("_menu_item_url") ?? "") || undefined,
        parentItemId: meta.get("_menu_item_menu_item_parent") || undefined,
      });
      return;
    }
    if (type && type !== "post" && type !== "page") {
      bump(skipped, `post type: ${type}`);
      return;
    }
    if (SKIPPED_STATUSES.has(wpStatus)) {
      bump(skipped, `status: ${wpStatus}`);
      return;
    }
    const url = child(fields, "link", masked) || child(fields, "guid", masked);
    const body = child(fields, "content:encoded", masked, "raw") || child(fields, "description", masked, "raw");
    bytes += body.length;
    enforceImporterLimits({ pages: items.length + 1, bytes, depth: 1 });
    const seoTitle = meta.get("_yoast_wpseo_title") || meta.get("rank_math_title") || "";
    const seoDescription = meta.get("_yoast_wpseo_metadesc") || meta.get("rank_math_description") || "";
    items.push({
      wpId,
      url,
      slug: safeDecodeUri(child(fields, "wp:post_name", masked)) || slugFromUrl(url),
      title: title || "Untitled",
      kind: type === "post" ? "post" : "page",
      body,
      status: itemStatus(wpStatus),
      wpStatus: wpStatus || "publish",
      publishedAt:
        wordpressDate(child(fields, "wp:post_date_gmt", masked)) ??
        rfcDate(child(fields, "pubDate", masked)) ??
        wordpressDate(child(fields, "wp:post_date", masked)),
      modifiedAt: wordpressDate(child(fields, "wp:post_modified_gmt", masked)) ?? wordpressDate(child(fields, "wp:post_modified", masked)),
      author: child(fields, "dc:creator", masked) || undefined,
      categories: terms.filter((term) => term.domain === "category").map(({ slug, name }) => ({ slug, name })),
      tags: terms.filter((term) => term.domain === "post_tag").map(({ slug, name }) => ({ slug, name })),
      seo: {
        title: expandSeoTemplate(htmlText(seoTitle), title, siteTitle) || undefined,
        description: expandSeoTemplate(htmlText(seoDescription), title, siteTitle) || undefined,
        noindex: meta.get("_yoast_wpseo_meta-robots-noindex") === "1" || /noindex/.test(meta.get("rank_math_robots") ?? ""),
        nofollow: meta.get("_yoast_wpseo_meta-robots-nofollow") === "1" || /nofollow/.test(meta.get("rank_math_robots") ?? ""),
        canonical: meta.get("_yoast_wpseo_canonical") || meta.get("rank_math_canonical_url") || undefined,
        ogTitle: htmlText(meta.get("_yoast_wpseo_opengraph-title") || meta.get("rank_math_facebook_title") || "") || undefined,
        ogDescription: htmlText(meta.get("_yoast_wpseo_opengraph-description") || meta.get("rank_math_facebook_description") || "") || undefined,
        ogImage: meta.get("_yoast_wpseo_opengraph-image") || meta.get("rank_math_facebook_image") || undefined,
      },
      featuredWpId: meta.get("_thumbnail_id") || undefined,
      passwordProtected: child(fields, "wp:post_password", masked) !== "",
      comments: {
        total: comments.length,
        approved: comments.filter(({ inner }) => child(inner, "wp:comment_approved", masked) === "1").length,
        entries: comments.filter(({ inner }) => !child(inner, "wp:comment_type", masked) || child(inner, "wp:comment_type", masked) === "comment").map(({ inner }, index) => {
          const status = child(inner, "wp:comment_approved", masked);
          const email = z.string().email().safeParse(child(inner, "wp:comment_author_email", masked));
          return {
            id: child(inner, "wp:comment_id", masked) || `${wpId ?? items.length}-${index}`,
            parentId: child(inner, "wp:comment_parent", masked) !== "0" ? child(inner, "wp:comment_parent", masked) || undefined : undefined,
            name: htmlText(child(inner, "wp:comment_author", masked, "raw")) || "Reader",
            email: email.success ? email.data.toLowerCase() : null,
            body: htmlText(child(inner, "wp:comment_content", masked, "raw")),
            status: status === "1" ? "approved" as const : status === "spam" ? "spam" as const : status === "trash" ? "trash" as const : "pending" as const,
            createdAt: wordpressDate(child(inner, "wp:comment_date_gmt", masked)) ?? wordpressDate(child(inner, "wp:comment_date", masked)),
          };
        }).filter(comment => comment.body),
      },
    });
  };

  return {
    reader: () => new WxrStreamReader(head, item),
    finish: (): WordpressExport => ({ site, items, attachments, authors, taxonomy, menus, menuItems, skipped }),
  };
}

/**
 * Read a WordPress eXtended RSS (WXR) export: Tools → Export in wp-admin.
 * Unknown post types and throwaway statuses are counted in `skipped` rather
 * than silently dropped. Large uploads stream through the same reader.
 */
export function parseWordpressExport(xml: string): WordpressExport {
  const builder = wordpressExportBuilder();
  const reader = builder.reader();
  reader.push(xml);
  reader.end();
  return builder.finish();
}

/**
 * The same shape from the WordPress REST API (`/wp-json/wp/v2/posts` and
 * `/pages`). With `?_embed` the response also names featured images, terms
 * and authors; without it those are simply absent.
 */
export function wordpressExportFromRest(payload: unknown, origin: string): WordpressExport {
  if (!Array.isArray(payload)) {
    throw new Error("WordPress REST expected an array of posts or pages.");
  }
  const items: WordpressItem[] = [];
  const skipped: Record<string, number> = {};
  const authors = new Map<string, WordpressAuthor>();
  let bytes = 0;
  for (const entry of payload) {
    if (!entry || typeof entry !== "object") continue;
    const row = entry as {
      id?: number;
      link?: string;
      slug?: string;
      type?: string;
      status?: string;
      date_gmt?: string;
      title?: { rendered?: string };
      content?: { rendered?: string };
      yoast_head_json?: { title?: string; description?: string };
      _embedded?: {
        author?: Array<{ slug?: string; name?: string }>;
        "wp:featuredmedia"?: Array<{ source_url?: string }>;
        "wp:term"?: Array<Array<{ taxonomy?: string; slug?: string; name?: string }>>;
      };
    };
    const type = row.type ?? "page";
    if (type !== "post" && type !== "page") {
      bump(skipped, `post type: ${type}`);
      continue;
    }
    const wpStatus = row.status ?? "publish";
    if (SKIPPED_STATUSES.has(wpStatus)) {
      bump(skipped, `status: ${wpStatus}`);
      continue;
    }
    const url = row.link ?? `${origin}/${row.slug ?? "item"}`;
    const body = row.content?.rendered ?? "";
    bytes += body.length;
    enforceImporterLimits({ pages: items.length + 1, bytes, depth: 1 });
    const title = htmlText(row.title?.rendered ?? row.slug ?? "") || "Untitled";
    const embeddedAuthor = row._embedded?.author?.[0];
    if (embeddedAuthor?.slug) {
      authors.set(embeddedAuthor.slug, { login: embeddedAuthor.slug, displayName: embeddedAuthor.name });
    }
    const terms = (row._embedded?.["wp:term"] ?? []).flat();
    items.push({
      wpId: row.id === undefined ? undefined : String(row.id),
      url,
      slug: safeDecodeUri(row.slug ?? "") || slugFromUrl(url),
      title,
      kind: type === "post" ? "post" : "page",
      body,
      status: itemStatus(wpStatus),
      wpStatus,
      publishedAt: row.date_gmt ? wordpressDate(row.date_gmt) : undefined,
      author: embeddedAuthor?.slug,
      categories: terms
        .filter((term) => term.taxonomy === "category" && term.slug)
        .map((term) => ({ slug: term.slug!, name: htmlText(term.name ?? term.slug!) })),
      tags: terms
        .filter((term) => term.taxonomy === "post_tag" && term.slug)
        .map((term) => ({ slug: term.slug!, name: htmlText(term.name ?? term.slug!) })),
      seo: {
        title: htmlText(row.yoast_head_json?.title ?? "") || undefined,
        description: htmlText(row.yoast_head_json?.description ?? "") || undefined,
      },
      featuredUrl: row._embedded?.["wp:featuredmedia"]?.[0]?.source_url,
      passwordProtected: false,
      comments: { total: 0, approved: 0 },
    });
  }
  return {
    site: { title: "", url: origin },
    items,
    attachments: [],
    authors: [...authors.values()],
    menus: [],
    menuItems: [],
    skipped,
  };
}

/* ------------------------------------------------------------ URL planning */

export function slugFromUrl(url: string): string {
  try {
    const parsed = new URL(url);
    const tail = parsed.pathname.replace(/\/+$/, "").split("/").filter(Boolean).at(-1);
    return tail && tail !== "index.html" ? tail : "home";
  } catch {
    return "page";
  }
}

/** The CMS slug rule: lowercase words joined by hyphens or slashes. */
export function toCmsSlug(value: string): string {
  const trimmed = value.trim().replace(/^\/+|\/+$/g, "").toLowerCase();
  if (trimmed === "") return "";
  if (/^[a-z0-9]+(?:[-/][a-z0-9]+)*$/.test(trimmed)) return trimmed;
  const cleaned = trimmed
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .split("/")
    .map((segment) => segment.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, ""))
    .filter(Boolean)
    .join("/");
  return cleaned || "page";
}

function hostVariants(host: string): string[] {
  const lower = host.toLowerCase();
  return lower.startsWith("www.") ? [lower, lower.slice(4)] : [lower, `www.${lower}`];
}

function siteHosts(origin: string, site: WordpressExport["site"]): string[] {
  const hosts = new Set<string>();
  for (const candidate of [origin, site.url, site.baseUrl]) {
    if (!candidate) continue;
    try {
      for (const host of hostVariants(new URL(candidate).host)) hosts.add(host);
    } catch {
      /* A malformed channel link is not a host. */
    }
  }
  return [...hosts];
}

function sitePath(site: WordpressExport["site"], origin: string): string {
  try {
    return new URL(site.baseUrl || site.url || origin).pathname.replace(/^\/+|\/+$/g, "");
  } catch {
    return "";
  }
}

/**
 * The site-relative path of a WordPress URL, or null when the URL is not on
 * the site or has no path of its own (`/?p=12`, `/?page_id=3`).
 */
export function wordpressPath(url: string, hosts: readonly string[], basePath: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url, `https://${hosts[0] ?? "invalid.invalid"}/`);
  } catch {
    return null;
  }
  if (!["http:", "https:"].includes(parsed.protocol)) return null;
  if (!hosts.includes(parsed.host.toLowerCase())) return null;
  if (["p", "page_id", "attachment_id", "cat", "tag"].some((key) => parsed.searchParams.has(key))) return null;
  let path = safeDecodeUri(parsed.pathname).replace(/^\/+|\/+$/g, "");
  if (basePath && (path === basePath || path.startsWith(`${basePath}/`))) {
    path = path.slice(basePath.length).replace(/^\/+/, "");
  }
  return path.replace(/(^|\/)index\.php$/, "").replace(/\/+$/, "");
}

/** Normalized spellings of a media URL: host + path, no query, no size suffix. */
function mediaKey(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (!["http:", "https:"].includes(parsed.protocol)) return null;
    return `${parsed.host.toLowerCase()}${parsed.pathname}`;
  } catch {
    return null;
  }
}

function stripSize(key: string): string {
  return key.replace(/-\d+x\d+(\.[a-z0-9]+)$/i, "$1");
}

function stripScaled(key: string): string {
  return key.replace(/-(?:scaled|rotated)(\.[a-z0-9]+)$/i, "$1");
}

function mediaAliases(url: string): string[] {
  const key = mediaKey(url);
  if (!key) return [];
  return [...new Set([key, stripSize(key), stripScaled(stripSize(key))])];
}

function filenameOf(url: string): string {
  try {
    const segment = safeDecodeUri(new URL(url).pathname.split("/").filter(Boolean).at(-1) ?? "");
    const clean = segment.replace(/[\u0000-\u001f"\\/]/g, "").slice(-200);
    return clean || "wordpress-media";
  } catch {
    return "wordpress-media";
  }
}

function trimTo(value: string | undefined, max: number): { value?: string; trimmed: boolean } {
  if (!value) return { trimmed: false };
  if (value.length <= max) return { value, trimmed: false };
  const cut = value.slice(0, max - 1);
  const space = cut.lastIndexOf(" ");
  return { value: `${(space > max / 2 ? cut.slice(0, space) : cut).trimEnd()}…`, trimmed: true };
}

/** Images a body refers to, with their WordPress attachment id when it says. */
export function bodyImageRefs(body: string): Array<{ src: string; wpId?: string }> {
  const refs: Array<{ src: string; wpId?: string }> = [];
  const walk = (nodes: DefaultTreeAdapterTypes.ChildNode[]) => {
    for (const node of nodes) {
      if (!("tagName" in node)) continue;
      if (node.tagName === "img") {
        const ref = imageRef(node);
        if (ref.src || ref.wpId) refs.push(ref);
      }
      walk(node.childNodes);
    }
  };
  walk(parseFragment(preprocessBody(body)).childNodes);
  return refs;
}

function getAttr(node: DefaultTreeAdapterTypes.Element, name: string): string | undefined {
  return node.attrs.find((entry) => entry.name.toLowerCase() === name)?.value;
}

function imageRef(node: DefaultTreeAdapterTypes.Element): { src: string; wpId?: string; alt?: string } {
  const className = getAttr(node, "class") ?? "";
  const wpId = getAttr(node, "data-fh-wp-id") ?? getAttr(node, "data-id") ?? /\bwp-image-(\d+)\b/.exec(className)?.[1];
  return { src: (getAttr(node, "src") ?? "").trim(), wpId, alt: getAttr(node, "alt")?.trim() };
}

/**
 * Turn an export into a staged plan: final slugs, redirects, the media to
 * fetch, menus and the report. `origin` is the run's approved origin.
 */
export function planWordpressImport(exported: WordpressExport, origin: string): WordpressPlan {
  const hosts = siteHosts(origin, exported.site);
  const basePath = sitePath(exported.site, origin);
  const report: WordpressPlan["report"] = {
    skipped: { ...exported.skipped },
    externalImages: [],
    mediaOverLimit: 0,
    comments: { total: 0, approved: 0 },
    seoTrimmed: 0,
    drafts: 0,
  };

  // Media: every attachment, indexed by each spelling a body might use.
  const media = new Map<string, PlannedMedia>();
  const byAlias = new Map<string, string>();
  const byWpId = new Map<string, string>();
  const addMedia = (sourceUrl: string, extra: Partial<PlannedMedia> = {}): PlannedMedia | undefined => {
    const key = mediaKey(sourceUrl);
    if (!key) return undefined;
    const existing = media.get(key);
    if (existing) return existing;
    const planned: PlannedMedia = {
      key,
      sourceUrl,
      filename: filenameOf(sourceUrl),
      aliases: mediaAliases(sourceUrl),
      referenced: false,
      ...extra,
    };
    media.set(key, planned);
    for (const alias of planned.aliases) if (!byAlias.has(alias)) byAlias.set(alias, key);
    if (planned.wpId) byWpId.set(planned.wpId, key);
    return planned;
  };
  for (const attachment of exported.attachments) {
    addMedia(attachment.sourceUrl, {
      wpId: attachment.wpId,
      altText: attachment.altText?.slice(0, 500),
      caption: attachment.caption,
    });
  }
  const findMedia = (src: string, wpId?: string): PlannedMedia | undefined => {
    if (wpId && byWpId.has(wpId)) return media.get(byWpId.get(wpId)!);
    for (const alias of mediaAliases(src)) {
      const key = byAlias.get(alias);
      if (key) return media.get(key);
    }
    return undefined;
  };

  // Pages and posts: final slugs, unique within the import.
  const used = new Set<string>();
  const unique = (slug: string): string => {
    let candidate = slug;
    for (let n = 2; used.has(candidate); n += 1) candidate = `${slug}-${n}`;
    used.add(candidate);
    return candidate;
  };
  const pages: PlannedPage[] = [];
  const wpIdToSlug = new Map<string, string>();
  const categories = new Map<string, WordpressTerm & { posts: number }>();
  const tags = new Map<string, WordpressTerm & { posts: number }>();
  for (const term of exported.taxonomy?.categories ?? []) categories.set(term.slug, { ...term, posts: 0 });
  for (const term of exported.taxonomy?.tags ?? []) tags.set(term.slug, { ...term, posts: 0 });
  const authorPosts = new Map<string, number>();

  for (const item of exported.items) {
    const oldPath = wordpressPath(item.url, hosts, basePath);
    const wpSlug = toCmsSlug(item.slug || slugFromUrl(item.url));
    const slug = unique(
      oldPath !== null && oldPath !== ""
          ? toCmsSlug(oldPath)
          : item.kind === "post" ? `blog/${(wpSlug.split("/").at(-1) ?? wpSlug) || "post"}` : wpSlug,
    );
    if (item.wpId) wpIdToSlug.set(item.wpId, slug);

    for (const ref of bodyImageRefs(item.body)) {
      const found = findMedia(ref.src, ref.wpId);
      if (found) {
        found.referenced = true;
        continue;
      }
      if (!ref.src) continue;
      let host = "";
      try {
        host = new URL(ref.src, `https://${hosts[0] ?? "invalid.invalid"}/`).host.toLowerCase();
      } catch {
        /* Unparseable sources are external by definition. */
      }
      const absolute = (() => {
        try {
          return new URL(ref.src, `https://${hosts[0] ?? "invalid.invalid"}/`).href;
        } catch {
          return ref.src;
        }
      })();
      if (hosts.includes(host)) {
        const added = addMedia(absolute);
        if (added) added.referenced = true;
      } else if (!report.externalImages.includes(absolute)) {
        report.externalImages.push(absolute);
      }
    }
    let featuredMedia: string | undefined;
    const featured = item.featuredWpId
      ? (byWpId.has(item.featuredWpId) ? media.get(byWpId.get(item.featuredWpId)!) : undefined)
      : item.featuredUrl
        ? (findMedia(item.featuredUrl) ?? addMedia(item.featuredUrl))
        : undefined;
    if (featured) {
      featured.referenced = true;
      featuredMedia = featured.key;
    }

    const title = trimTo(item.seo.title || item.title, SEO_TITLE_MAX);
    const description = trimTo(item.seo.description, SEO_DESCRIPTION_MAX);
    if (title.trimmed || description.trimmed) report.seoTrimmed += 1;
    if (item.status === "draft") report.drafts += 1;
    if (item.passwordProtected) bump(report.skipped, "password protection (imported as draft)");
    report.comments.total += item.comments.total;
    report.comments.approved += item.comments.approved;
    for (const term of item.categories) {
      const entry = categories.get(term.slug) ?? { ...term, posts: 0 };
      entry.posts += 1;
      categories.set(term.slug, entry);
    }
    for (const term of item.tags) {
      const entry = tags.get(term.slug) ?? { ...term, posts: 0 };
      entry.posts += 1;
      tags.set(term.slug, entry);
    }
    if (item.author) authorPosts.set(item.author, (authorPosts.get(item.author) ?? 0) + 1);

    pages.push({
      url: item.url,
      slug,
      title: item.title,
      body: item.body,
      kind: item.kind,
      status: item.passwordProtected ? "draft" : item.status,
      wpStatus: item.wpStatus,
      publishedAt: item.publishedAt,
      modifiedAt: item.modifiedAt,
      redirectFrom: oldPath !== null && oldPath !== "" && oldPath !== slug ? oldPath : undefined,
      seo: { ...item.seo, ...(item.seo.canonical ? { canonical: wordpressPath(item.seo.canonical, hosts, basePath) !== null ? `/${wordpressPath(item.seo.canonical, hosts, basePath)}` : item.seo.canonical } : {}), title: title.value, description: description.value, ...(title.value ? { preserveTitle: true } : {}), ...(description.value ? { preserveDescription: true } : {}) },
      author: item.author,
      categories: item.categories.map((term) => term.name),
      tags: item.tags.map((term) => term.name),
      categorySlugs: item.categories.map((term) => term.slug),
      tagSlugs: item.tags.map((term) => term.slug),
      featuredMedia,
      wpId: item.wpId,
      comments: item.comments.total,
      readerComments: item.comments.entries,
    });
  }

  // Attached-but-unreferenced files still belong to the library; the limit
  // keeps referenced files first so a cap never drops an image a page shows.
  const ordered = [...media.values()].sort((a, b) => Number(b.referenced) - Number(a.referenced));
  const kept = ordered.slice(0, WORDPRESS_MEDIA_LIMITS.maxFiles);
  report.mediaOverLimit = ordered.length - kept.length;

  // Menus: targets resolve to final slugs at commit, after conflict review.
  const menus: PlannedMenu[] = [];
  const itemsById = new Map(exported.menuItems.map((item) => [item.wpId, item]));
  for (const menu of exported.menus) {
    const items = exported.menuItems
      .filter((item) => item.menu === menu.slug)
      .sort((a, b) => a.order - b.order);
    if (items.length === 0) continue;
    menus.push({
      slug: menu.slug,
      name: menu.name,
      items: items.map((item) => {
        const depth = item.parentItemId && item.parentItemId !== "0" && itemsById.has(item.parentItemId) ? 1 : 0;
        if (item.type === "post_type" && item.objectId) {
          const target = exported.items.find((candidate) => candidate.wpId === item.objectId);
          return {
            label: item.label || target?.title || "",
            depth,
            targetWpId: item.objectId,
            note: target ? undefined : "target not in this export",
          };
        }
        if (item.type === "taxonomy" || item.type === "post_type_archive") {
          return { label: item.label || item.object, depth, href: "/blog", note: "archive mapped to the blog listing" };
        }
        const path = item.url ? wordpressPath(item.url, hosts, basePath) : null;
        return {
          label: item.label || item.url || "",
          depth,
          href: path !== null ? `/${toCmsSlug(path)}`.replace(/\/$/, "") || "/" : item.url,
        };
      }),
    });
  }

  return {
    site: { title: exported.site.title, url: exported.site.url || origin, hosts, basePath },
    pages,
    media: kept,
    menus,
    authors: exported.authors.map((author) => ({ ...author, posts: authorPosts.get(author.login) ?? 0 })),
    taxonomy: { categories: [...categories.values()], tags: [...tags.values()] },
    report,
  };
}

/* --------------------------------------------------------- body conversion */

type HtmlNode = DefaultTreeAdapterTypes.ChildNode;
type HtmlElement = DefaultTreeAdapterTypes.Element;

function isElement(node: HtmlNode): node is HtmlElement {
  return "tagName" in node;
}

function textContentOf(root: DefaultTreeAdapterTypes.Node): string {
  const text: string[] = [];
  const pending: DefaultTreeAdapterTypes.Node[] = [root];
  while (pending.length) {
    const node = pending.pop()!;
    if (node.nodeName === "#text") text.push((node as DefaultTreeAdapterTypes.TextNode).value);
    else if (!("tagName" in node) || !["script", "style"].includes(node.tagName)) {
      const nested = "childNodes" in node ? node.childNodes : [];
      for (let index = nested.length - 1; index >= 0; index -= 1) pending.push(nested[index]!);
    }
  }
  return text.join("");
}

const BLOCK_TAG = /^<(?:h[1-6]|p|ul|ol|li|blockquote|pre|table|figure|div|hr|dl|section|article|aside|header|footer|iframe|form|address|details|!--)[\s>/]/i;

/**
 * WordPress stores classic-editor posts without paragraph tags and adds them
 * when it renders (`wpautop`). Shortcodes are expanded at render time too.
 * This does the small part of both that changes what the content says.
 */
export function preprocessBody(body: string): string {
  let html = body.replace(/\r\n?/g, "\n");
  html = html.replace(/\[caption[^\]]*\]([\s\S]*?)\[\/caption\]/gi, (_match, inner: string) => {
    const image = /(<a\b[^>]*>\s*)?<img\b[^>]*>(\s*<\/a>)?/i.exec(inner);
    if (!image) return inner;
    const caption = inner.replace(image[0], "").trim();
    return `<figure>${image[0]}${caption ? `<figcaption>${caption}</figcaption>` : ""}</figure>`;
  });
  html = html.replace(/\[gallery([^\]]*)\]/gi, (_match, attrs: string) => {
    const ids = /ids\s*=\s*["']?([\d,\s]+)/i.exec(attrs)?.[1] ?? "";
    const images = ids
      .split(",")
      .map((id) => id.trim())
      .filter((id) => /^\d+$/.test(id))
      .map((id) => `<figure><img data-fh-wp-id="${id}"></figure>`)
      .join("");
    return images ? `<figure class="wp-block-gallery">${images}</figure>` : "";
  });
  html = html.replace(/\[embed[^\]]*\]([\s\S]*?)\[\/embed\]/gi, (_match, url: string) => {
    const href = url.trim().replace(/"/g, "%22");
    return `<p><a href="${href}">${href}</a></p>`;
  });
  html = html.replace(
    /\[\/?(?:video|audio|playlist|contact-form-7|wpforms|vc_[a-z_]+|et_pb_[a-z_]+|fusion_[a-z_]+)\b[^\]]*\]/gi,
    "",
  );
  if (!/<!--\s*wp:/.test(html)) {
    html = html
      .split(/\n\s*\n/)
      .map((chunk) => chunk.trim())
      .filter(Boolean)
      .map((chunk) => (BLOCK_TAG.test(chunk) ? chunk : `<p>${chunk.replace(/\n/g, "<br>")}</p>`))
      .join("\n");
  }
  return html;
}

export type ImageMatch = { assetId: string; alt?: string };

export type BodyConversion = {
  blocks: BlockNode[];
  /** Image sources in the body that matched no imported file. */
  unresolvedImages: string[];
  /** Embeds, scripts, forms and frames left behind. */
  droppedEmbeds: number;
  /** HTML too large for an html block, kept as plain paragraphs instead. */
  flattenedHtml: number;
  /** Null when the page fits the CMS budgets (C2.22). */
  overBudget: string | null;
};

export type BodyContext = {
  slug: string;
  title: string;
  featured?: ImageMatch;
  resolveImage: (src: string, wpId?: string) => ImageMatch | null;
  rewriteHref: (href: string) => string;
};

const CONTAINERS = new Set(["div", "section", "article", "main", "header", "footer", "aside", "center", "span"]);
const DROPPED = new Set(["iframe", "object", "embed", "video", "audio", "form", "input", "button", "select", "textarea", "svg", "canvas", "noscript"]);
const SILENT = new Set(["script", "style", "template", "link", "meta"]);
const MARKS: Record<string, RichMark> = { strong: "strong", b: "strong", em: "em", i: "em", code: "code", kbd: "code", samp: "code", tt: "code" };
const HEADINGS = /^h([1-6])$/;
const INLINE = new Set(["a", "abbr", "b", "bdi", "bdo", "br", "cite", "code", "data", "del", "dfn", "em", "i", "ins", "kbd", "mark", "q", "s", "samp", "small", "strong", "sub", "sup", "time", "tt", "u", "var", "wbr", "font"]);

function hasDescendant(node: HtmlNode, test: (element: HtmlElement) => boolean): boolean {
  if (!isElement(node)) return false;
  return node.childNodes.some((nested) => (isElement(nested) && test(nested)) || hasDescendant(nested, test));
}

function descendants(node: HtmlNode, tag: string): HtmlElement[] {
  if (!isElement(node)) return [];
  const found: HtmlElement[] = [];
  for (const nested of node.childNodes) {
    if (isElement(nested) && nested.tagName === tag) found.push(nested);
    found.push(...descendants(nested, tag));
  }
  return found;
}

function mergeSpans(spans: RichInline[]): RichInline[] {
  const merged: RichInline[] = [];
  for (const span of spans) {
    const last = merged.at(-1);
    if (
      span.type === "text" &&
      last?.type === "text" &&
      (last.marks ?? []).join() === (span.marks ?? []).join() &&
      last.text.length + span.text.length <= 20_000
    ) {
      last.text += span.text;
      continue;
    }
    merged.push(span.type === "text" ? { ...span } : span);
  }
  const first = merged[0];
  if (first?.type === "text") first.text = first.text.replace(/^\s+/, "");
  const last = merged.at(-1);
  if (last?.type === "text") last.text = last.text.replace(/\s+$/, "");
  return merged.filter((span) => span.type === "link" || span.text.length > 0);
}

function textSpan(text: string, marks: RichMark[]): RichTextSpan {
  return marks.length ? { type: "text", text, marks: [...new Set(marks)] } : { type: "text", text };
}

function inlines(nodes: HtmlNode[], marks: RichMark[], context: BodyContext): RichInline[] {
  const out: RichInline[] = [];
  for (const node of nodes) {
    if (node.nodeName === "#text") {
      const value = (node as DefaultTreeAdapterTypes.TextNode).value.replace(/\s+/g, " ");
      for (let start = 0; start < value.length; start += 20_000) {
        out.push(textSpan(value.slice(start, start + 20_000), marks));
      }
      continue;
    }
    if (!isElement(node) || SILENT.has(node.tagName) || node.tagName === "img") continue;
    if (node.tagName === "br") {
      out.push(textSpan(" ", marks));
      continue;
    }
    const mark = MARKS[node.tagName];
    const nested = inlines(node.childNodes, mark ? [...marks, mark] : marks, context);
    if (node.tagName !== "a") {
      out.push(...nested);
      continue;
    }
    const raw = getAttr(node, "href");
    const href = raw ? safeRichHref(context.rewriteHref(raw)) : undefined;
    const children = mergeSpans(
      nested.flatMap((span) => (span.type === "link" ? span.children : [span])),
    ) as RichTextSpan[];
    if (href && children.length > 0 && children.length <= 40) {
      out.push({ type: "link", href, children });
    } else {
      out.push(...children);
    }
  }
  return out;
}

class Emitter {
  readonly blocks: BlockNode[] = [];
  private rich: RichBlock[] = [];
  private pending: HtmlNode[] = [];
  private counter = 0;
  htmlChars = 0;
  unresolved: string[] = [];
  dropped = 0;
  flattened = 0;

  constructor(private readonly context: BodyContext) {}

  private id(kind: string): string {
    this.counter += 1;
    const safe = this.context.slug.replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "") || "page";
    return `import-${safe}-${kind}-${this.counter}`;
  }

  private pushRich(block: RichBlock): boolean {
    if (!richBlockSchema.safeParse(block).success) return false;
    this.rich.push(block);
    if (this.rich.length >= RICH_BLOCKS_PER_TEXT) this.flushText();
    return true;
  }

  flushText(): void {
    this.flushInline();
    if (this.rich.length === 0) return;
    this.blocks.push({ id: this.id("text"), type: "text", props: { body: this.rich } });
    this.rich = [];
  }

  /** Text that arrived loose, outside any paragraph, becomes one. */
  inline(node: HtmlNode): void {
    this.pending.push(node);
  }

  flushInline(): void {
    if (this.pending.length === 0) return;
    const nodes = this.pending;
    this.pending = [];
    this.paragraph(nodes);
  }

  paragraph(nodes: HtmlNode[]): void {
    const children = mergeSpans(inlines(nodes, [], this.context));
    if (children.length === 0) return;
    if (children.length <= 80 && this.pushRich({ type: "paragraph", children })) return;
    this.plainText(nodes.map((node) => textContentOf(node)).join(" "));
  }

  heading(level: number, text: string): void {
    this.flushText();
    const clamped = Math.min(4, Math.max(2, level)) as 2 | 3 | 4;
    this.blocks.push({ id: this.id("heading"), type: "heading", props: { text: text.slice(0, 500), level: clamped } });
  }

  divider(): void {
    this.flushText();
    this.blocks.push({ id: this.id("divider"), type: "divider", props: {} });
  }

  image(element: HtmlElement, caption?: string): void {
    const ref = imageRef(element);
    const match = this.context.resolveImage(ref.src, ref.wpId);
    if (!match) {
      // Nothing is placed, so the surrounding text keeps flowing as one block.
      if (ref.src || ref.wpId) this.unresolved.push(ref.src || `attachment ${ref.wpId}`);
      if (caption) this.pushRich({ type: "paragraph", children: [textSpan(caption.slice(0, 20_000), ["em"])] });
      return;
    }
    this.flushText();
    const alt = ref.alt || match.alt;
    this.blocks.push({
      id: this.id("image"),
      type: "image",
      props: alt ? { assetId: match.assetId, alt: alt.slice(0, 500) } : { assetId: match.assetId },
    });
    if (caption) this.pushRich({ type: "paragraph", children: [textSpan(caption.slice(0, 20_000), ["em"])] });
  }

  gallery(figures: Array<{ element: HtmlElement; caption?: string }>): void {
    this.flushText();
    const items: Array<{ assetId: string; caption?: string }> = [];
    for (const { element, caption } of figures) {
      const ref = imageRef(element);
      const match = this.context.resolveImage(ref.src, ref.wpId);
      if (!match) {
        if (ref.src || ref.wpId) this.unresolved.push(ref.src || `attachment ${ref.wpId}`);
        continue;
      }
      items.push(caption ? { assetId: match.assetId, caption: caption.slice(0, 200) } : { assetId: match.assetId });
    }
    for (let start = 0; start < items.length; start += GALLERY_MAX) {
      this.blocks.push({ id: this.id("gallery"), type: "gallery", props: { items: items.slice(start, start + GALLERY_MAX) } });
    }
  }

  html(element: HtmlElement): void {
    this.flushText();
    for (const anchor of descendants(element, "a")) {
      const href = getAttr(anchor, "href");
      if (href === undefined) continue;
      const rewritten = this.context.rewriteHref(href);
      anchor.attrs = anchor.attrs.map((entry) => (entry.name.toLowerCase() === "href" ? { ...entry, value: rewritten } : entry));
    }
    const images = descendants(element, "img");
    const markup = sanitizeOwnerHtml(serializeOuter(element)).trim();
    if (markup && textContentOf(parseFragment(markup)).trim()) {
      if (markup.length <= HTML_BLOCK_MAX && this.htmlChars + markup.length <= PAGE_HTML_CHARS_BUDGET) {
        this.htmlChars += markup.length;
        this.blocks.push({ id: this.id("html"), type: "html", props: { markup } });
      } else {
        this.flattened += 1;
        this.plainText(textContentOf(element));
        this.flushText();
      }
    }
    for (const image of images) this.image(image);
  }

  private plainText(value: string): void {
    for (const line of value.split(/\n+/).map((part) => part.replace(/\s+/g, " ").trim()).filter(Boolean)) {
      for (let start = 0; start < line.length; start += 20_000) {
        this.pushRich({ type: "paragraph", children: [textSpan(line.slice(start, start + 20_000), [])] });
      }
    }
  }

  list(element: HtmlElement): void {
    const items = element.childNodes.filter((node): node is HtmlElement => isElement(node) && node.tagName === "li");
    const nested = items.some((item) => hasDescendant(item, (inner) => ["ul", "ol", "table", "blockquote", "pre"].includes(inner.tagName)));
    if (nested || items.length === 0 || items.length > 80) {
      this.html(element);
      return;
    }
    const children = items
      .map((item) => ({ type: "listItem" as const, children: mergeSpans(inlines(item.childNodes, [], this.context)) }))
      .filter((item) => item.children.length > 0 && item.children.length <= 80);
    this.flushInline();
    if (children.length === 0 || !this.pushRich({ type: element.tagName === "ol" ? "orderedList" : "bulletList", children })) {
      this.html(element);
      return;
    }
    for (const image of descendants(element, "img")) this.image(image);
  }
}

function figureCaption(element: HtmlElement): string | undefined {
  const caption = element.childNodes.find((node): node is HtmlElement => isElement(node) && node.tagName === "figcaption");
  const text = caption ? textContentOf(caption).replace(/\s+/g, " ").trim() : "";
  return text || undefined;
}

function walkBody(nodes: HtmlNode[], out: Emitter): void {
  for (const node of nodes) {
    if (node.nodeName === "#text") {
      if ((node as DefaultTreeAdapterTypes.TextNode).value.trim()) out.inline(node);
      continue;
    }
    if (!isElement(node)) continue;
    const tag = node.tagName;
    if (SILENT.has(tag)) continue;
    if (DROPPED.has(tag)) {
      out.flushInline();
      out.dropped += 1;
      continue;
    }
    if (INLINE.has(tag) && !hasDescendant(node, (inner) => inner.tagName === "img" || !INLINE.has(inner.tagName))) {
      out.inline(node);
      continue;
    }
    if (tag === "img") {
      out.image(node);
      continue;
    }
    if (tag === "a" && hasDescendant(node, (inner) => inner.tagName === "img")) {
      for (const image of descendants(node, "img")) out.image(image);
      continue;
    }
    const heading = HEADINGS.exec(tag);
    if (heading) {
      out.flushInline();
      const text = textContentOf(node).replace(/\s+/g, " ").trim();
      if (text) out.heading(Number(heading[1]), text);
      for (const image of descendants(node, "img")) out.image(image);
      continue;
    }
    if (tag === "p") {
      out.flushInline();
      // A paragraph that holds an image splits around it: text, picture, text.
      const segment: HtmlNode[] = [];
      const visit = (children: HtmlNode[]) => {
        for (const childNode of children) {
          if (isElement(childNode) && childNode.tagName === "img") {
            out.paragraph(segment.splice(0));
            out.image(childNode);
          } else if (isElement(childNode) && hasDescendant(childNode, (inner) => inner.tagName === "img")) {
            if (childNode.tagName === "a") {
              out.paragraph(segment.splice(0));
              for (const image of descendants(childNode, "img")) out.image(image);
            } else {
              visit(childNode.childNodes);
            }
          } else if (isElement(childNode) && DROPPED.has(childNode.tagName)) {
            out.dropped += 1;
          } else {
            segment.push(childNode);
          }
        }
      };
      visit(node.childNodes);
      out.paragraph(segment);
      continue;
    }
    if (tag === "ul" || tag === "ol") {
      out.list(node);
      continue;
    }
    if (tag === "hr") {
      out.flushInline();
      out.divider();
      continue;
    }
    if (tag === "figure") {
      out.flushInline();
      const images = descendants(node, "img");
      const isGallery = (getAttr(node, "class") ?? "").includes("wp-block-gallery") || images.length > 1;
      if (images.length === 0) {
        walkBody(node.childNodes, out);
        out.flushInline();
      } else if (isGallery) {
        const inner = descendants(node, "figure");
        out.gallery(
          inner.length > 0
            ? inner.flatMap((figure) => descendants(figure, "img").slice(0, 1).map((element) => ({ element, caption: figureCaption(figure) })))
            : images.map((element) => ({ element })),
        );
      } else {
        out.image(images[0]!, figureCaption(node));
      }
      continue;
    }
    if (CONTAINERS.has(tag)) {
      out.flushInline();
      walkBody(node.childNodes, out);
      out.flushInline();
      continue;
    }
    out.html(node);
  }
}

/** Fold runs of images into galleries until the page fits its image budget. */
function compactImages(blocks: BlockNode[]): BlockNode[] {
  const out: BlockNode[] = [];
  let run: BlockNode[] = [];
  const flush = () => {
    if (run.length > 1) {
      for (let start = 0; start < run.length; start += GALLERY_MAX) {
        const slice = run.slice(start, start + GALLERY_MAX);
        out.push({
          id: `${slice[0]!.id}-gallery`,
          type: "gallery",
          props: { items: slice.map((block) => ({ assetId: block.props.assetId })) },
        });
      }
    } else {
      out.push(...run);
    }
    run = [];
  };
  for (const block of blocks) {
    if (block.type === "image") {
      run.push(block);
      continue;
    }
    flush();
    out.push(block);
  }
  flush();
  return out;
}

/**
 * A WordPress body as typed CMS blocks: one H1 (the title), headings, rich
 * text, images and galleries from the media library, and an `html` block only
 * for structure rich text cannot hold (tables, quotes, code).
 */
export function wordpressBodyToBlocks(body: string, context: BodyContext): BodyConversion {
  const out = new Emitter(context);
  walkBody(parseFragment(preprocessBody(body)).childNodes, out);
  out.flushText();
  const safe = context.slug.replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "") || "page";
  let blocks: BlockNode[] = [
    {
      id: `import-${safe}-heading`,
      type: "heading",
      props: { text: context.title.slice(0, 500) || context.slug || "Imported page", level: 1, align: "start" },
    },
    ...(context.featured &&
    !out.blocks.some((block) => block.type === "image" && block.props.assetId === context.featured!.assetId)
      ? [{
          id: `import-${safe}-featured`,
          type: "image",
          props: context.featured.alt
            ? { assetId: context.featured.assetId, alt: context.featured.alt }
            : { assetId: context.featured.assetId },
        }]
      : []),
    ...out.blocks,
  ];
  let overBudget = budgetMessage(blocks);
  if (overBudget) {
    blocks = compactImages(blocks);
    overBudget = budgetMessage(blocks);
  }
  return {
    blocks,
    unresolvedImages: out.unresolved,
    droppedEmbeds: out.dropped,
    flattenedHtml: out.flattened,
    overBudget,
  };
}

export const WORDPRESS_PAGE_BUDGETS = {
  blocks: PAGE_BLOCK_BUDGET,
  images: PAGE_IMAGE_BUDGET,
  htmlChars: PAGE_HTML_CHARS_BUDGET,
  limits: DEFAULT_IMPORTER_LIMITS,
} as const;
