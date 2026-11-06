// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// What a link-in-bio entry is, where it goes, and whether it is showing now
// (MASTER.md §32, §34, C9.39).
//
// Pure functions over plain values, like `share/links.ts`, so every rule here
// is a unit test with no database and no HTTP. Three rules carry the feature:
//
//   1. **A link is a row in a typed block, not a row in a table.** The page is
//      an ordinary CMS page and the links are a `linkInBio` block on it, so
//      the editor, revisions, translation, A/B variants, SEO and publishing are
//      the ones every page already has. The stable `id` on each entry is what
//      lets a click be counted and an API caller address one link.
//   2. **Storage is lenient; the services are strict.** The editor autosaves
//      while somebody is typing, so a half-written entry (no label yet, an
//      address being pasted) must save. It simply does not render: `linkState`
//      says why, and the admin screen and `linkinbio.page` show that reason.
//      `linkinbio.addLink` and `linkinbio.updateLink` refuse the same values
//      outright, because an API caller has no half-typed state to protect.
//   3. **A click goes through one first-party door.** Every rendered entry
//      points at `/go/link/<id>`, which looks the entry up on the published
//      page and redirects to what is stored there — never to anything the
//      request says. That is what makes it a counter rather than an open
//      redirect, and it is the same door for a product and for a podcast.
import { randomInt } from "node:crypto";
import { z } from "zod";
import { zonedInstant } from "@/core/i18n/zoned";
import type { BlockNode } from "@/modules/cms/blocks/types";

/** The block type, stored in page trees. Renaming it is a migration. */
export const LINK_IN_BIO_BLOCK = "linkInBio";

/**
 * Where an entry can point.
 *
 * `url` is anywhere on the web. Every other kind is one of the site's own
 * features, so the entry follows it: a product that is unpublished, an event
 * that is taken down or a gallery that expires drops out of the list instead
 * of sending a visitor to a dead end.
 */
export const LINK_KINDS = [
  "url",
  "page",
  "product",
  "booking",
  "newsletter",
  "event",
  "gallery",
] as const;
export type LinkKind = (typeof LINK_KINDS)[number];

/** How the buttons look. Every one is drawn from semantic tokens only. */
export const LINK_STYLES = ["solid", "outline", "soft"] as const;
export type LinkStyle = (typeof LINK_STYLES)[number];

/**
 * The profiles an icon row can name.
 *
 * A fixed list because each one needs an icon and a translated name a screen
 * reader can say; "website" and "email" cover everything else.
 */
export const SOCIAL_NETWORKS = [
  "instagram",
  "tiktok",
  "youtube",
  "facebook",
  "x",
  "threads",
  "bluesky",
  "mastodon",
  "linkedin",
  "pinterest",
  "spotify",
  "soundcloud",
  "twitch",
  "github",
  "whatsapp",
  "telegram",
  "email",
  "website",
] as const;
export type SocialNetwork = (typeof SOCIAL_NETWORKS)[number];

/** Why an entry is or is not on the public page right now. */
export const LINK_STATES = [
  "live",
  "hidden",
  "scheduled",
  "expired",
  "invalidSchedule",
  "needsLabel",
  "needsTarget",
  "unavailable",
] as const;
export type LinkState = (typeof LINK_STATES)[number];

/** The analytics event one followed link records. Dotted, past tense. */
export const BIO_CLICK_EVENT = "linkinbio.clicked";

/**
 * The campaign an on-site destination carries, so a link's visitors and
 * conversions land in the traffic report an owner already reads.
 */
export const BIO_SOURCE = "bio";
export const BIO_MEDIUM = "link-in-bio";
export function bioCampaign(linkId: string): string {
  return `bio:${linkId}`;
}

const ID_ALPHABET = "abcdefghijkmnopqrstuvwxyz23456789";
const LINK_ID = /^[a-z0-9]{4,24}$/;

/**
 * A stable public identifier for one entry.
 *
 * Random rather than sequential so one link's address does not reveal how
 * many others exist; short because it is part of every button's URL.
 * `randomInt` rejection-samples, so no character is likelier than another.
 */
export function mintLinkId(length = 10): string {
  let out = "";
  for (let index = 0; index < length; index += 1) {
    out += ID_ALPHABET[randomInt(ID_ALPHABET.length)]!;
  }
  return out;
}

export function isLinkId(value: string): boolean {
  return LINK_ID.test(value);
}

/**
 * Give every entry an id, and every id one entry.
 *
 * Runs as a Zod `overwrite`, which keeps the schema an array (so the editor
 * still derives a list control from it) while making the stored tree carry
 * ids from its first save. A duplicate — two entries pasted from one — gets a
 * fresh id, because two links answering to one id would count each other's
 * clicks.
 */
function withIds<T extends { id: string }>(items: T[]): T[] {
  const seen = new Set<string>();
  return items.map((item) => {
    let id = isLinkId(item.id) ? item.id : "";
    if (!id || seen.has(id)) id = mintLinkId();
    seen.add(id);
    return id === item.id ? item : { ...item, id };
  });
}

/** One entry as stored. Lenient by design; see rule 2 at the top. */
export const linkItemSchema = z.object({
  id: z.string().max(40).default(""),
  label: z.string().max(120).default(""),
  kind: z.enum(LINK_KINDS).default("url"),
  target: z.string().max(600).default(""),
  hidden: z.boolean().default(false),
  startsAt: z.string().max(40).default(""),
  endsAt: z.string().max(40).default(""),
});
export type LinkItem = z.output<typeof linkItemSchema>;

export const socialItemSchema = z.object({
  network: z.enum(SOCIAL_NETWORKS).default("instagram"),
  url: z.string().max(600).default(""),
});
export type SocialItem = z.output<typeof socialItemSchema>;

export const MAX_LINKS = 100;
export const MAX_SOCIALS = 20;

/** The block's props. `blocks.tsx` renders them; services edit them. */
export const linkInBioPropsSchema = z.object({
  /** Shown as the heading. Empty means the business name. */
  name: z.string().max(120).default(""),
  bio: z.string().max(600).default(""),
  /** A media-library image. Empty means the site logo, then a monogram. */
  avatarAssetId: z.string().max(60).default(""),
  /** 1 when this block is the page's title (the template's default). */
  headingLevel: z.union([z.literal(1), z.literal(2)]).default(1),
  style: z.enum(LINK_STYLES).default("solid"),
  links: z
    .array(linkItemSchema)
    .max(MAX_LINKS)
    .overwrite((items) => withIds(items))
    .default([]),
  socials: z.array(socialItemSchema).max(MAX_SOCIALS).default([]),
});
export type LinkInBioProps = z.output<typeof linkInBioPropsSchema>;

/* -------------------------------------------------------------- addresses */

/** Anything that could make a path mean somewhere other than here. */
const HAS_SCHEME = /^[a-zA-Z][a-zA-Z0-9+.\-]*:/;

function hasUnsafeCharacters(value: string): boolean {
  if (value.includes("\\")) return true;
  for (const character of value) {
    if (character.codePointAt(0)! <= 0x20) return true;
  }
  return false;
}

/**
 * A path on this site with no leading or trailing slash, or null.
 *
 * The same normalisation pages are stored under ("" is the home page), and
 * the same refusals as a share target: no scheme, no protocol-relative host,
 * no traversal, no control characters.
 */
export function sitePath(raw: string): string | null {
  const value = raw.trim();
  if (hasUnsafeCharacters(value)) return null;
  if (HAS_SCHEME.test(value)) return null;
  if (value.startsWith("//")) return null;
  const trimmed = value.replace(/^\/+|\/+$/g, "");
  if (trimmed === "") return "";
  if (trimmed.length > 400) return null;
  const segments = trimmed.split("/");
  if (segments.some((segment) => segment === "." || segment === ".." || segment === "")) {
    return null;
  }
  if (!segments.every((segment) => /^[a-z0-9][a-z0-9-]*$/.test(segment))) return null;
  return trimmed;
}

/**
 * An address somewhere else that a visitor's browser may be sent to, or null.
 *
 * Web addresses, plus `mailto:` and `tel:`, which are the two non-web links a
 * bio page is routinely asked for. Everything else — `javascript:`, `data:`,
 * a bare word — is refused, because this value becomes the `Location` of a
 * redirect on the owner's own domain.
 */
export function safeExternalUrl(raw: string): string | null {
  const value = raw.trim();
  if (!value || value.length > 600) return null;
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return null;
  }
  if (parsed.protocol === "https:" || parsed.protocol === "http:") {
    if (!parsed.hostname || parsed.username || parsed.password) return null;
    return parsed.toString();
  }
  if (parsed.protocol === "mailto:") {
    return /^mailto:[^\s@]+@[^\s@]+\.[^\s@]+/i.test(value) ? value : null;
  }
  if (parsed.protocol === "tel:") {
    return /^tel:\+?[0-9().\s-]{3,30}$/i.test(value) ? value.replace(/\s+/g, "") : null;
  }
  return null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SLUG = /^[a-z0-9][a-z0-9-]{0,119}$/;

/**
 * The stored form of a smart link's target, or null when it cannot be one.
 *
 * Pages, products, events and the newsletter are CMS pages, so their target
 * is the page's own path — the same string the sitemap and the canonical tag
 * use. A bare product or event slug is accepted and filed under its index,
 * because that is how a person (or an agent) names one. A gallery is its slug
 * and a booking is the bookable service's id, because neither is a page.
 */
export function normalizeTarget(kind: LinkKind, raw: string): string | null {
  const value = raw.trim();
  switch (kind) {
    case "url":
      return safeExternalUrl(value);
    case "page":
      return sitePath(value);
    case "product":
    case "event": {
      const index = kind === "product" ? "products" : "events";
      const path = sitePath(value);
      if (path === null || path === "") return null;
      if (path.startsWith(`${index}/`)) return path.split("/").length === 2 ? path : null;
      return path.includes("/") ? null : `${index}/${path}`;
    }
    case "newsletter": {
      if (value === "") return "newsletters";
      const path = sitePath(value);
      if (path === null) return null;
      if (path === "newsletters") return path;
      if (path.startsWith("newsletters/")) return path.split("/").length === 2 ? path : null;
      return path.includes("/") ? null : `newsletters/${path}`;
    }
    case "gallery": {
      const slug = value.replace(/^\/?g\//, "");
      return SLUG.test(slug) ? slug : null;
    }
    case "booking":
      return UUID.test(value) ? value.toLowerCase() : null;
  }
}

/** The CMS page a smart link depends on, for the "is it live" check. */
export function pageDependency(kind: LinkKind, target: string): string | null {
  if (kind === "page" || kind === "product" || kind === "event" || kind === "newsletter") {
    return normalizeTarget(kind, target);
  }
  return null;
}

/**
 * Where an entry lands, as an on-site href or an outside address.
 *
 * Null when the stored target is not a valid one for its kind — the entry is
 * then `needsTarget` and is not rendered.
 */
export function destinationOf(link: Pick<LinkItem, "kind" | "target">):
  | { external: true; href: string }
  | { external: false; href: string }
  | null {
  const target = normalizeTarget(link.kind, link.target);
  if (target === null) return null;
  switch (link.kind) {
    case "url":
      return { external: true, href: target };
    case "gallery":
      return { external: false, href: `/g/${target}` };
    case "booking":
      return { external: false, href: `/book?service=${encodeURIComponent(target)}` };
    default:
      return { external: false, href: target === "" ? "/" : `/${target}` };
  }
}

/**
 * The absolute address a click on an on-site entry is redirected to.
 *
 * Resolved against the configured origin and checked to still have it, the
 * same second check `share.destinationFor` makes: the stored value outlives
 * the code that validated it. The campaign is what lets the landing page's
 * own view, and whatever that visitor buys or books afterwards, be reported
 * against this one link.
 */
export function internalDestination(href: string, linkId: string, origin: string): string | null {
  let configured: URL;
  let resolved: URL;
  try {
    configured = new URL(origin);
    resolved = new URL(href, `${configured.origin}/`);
  } catch {
    return null;
  }
  if (resolved.origin !== configured.origin) return null;
  resolved.searchParams.set("utm_source", BIO_SOURCE);
  resolved.searchParams.set("utm_medium", BIO_MEDIUM);
  resolved.searchParams.set("utm_campaign", bioCampaign(linkId));
  return resolved.toString();
}

/**
 * The first-party address every rendered entry points at.
 *
 * `from` names the published page the entry lives on, so the redirect can
 * find it; it can only ever select a page, never a destination.
 */
export function clickHref(linkId: string, fromPath: string, locale?: string): string {
  const params = new URLSearchParams({ from: fromPath || "/" });
  if (locale) params.set("lang", locale);
  return `/go/link/${encodeURIComponent(linkId)}?${params.toString()}`;
}

/* --------------------------------------------------------------- schedule */

const LOCAL = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?$/;
const ZONED = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/;

/**
 * The instant a schedule value names, read in the business's zone.
 *
 * The editor and the admin form give a wall-clock time with no zone, which is
 * the clock the owner is looking at, so it is read in the business's zone.
 * An API caller may send an exact instant with an offset instead. A date with
 * no time means the start of that day — except as an *end*, where "until the
 * 31st" means through the 31st, so it is the start of the next day.
 *
 * `undefined` for an empty value (no bound), `null` for one that cannot be
 * read — which hides the entry rather than guessing.
 */
export function scheduleInstant(
  raw: string,
  timezone: string,
  edge: "start" | "end",
): Date | null | undefined {
  const value = raw.trim();
  if (value === "") return undefined;
  if (ZONED.test(value)) {
    const instant = new Date(value);
    return Number.isNaN(instant.getTime()) ? null : instant;
  }
  const local = LOCAL.exec(value);
  if (!local) return null;
  const [, y, m, d, hh, mm] = local;
  const year = Number(y);
  const month = Number(m);
  const day = Number(d);
  const hour = hh === undefined ? 0 : Number(hh);
  const minute = mm === undefined ? 0 : Number(mm);
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59) return null;
  // Round-trip the calendar date so 2026-02-31 is refused rather than rolled.
  const check = new Date(Date.UTC(year, month - 1, day));
  if (check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) return null;
  try {
    if (hh === undefined && edge === "end") {
      const next = new Date(Date.UTC(year, month - 1, day + 1));
      return zonedInstant(timezone, {
        year: next.getUTCFullYear(),
        month: next.getUTCMonth() + 1,
        day: next.getUTCDate(),
      });
    }
    return zonedInstant(timezone, { year, month, day, hour, minute });
  } catch {
    return null;
  }
}

/** A schedule value as the services store it: trimmed, `T`-separated. */
export function normalizeSchedule(raw: string | null | undefined): string {
  const value = (raw ?? "").trim();
  return LOCAL.test(value) ? value.replace(" ", "T") : value;
}

/**
 * Why this entry is or is not on the page at `now`.
 *
 * Order matters: a hidden entry is "hidden" even if its window has passed,
 * because that is the switch the owner flipped last; a missing label or
 * target outranks the schedule because no date fixes it.
 */
export function linkState(link: LinkItem, now: Date, timezone: string): LinkState {
  if (link.hidden) return "hidden";
  if (!link.label.trim()) return "needsLabel";
  if (destinationOf(link) === null) return "needsTarget";
  const starts = scheduleInstant(link.startsAt, timezone, "start");
  const ends = scheduleInstant(link.endsAt, timezone, "end");
  if (starts === null || ends === null) return "invalidSchedule";
  if (starts && ends && ends.getTime() <= starts.getTime()) return "invalidSchedule";
  if (starts && now.getTime() < starts.getTime()) return "scheduled";
  if (ends && now.getTime() >= ends.getTime()) return "expired";
  return "live";
}

/* ------------------------------------------------------------------ trees */

/** Every link-in-bio block in a tree, in document order, variants included. */
export function linkInBioBlocks(nodes: BlockNode[]): BlockNode[] {
  const found: BlockNode[] = [];
  const walk = (list: BlockNode[]) => {
    for (const node of list) {
      if (node.type === LINK_IN_BIO_BLOCK) found.push(node);
      if (node.children?.length) walk(node.children);
    }
  };
  walk(nodes);
  return found;
}

/** One entry by id, wherever on the page it lives. */
export function findLink(
  nodes: BlockNode[],
  linkId: string,
): { block: BlockNode; link: LinkItem } | null {
  for (const block of linkInBioBlocks(nodes)) {
    const parsed = linkInBioPropsSchema.safeParse(block.props);
    if (!parsed.success) continue;
    const link = parsed.data.links.find((each) => each.id === linkId);
    if (link) return { block, link };
  }
  return null;
}

/**
 * A copy of the tree with one block's props replaced.
 *
 * Structural rather than by reference so the caller's tree — usually the
 * page as it was read — is never edited in place.
 */
export function replaceBlockProps(
  nodes: BlockNode[],
  blockId: string,
  props: Record<string, unknown>,
): BlockNode[] {
  return nodes.map((node) => {
    if (node.id === blockId && node.type === LINK_IN_BIO_BLOCK) {
      return { ...node, props };
    }
    if (node.children?.length) {
      return { ...node, children: replaceBlockProps(node.children, blockId, props) };
    }
    return node;
  });
}

/** A social profile's address, if it is one a visitor may be sent to. */
export function socialHref(item: SocialItem): string | null {
  const value = item.url.trim();
  if (!value) return null;
  if (item.network === "email") {
    const address = value.replace(/^mailto:/i, "");
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address) ? `mailto:${address}` : null;
  }
  const safe = safeExternalUrl(value);
  return safe && /^https?:/.test(safe) ? safe : null;
}

/** Initials for the monogram shown when there is no picture. */
export function monogram(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const letters = words.slice(0, 2).map((word) => [...word][0] ?? "");
  return letters.join("").toUpperCase();
}
