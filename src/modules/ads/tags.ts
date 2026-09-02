// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Third-party creative tags (MASTER.md §4.16, C9.20).
//
// A creative of kind `html_tag` or `provider` carries somebody else's script,
// which means somebody else's tracking. The functions here do not decide
// whether that is allowed — the slot flag, the visitor's `fh_tc` cookie and
// the serving path do. They only keep the pasted markup from being an open
// redirect in disguise, stamp the request nonce so a reviewed inline script
// can run under the strict CSP, and generate the one provider snippet this
// module knows how to write (Google Ad Manager via GPT).

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

/** Put the request nonce on every `<script>` that does not already have one. */
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
  const unit = JSON.stringify(provider.unitPath);
  const id = JSON.stringify(slotDomId);
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
