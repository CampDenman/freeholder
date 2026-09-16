// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Per-page accessibility hints from a block tree (C2.20).
//
// The editor shows these as the owner works. Publish refuses the error
// severity so a drag-and-drop cannot ship a page that fails the SEO gate.
import type { BlockNode } from "./blocks/types";

export type A11yCode =
  | "missingH1"
  | "multipleH1"
  | "headingOrder"
  | "imageMissing"
  | "imageAltUnset"
  | "vagueLink"
  | "emptyHref"
  | "htmlImage"
  | "htmlLandmarks"
  | "videoMissing"
  // Popup-only (C9.30). Errors rather than warnings, because a popup is the
  // one surface a visitor did not ask for and `popups.setStatus` refuses to
  // make one live while either of them stands.
  | "popupH1"
  | "popupRawHtml";

export type A11ySeverity = "error" | "warning";

export interface A11yHint {
  code: A11yCode;
  severity: A11ySeverity;
  blockId?: string;
}

/**
 * Which rules apply to a tree.
 *
 * `popup` is the fourth (C9.30). It is an *analysis* context rather than a
 * storage one: a popup's blocks are validated and stored as `chrome`, because
 * chrome is already the answer to "content that is not the page" and adding a
 * fourth storage context would mean editing forty block definitions to state a
 * fact chrome already states. What a popup needs that chrome does not is a
 * different set of rules, and that is exactly what this type selects.
 */
export type A11yContext = "page" | "chrome" | "email" | "popup";

const VAGUE = new Set([
  "click here",
  "tap here",
  "here",
  "read more",
  "learn more",
  "more",
  "link",
  "click",
  "this link",
]);

function walk(nodes: BlockNode[], visit: (node: BlockNode) => void): void {
  for (const node of nodes) {
    visit(node);
    if (node.children?.length) walk(node.children, visit);
  }
}

function headingLevel(node: BlockNode): number | null {
  if (node.type !== "heading") return null;
  const level = Number(node.props.level);
  return [1, 2, 3, 4].includes(level) ? level : 2;
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function isVague(label: string): boolean {
  return VAGUE.has(label.trim().toLowerCase());
}

function hrefEmpty(href: string): boolean {
  const trimmed = href.trim();
  return trimmed.length === 0 || trimmed === "#";
}

function collectRichLinks(value: unknown, into: { text: string; href: string }[]): void {
  if (!Array.isArray(value)) return;
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const record = item as { type?: string; href?: string; children?: unknown[]; text?: string };
    if (record.type === "link" && typeof record.href === "string") {
      const text = Array.isArray(record.children)
        ? record.children
            .map((child) =>
              child && typeof child === "object" && "text" in child
                ? String((child as { text?: string }).text ?? "")
                : "",
            )
            .join("")
        : "";
      into.push({ text, href: record.href });
    }
    if (record.children) collectRichLinks(record.children, into);
  }
}

/**
 * Walk a stored tree and return the hints an owner can act on.
 *
 * Email skips the H1 rule: a letter is not a page. Chrome skips it too —
 * the header and footer must not steal the page title.
 */
export function analyzeAccessibility(
  nodes: BlockNode[],
  options: { context?: A11yContext } = {},
): A11yHint[] {
  const context = options.context ?? "page";
  const hints: A11yHint[] = [];
  const headings: { id: string; level: number }[] = [];

  walk(nodes, (node) => {
    const level = headingLevel(node);
    if (level !== null) headings.push({ id: node.id, level });

    if (node.type === "image") {
      const assetId = asString(node.props.assetId);
      const decorative = node.props.decorative === true;
      const alt = asString(node.props.alt).trim();
      if (!assetId) {
        hints.push({ code: "imageMissing", severity: "warning", blockId: node.id });
      } else if (!decorative && !alt) {
        hints.push({ code: "imageAltUnset", severity: "warning", blockId: node.id });
      }
    }

    if (node.type === "video" && !asString(node.props.assetId)) {
      hints.push({ code: "videoMissing", severity: "warning", blockId: node.id });
    }

    if (node.type === "button") {
      const label = asString(node.props.label);
      const href = asString(node.props.href);
      if (hrefEmpty(href)) {
        hints.push({ code: "emptyHref", severity: "warning", blockId: node.id });
      }
      if (isVague(label)) {
        hints.push({ code: "vagueLink", severity: "warning", blockId: node.id });
      }
    }

    if (node.type === "text") {
      const links: { text: string; href: string }[] = [];
      collectRichLinks(node.props.body, links);
      for (const link of links) {
        if (hrefEmpty(link.href)) {
          hints.push({ code: "emptyHref", severity: "warning", blockId: node.id });
        }
        if (isVague(link.text)) {
          hints.push({ code: "vagueLink", severity: "warning", blockId: node.id });
        }
      }
    }

    if (node.type === "html" && context === "popup") {
      // Refused outright inside a popup, and only inside a popup. A modal
      // dialog's promise is that the close control is reachable, focus stays
      // inside it and Escape works — and none of that can be promised about
      // markup the platform did not author. On a page, raw HTML is the
      // owner's own risk on their own surface; in a dialog it is a risk taken
      // on a visitor who did not ask for the dialog.
      hints.push({ code: "popupRawHtml", severity: "error", blockId: node.id });
    }

    if (node.type === "html") {
      const markup = asString(node.props.markup);
      if (/<img\b/i.test(markup) && !/\bsrcset\s*=/i.test(markup)) {
        hints.push({ code: "htmlImage", severity: "warning", blockId: node.id });
      }
      if (
        markup.trim() &&
        !/<(h[1-6]|nav|main|header|footer|section|article)\b/i.test(markup)
      ) {
        hints.push({ code: "htmlLandmarks", severity: "warning", blockId: node.id });
      }
    }
  });

  if (context === "page") {
    const h1s = headings.filter((row) => row.level === 1);
    if (h1s.length === 0) {
      hints.unshift({ code: "missingH1", severity: "error" });
    } else if (h1s.length > 1) {
      for (const extra of h1s.slice(1)) {
        hints.unshift({
          code: "multipleH1",
          severity: "error",
          blockId: extra.id,
        });
      }
    }

    let previous = 0;
    for (const heading of headings) {
      if (previous > 0 && heading.level > previous + 1) {
        hints.push({
          code: "headingOrder",
          severity: "warning",
          blockId: heading.id,
        });
      }
      previous = heading.level;
    }
  }

  if (context === "popup") {
    // A popup renders inside the document that is already showing a page, so
    // an H1 in it is a second H1 on that page — the exact failure the page
    // rule above exists to prevent, arriving from the one surface the page's
    // own editor never sees. The popup carries its own title as a column, and
    // the surface renders it as the dialog's H2.
    for (const heading of headings.filter((row) => row.level === 1)) {
      hints.unshift({ code: "popupH1", severity: "error", blockId: heading.id });
    }

    // The outline starts at the dialog's own H2, so a body opening with an H4
    // is a skip even though nothing above it is in this tree.
    let previous = 2;
    for (const heading of headings) {
      if (heading.level > previous + 1) {
        hints.push({
          code: "headingOrder",
          severity: "warning",
          blockId: heading.id,
        });
      }
      previous = heading.level;
    }
  }

  return hints;
}

export function a11yErrors(hints: A11yHint[]): A11yHint[] {
  return hints.filter((hint) => hint.severity === "error");
}

export function publishA11yMessage(hints: A11yHint[]): string | null {
  const first = a11yErrors(hints)[0];
  if (!first) return null;
  if (first.code === "missingH1") {
    return "This page needs exactly one H1 before it can be published.";
  }
  if (first.code === "popupH1") {
    return "A popup appears on a page that already has its H1. Use a heading level 2 or lower inside it.";
  }
  if (first.code === "popupRawHtml") {
    return "Custom HTML cannot go in a popup: nothing can promise the close button stays reachable inside markup the platform did not author.";
  }
  return "This page has more than one H1. Keep a single title heading.";
}
