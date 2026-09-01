// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Short refs, safe destinations, and the campaign a share reports under
// (MASTER.md §34, C9.28).
//
// `/s/<ref>` is a public redirect, which is the most abused shape on the web:
// something that takes an identifier from a stranger and sends a browser
// wherever it says. Everything in this file exists to make that impossible
// twice over.
//
//   1. A share target stores a *path*, never a URL. `internalPath` refuses
//      anything with a scheme, an authority, a traversal or a control
//      character, so a hostile value cannot be stored in the first place.
//   2. `destinationFor` resolves that path against this instance's configured
//      origin and then checks the result still *has* that origin, refusing if
//      not. A row that got past rule 1 — a bad migration, a hand-edited
//      database, a future writer who forgot — still cannot redirect anybody
//      off-site.
//
// Two checks for one rule is not belt-and-braces for its own sake. The stored
// column outlives the code that wrote it, and the check that matters is the
// one standing between a stranger's request and the browser.
import { randomInt } from "node:crypto";
import { siteOrigin } from "@/core/seo/origin";
import type { ShareChannel } from "./intents";

/**
 * The medium every share reports under, so one filter finds all of it.
 *
 * §34 wants sharing to become "a measured channel, not a hopeful button", and
 * the platform already measures channels: `utm_medium` is the column the
 * campaign report groups by. Inventing a parallel word would have meant
 * sharing was invisible in the report an owner already reads.
 */
export const SHARE_MEDIUM = "share";

/** `share:abc123` — the campaign name one tracked link reports under. */
export function campaignFor(ref: string): string {
  return `share:${ref}`;
}

/** The ref back out of a campaign name, or null when it is somebody else's. */
export function refFromCampaign(campaign: string | null | undefined): string | null {
  if (!campaign) return null;
  const found = /^share:([A-Za-z0-9_-]{1,64})$/.exec(campaign);
  return found ? found[1]! : null;
}

/**
 * A short public identifier.
 *
 * Random rather than sequential, because a sequential ref would let anybody
 * holding one link enumerate every other thing the business had shared —
 * including entities whose sharing the owner has since switched off. It is not
 * a credential (following it only reaches a page that was already public), so
 * 10 base32 characters is generous rather than tight, and short enough to
 * survive being read aloud or printed on a card.
 */
const ALPHABET = "abcdefghijkmnopqrstuvwxyz23456789";

export function mintRef(length = 10): string {
  let out = "";
  for (let index = 0; index < length; index += 1) {
    // `randomInt` performs rejection sampling. Taking a random byte modulo
    // this 33-character alphabet would make its first 25 characters slightly
    // more likely than the rest, needlessly shrinking the effective ref space.
    out += ALPHABET[randomInt(ALPHABET.length)]!;
  }
  return out;
}

/** Anything that could make a path mean somewhere other than here. */
const HAS_SCHEME = /^[a-zA-Z][a-zA-Z0-9+.\-]*:/;

/**
 * A backslash, or anything at or below a space.
 *
 * Written as a loop rather than a character class because the class is easy
 * to get subtly wrong and impossible to read afterwards, and this is the
 * check that stands between a stranger and a redirect.
 */
function hasUnsafeCharacters(value: string): boolean {
  if (value.includes("\\")) return true;
  for (const character of value) {
    if (character.codePointAt(0)! <= 0x20) return true;
  }
  return false;
}

/**
 * A path this instance serves, or null.
 *
 * Normalised the way the rest of the platform stores paths — no leading or
 * trailing slash, `""` for the home page — so a share target's key is the same
 * string the sitemap, the canonical tag and the OG route already use. A second
 * spelling of one URL would mean two share targets for one page, and the safe
 * one would lose.
 */
export function internalPath(raw: string): string | null {
  const value = raw.trim();
  if (hasUnsafeCharacters(value)) return null;
  // `https://evil.example/x`, `javascript:...`, `data:...`. Refused before any
  // slash-stripping can disguise them.
  if (HAS_SCHEME.test(value)) return null;
  // `//evil.example/x` is protocol-relative: a browser reads it as a host.
  if (value.startsWith("//")) return null;
  const trimmed = value.replace(/^\/+|\/+$/g, "");
  if (trimmed === "") return "";
  if (trimmed.split("/").some((segment) => segment === "." || segment === "..")) {
    return null;
  }
  if (trimmed.length > 400) return null;
  return trimmed;
}

/** The canonical absolute URL of a share target, or null if it is not ours. */
export function canonicalShareUrl(path: string, origin = siteOrigin()): string | null {
  const clean = internalPath(path);
  if (clean === null) return null;
  let resolved: URL;
  let configured: URL;
  try {
    configured = new URL(origin);
    resolved = new URL(clean, `${configured.origin}/`);
  } catch {
    return null;
  }
  // The second check. `internalPath` should already have made this impossible;
  // it runs anyway because the value came out of a database, not out of that
  // function, and the row outlives the code that wrote it.
  if (resolved.origin !== configured.origin) return null;
  return resolved.toString();
}

/** The public address of one tracked link. */
export function shortLinkUrl(ref: string, origin = siteOrigin()): string {
  return `${origin.replace(/\/+$/, "")}/s/${ref}`;
}

/**
 * Where following `/s/<ref>` actually lands, campaign attached.
 *
 * The campaign parameters are the whole tracking mechanism. Nothing is written
 * here: the page the visitor arrives on records its own view, sees the
 * campaign in the query and files a first-party touch through machinery that
 * already exists. So a click on a share link is counted by the same ledger,
 * under the same consent rules, as every other visit — which is the only way
 * "shared 12 times and drove 3 bookings" and the traffic report can ever agree
 * with each other.
 */
export function destinationFor(input: {
  path: string;
  ref: string;
  channel: ShareChannel;
  origin?: string;
}): string | null {
  const base = canonicalShareUrl(input.path, input.origin ?? siteOrigin());
  if (base === null) return null;
  const url = new URL(base);
  url.searchParams.set("utm_source", input.channel);
  url.searchParams.set("utm_medium", SHARE_MEDIUM);
  url.searchParams.set("utm_campaign", campaignFor(input.ref));
  return url.toString();
}
