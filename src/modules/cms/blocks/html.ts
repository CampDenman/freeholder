// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Owner-supplied HTML for the admin-only escape hatch (C2.07).
//
// Ordinary copy must stay typed (C2.05). This is the inconvenient remainder:
// a string field, stripped of script and event handlers, rendered only after
// that strip. It is not a sanitizer a security team would ship as a product —
// it is the minimum that keeps a paste from becoming a script tag.
const ALLOWED = new Set([
  "a",
  "blockquote",
  "br",
  "code",
  "div",
  "em",
  "figcaption",
  "figure",
  "h2",
  "h3",
  "h4",
  "hr",
  "i",
  "li",
  "ol",
  "p",
  "pre",
  "span",
  "strong",
  "ul",
]);

export function sanitizeOwnerHtml(input: string): string {
  const withoutBlocks = input
    .replace(/<script\b[\s\S]*?<\/script>/gi, "")
    .replace(/<style\b[\s\S]*?<\/style>/gi, "")
    .replace(/<iframe\b[\s\S]*?<\/iframe>/gi, "")
    .replace(/<object\b[\s\S]*?<\/object>/gi, "")
    .replace(/<embed\b[^>]*>/gi, "")
    .replace(/<link\b[^>]*>/gi, "")
    .replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/javascript:/gi, "");

  return withoutBlocks.replace(/<\/?([a-z][a-z0-9]*)\b([^>]*)>/gi, (full, rawTag: string, attrs: string) => {
    const tag = rawTag.toLowerCase();
    if (!ALLOWED.has(tag)) return "";
    if (full.startsWith("</")) return `</${tag}>`;
    if (tag === "br" || tag === "hr") return `<${tag}>`;
    if (tag === "a") {
      const href = attrs.match(/\bhref\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/i);
      const value = (href?.[2] ?? href?.[3] ?? href?.[4] ?? "").trim();
      if (!value || /^javascript:/i.test(value)) return "<a>";
      const safe = value.replace(/"/g, "");
      return `<a href="${safe}">`;
    }
    return `<${tag}>`;
  });
}
