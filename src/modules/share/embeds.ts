// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Copy-paste embed snippets with a backlink (MASTER.md §34, C9.36).
//
// The iframe is the widget. The `<a>` beside it is the SEO: content that
// lands on someone else's site still points home. Escaping is the whole
// safety of a snippet an owner will paste into a CMS they do not control.
import { siteOrigin } from "@/core/seo/origin";

export const EMBED_KINDS = ["reviews", "booking", "newsletter", "gallery"] as const;
export type EmbedKind = (typeof EMBED_KINDS)[number];

export function escapeEmbedText(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function embedPath(kind: EmbedKind, id?: string | null): string {
  if (kind === "newsletter" || kind === "gallery") {
    if (!id) throw new Error("That embed needs an id.");
    return `/embed/${kind}/${encodeURIComponent(id)}`;
  }
  return `/embed/${kind}`;
}

export function embedCanonical(kind: EmbedKind, id?: string | null): string {
  if (kind === "gallery" && id) return `/g/${encodeURIComponent(id)}`;
  if (kind === "newsletter") return "/";
  if (kind === "booking") return "/contact";
  return "/";
}

export function embedSnippet(input: {
  kind: EmbedKind;
  id?: string | null;
  businessName: string;
  title: string;
}): { src: string; backlink: string; html: string; title: string } {
  const origin = siteOrigin();
  const path = embedPath(input.kind, input.id);
  const src = `${origin}${path}`;
  const href = `${origin}${embedCanonical(input.kind, input.id)}`;
  const title = escapeEmbedText(input.title);
  const name = escapeEmbedText(input.businessName);
  const backlink = `<a href="${escapeEmbedText(href)}">${name}</a>`;
  const html = [
    `<iframe src="${escapeEmbedText(src)}" title="${title}" loading="lazy" referrerpolicy="strict-origin-when-cross-origin" style="width:100%;min-height:20rem;border:0"></iframe>`,
    `<p>${backlink}</p>`,
  ].join("\n");
  return { src, backlink: href, html, title: input.title };
}
