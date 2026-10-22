// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Third-party creative tags (MASTER.md §4.16, C9.20).
//
// A creative of kind `html_tag` or `provider` carries somebody else's script,
// which means somebody else's tracking. The functions here do not decide
// whether that is allowed — the slot flag, the visitor's `fh_tc` cookie and
// the serving path do. They only keep the pasted markup from being an open
// redirect in disguise, build the sandboxed document a pasted tag runs in,
// and generate the one provider snippet this module knows how to write
// (Google Ad Manager via GPT), whose inline bootstrap is ours and so carries
// the request nonce.
//
// C11.10: a pasted `html_tag` is never written into this site's pages and
// never receives the nonce. Anyone holding the `ads` grant can paste one, and
// a nonce-carrying script in the page is same-origin code — it could act as
// whoever is viewing, the owner included. It runs instead in a frame whose
// origin is opaque (no `allow-same-origin`, enforced twice: by the iframe's
// `sandbox` attribute and by the document's own CSP `sandbox` directive), so
// it can draw and open the advertiser's page, and nothing else.
import { serializeInlineJson } from "@/core/http/inline-json";

/** No `allow-same-origin`, ever: that one token would undo the isolation. */
export const CREATIVE_FRAME_SANDBOX = "allow-scripts allow-popups allow-popups-to-escape-sandbox";

export function creativeFramePath(creativeId: string): string {
  return `/api/ads/creative/${encodeURIComponent(creativeId)}`;
}

/** The whole document a reviewed tag runs in, at its booked size. */
export function creativeDocument(html: string): string {
  return [
    "<!doctype html>",
    '<html><head><meta charset="utf-8">',
    "<style>html,body{margin:0;padding:0;overflow:hidden}</style>",
    `</head><body>${html}</body></html>`,
  ].join("");
}

/**
 * The creative document's own policy. `sandbox` makes its origin opaque even
 * when the address is opened directly rather than framed; the origin list is
 * the same `CSP_THIRD_PARTY_ORIGINS` allowlist the site already declares.
 */
export function creativeDocumentPolicy(origins: string[]): string {
  const allowed = origins.length > 0 ? ` ${origins.join(" ")}` : "";
  return [
    `sandbox ${CREATIVE_FRAME_SANDBOX}`,
    "default-src 'none'",
    `script-src 'unsafe-inline'${allowed}`,
    `style-src 'unsafe-inline'${allowed}`,
    `img-src data:${allowed}`,
    `font-src${allowed || " 'none'"}`,
    `media-src${allowed || " 'none'"}`,
    `connect-src${allowed || " 'none'"}`,
    `frame-src${allowed || " 'none'"}`,
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'self'",
  ].join("; ");
}

export const CREATIVE_KINDS = ["image", "native", "html_tag", "provider"] as const;
export type CreativeKind = (typeof CREATIVE_KINDS)[number];

export const THIRD_PARTY_KINDS = ["html_tag", "provider"] as const;
export type ThirdPartyKind = (typeof THIRD_PARTY_KINDS)[number];

export const TAG_HTML_MAX = 16_384;

export function isThirdPartyKind(kind: string): kind is ThirdPartyKind {
  return kind === "html_tag" || kind === "provider";
}

/**
 * The pasted tag, or null if it is empty, too large, or a javascript:/data:
 * document in disguise.
 *
 * Scripts are the feature, so this does not strip them. Review, the slot
 * flag, visitor consent and the CSP origin allowlist are what keep a pasted
 * tag from becoming a page that runs something nobody agreed to.
 */
export function reviewedTagHtml(html: string): string | null {
  const trimmed = html.trim();
  if (trimmed.length === 0 || trimmed.length > TAG_HTML_MAX) return null;
  if (/javascript\s*:/i.test(trimmed)) return null;
  if (/data\s*:\s*(?:text\/html|application\/javascript|text\/javascript)/i.test(trimmed)) {
    return null;
  }
  return trimmed;
}

/**
 * Put the request nonce on every `<script>` that does not already have one.
 * Only for markup this module generated (`providerMarkup`); never for a
 * pasted tag, which runs in its sandboxed frame instead.
 */
export function stampNonce(html: string, nonce: string): string {
  if (!nonce) return html;
  return html.replace(/<script\b([^>]*)>/gi, (match, attrs: string) => {
    if (/\bnonce\s*=/i.test(attrs)) return match;
    return `<script nonce="${nonce}"${attrs}>`;
  });
}

export interface ProviderSpec {
  network: string;
  unitPath: string;
  params?: Record<string, string>;
}

/** Ads.txt domain we can generate a tag for. Others use `html_tag`. */
export function knownProviderNetwork(network: string): boolean {
  const host = network.trim().toLowerCase();
  return host === "google.com" || host === "doubleclick.net";
}

/**
 * A GPT slot for Google Ad Manager / AdSense.
 *
 * The inline bootstrap needs the request nonce; `strict-dynamic` then lets
 * it load `gpt.js` from the origin listed in `CSP_THIRD_PARTY_ORIGINS`.
 */
export function providerMarkup(
  provider: ProviderSpec,
  size: { width: number; height: number },
  slotDomId: string,
): string | null {
  if (!knownProviderNetwork(provider.network)) return null;
  const unit = serializeInlineJson(provider.unitPath);
  const id = serializeInlineJson(slotDomId);
  const width = String(size.width);
  const height = String(size.height);
  return [
    `<script async src="https://securepubads.g.doubleclick.net/tag/js/gpt.js"></script>`,
    `<div id="${escapeAttr(slotDomId)}" style="width:${width}px;height:${height}px">`,
    `<script>`,
    `window.googletag = window.googletag || { cmd: [] };`,
    `googletag.cmd.push(function () {`,
    `  googletag.defineSlot(${unit}, [[${width}, ${height}]], ${id}).addService(googletag.pubads());`,
    `  googletag.enableServices();`,
    `  googletag.display(${id});`,
    `});`,
    `</script>`,
    `</div>`,
  ].join("");
}

function escapeAttr(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}
