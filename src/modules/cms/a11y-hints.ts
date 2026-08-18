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
  | "videoMissing";

export type A11ySeverity = "error" | "warning";

export interface A11yHint {
  code: A11yCode;
  severity: A11ySeverity;
  blockId?: string;
}

export type A11yContext = "page" | "chrome" | "email";

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
  return "This page has more than one H1. Keep a single title heading.";
}
