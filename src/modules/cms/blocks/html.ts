// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Owner-supplied HTML for the admin-only escape hatch (C2.07).
//
// Ordinary copy must stay typed (C2.05). This is the inconvenient remainder:
// a string field parsed as HTML and rebuilt from a narrow element/attribute
// allowlist. Parsing first matters: regex replacement cannot reason about
// malformed markup or character-reference encoded URL schemes the way a
// browser will.
import { parseFragment, type DefaultTreeAdapterTypes } from "parse5";

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

const DROP_WITH_CONTENT = new Set([
  "script",
  "style",
  "iframe",
  "object",
  "embed",
  "link",
]);
const VOID = new Set(["br", "hr"]);
const BASE = "https://freeholder.invalid/";

function text(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function attribute(value: string): string {
  return text(value).replace(/"/g, "&quot;");
}

function safeHref(value: string): string | undefined {
  const candidate = value.trim();
  if (!candidate || /[\u0000-\u001f\u007f]/.test(candidate)) return undefined;
  try {
    const protocol = new URL(candidate, BASE).protocol;
    if (!["http:", "https:", "mailto:", "tel:"].includes(protocol)) return undefined;
    return candidate;
  } catch {
    return undefined;
  }
}

function render(nodes: DefaultTreeAdapterTypes.ChildNode[]): string {
  return nodes.map((node) => {
    if ("value" in node && typeof node.value === "string") return text(node.value);
    if (!("tagName" in node)) return "";
    const tag = node.tagName.toLowerCase();
    if (DROP_WITH_CONTENT.has(tag)) return "";
    const children = render(node.childNodes);
    if (!ALLOWED.has(tag)) return children;
    if (VOID.has(tag)) return `<${tag}>`;
    if (tag !== "a") return `<${tag}>${children}</${tag}>`;
    const rawHref = node.attrs.find((entry) => entry.name.toLowerCase() === "href")?.value;
    const href = rawHref === undefined ? undefined : safeHref(rawHref);
    return `<a${href ? ` href="${attribute(href)}"` : ""}>${children}</a>`;
  }).join("");
}

export function sanitizeOwnerHtml(input: string): string {
  return render(parseFragment(input).childNodes);
}
