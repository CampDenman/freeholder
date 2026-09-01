// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Per-channel share intents (MASTER.md §34, C9.28).
//
// §34 asks for "per-channel share intents (native Web Share API on mobile,
// channel links on desktop, copy-with-attribution)". This file is all three,
// as pure functions over a URL and a title — no database, no request, no React
// — for two reasons worth stating.
//
// The first is testability: a wrong `?text=` parameter is invisible until
// somebody's post arrives with the title missing, and a function that takes a
// string and returns a string can be asserted on without a browser.
//
// The second is safety, and it is the important one. A share button navigates
// the visitor somewhere off-site, which is the exact shape of an open redirect.
// The destination is therefore never assembled from anything the caller sent:
// it is chosen from this fixed map by an enum, and the only caller-supplied
// values are *inside* an encoded query parameter. There is no input to this
// module that can change which host the visitor lands on.
import { z } from "zod";

/**
 * The channels an entity may be shared to.
 *
 * `link` is copy-with-attribution and `native` is the Web Share API — both are
 * channels in exactly the sense that matters here, because both mint a tracked
 * link and both are something an owner may want to allow or refuse per entity.
 * Leaving them out of the enum would have made the per-entity control able to
 * describe eight of the ten ways somebody actually shares things.
 */
export const SHARE_CHANNELS = [
  "link",
  "native",
  "email",
  "sms",
  "whatsapp",
  "facebook",
  "x",
  "linkedin",
  "reddit",
  "telegram",
] as const;

export type ShareChannel = (typeof SHARE_CHANNELS)[number];

export const shareChannelSchema = z.enum(SHARE_CHANNELS);

/**
 * Channels that stay on this instance.
 *
 * `link` hands the URL back for the visitor to copy and `native` hands it to
 * the operating system's own share sheet. Neither has an off-site address, and
 * a caller that treated `intentUrl === null` as an error would have broken the
 * two channels most people actually use on a phone.
 */
const ON_SITE: ReadonlySet<ShareChannel> = new Set<ShareChannel>(["link", "native"]);

export function isOnSiteChannel(channel: ShareChannel): boolean {
  return ON_SITE.has(channel);
}

/**
 * The text that travels with the link.
 *
 * "Copy-with-attribution" is §34's phrase and this is the attribution: the
 * thing's own name and the business's, so a link pasted into a group chat
 * still says whose work it is when the preview card fails to load — which it
 * does, constantly, in exactly the messaging apps people share into.
 */
export function shareText(title: string, siteName?: string | null): string {
  const trimmed = title.trim();
  const site = siteName?.trim();
  if (!site || site === trimmed) return trimmed;
  return `${trimmed} — ${site}`;
}

/**
 * Where a channel button sends somebody, or null when the channel is ours.
 *
 * Every branch is a literal host. That is the point: nothing a visitor or an
 * API caller can send reaches the origin of the returned URL.
 */
export function intentUrl(
  channel: ShareChannel,
  url: string,
  text: string,
): string | null {
  const u = encodeURIComponent(url);
  const t = encodeURIComponent(text);
  const both = encodeURIComponent(`${text} ${url}`);
  switch (channel) {
    case "link":
    case "native":
      return null;
    case "email":
      return `mailto:?subject=${t}&body=${both}`;
    case "sms":
      return `sms:?body=${both}`;
    case "whatsapp":
      return `https://wa.me/?text=${both}`;
    case "facebook":
      return `https://www.facebook.com/sharer/sharer.php?u=${u}`;
    case "x":
      return `https://x.com/intent/post?url=${u}&text=${t}`;
    case "linkedin":
      return `https://www.linkedin.com/sharing/share-offsite/?url=${u}`;
    case "reddit":
      return `https://www.reddit.com/submit?url=${u}&title=${t}`;
    case "telegram":
      return `https://t.me/share/url?url=${u}&text=${t}`;
  }
}

/**
 * The channels this entity offers, in a stable order.
 *
 * An empty allow-list means "every channel", so an owner who has never opened
 * the screen gets all of them and an owner who has ticked three gets three.
 * The order comes from `SHARE_CHANNELS` rather than from the stored array, so
 * the buttons do not rearrange themselves because somebody re-ticked a box.
 */
export function channelsFor(allowed: readonly string[]): ShareChannel[] {
  if (allowed.length === 0) return [...SHARE_CHANNELS];
  const wanted = new Set(allowed);
  return SHARE_CHANNELS.filter((channel) => wanted.has(channel));
}
