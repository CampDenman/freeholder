// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Email-safe table HTML from a block tree (C2.19).
//
// Inboxes do not load the site stylesheet, so this file inlines token hex
// values. They still come from `colors.light` — never a one-off palette.
import type { BlockNode } from "./blocks/types";
import { colors } from "@/core/design/tokens";
import { EMAIL_VARIABLE_SLOTS } from "./blocks/library";

export const EMAIL_SLOTS = EMAIL_VARIABLE_SLOTS;

export type EmailVariables = Partial<Record<(typeof EMAIL_SLOTS)[number], string>>;

export const SAMPLE_EMAIL_VARIABLES: EmailVariables = {
  "contact.first_name": "Alex",
  "contact.email": "alex@example.com",
  "business.name": "Studio",
  "invoice.total": "$120.00",
  "booking.starts_at_local": "Thu 10:00",
};

export function fillSlots(value: string, vars: EmailVariables): string {
  // Built per call so a leftover lastIndex cannot skip a later string.
  return value.replace(/\{\{\s*([a-z0-9._]+)\s*\}\}/gi, (_match, slot: string) => {
    const key = slot.trim() as keyof EmailVariables;
    return vars[key] ?? `{{${key}}}`;
  });
}

function propString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const ink = colors.light.ink;
const paper = colors.light.paper;
const surface = colors.light.surface;
const rule = colors.light.rule;
const accent = colors.light.accent;
const onAccent = colors.light.onAccent;

function cell(inner: string, style = ""): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td style="padding:12px 0;font-family:Georgia,serif;font-size:16px;line-height:1.5;color:${ink};${style}">${inner}</td></tr></table>`;
}

function richToHtml(value: unknown, vars: EmailVariables): string {
  if (typeof value === "string") return escapeHtml(fillSlots(value, vars)).replace(/\n/g, "<br>");
  if (!Array.isArray(value)) return "";
  return value
    .map((block) => {
      if (!block || typeof block !== "object") return "";
      const record = block as { type?: string; children?: unknown[] };
      if (record.type === "paragraph") {
        return `<p style="margin:0 0 12px;">${inlinesToHtml(record.children ?? [], vars)}</p>`;
      }
      return "";
    })
    .join("");
}

function inlinesToHtml(nodes: unknown[], vars: EmailVariables): string {
  return nodes
    .map((node) => {
      if (!node || typeof node !== "object") return "";
      const record = node as { type?: string; text?: string; href?: string; children?: unknown[]; marks?: string[] };
      if (record.type === "link" && record.href) {
        return `<a href="${escapeHtml(record.href)}">${inlinesToHtml(record.children ?? [], vars)}</a>`;
      }
      let text = escapeHtml(fillSlots(record.text ?? "", vars));
      if (record.marks?.includes("strong")) text = `<strong>${text}</strong>`;
      if (record.marks?.includes("em")) text = `<em>${text}</em>`;
      return text;
    })
    .join("");
}

function richToText(value: unknown, vars: EmailVariables): string {
  if (typeof value === "string") return fillSlots(value, vars);
  if (!Array.isArray(value)) return "";
  return value
    .map((block) => {
      if (!block || typeof block !== "object") return "";
      const record = block as { type?: string; children?: unknown[] };
      return inlinesToText(record.children ?? [], vars);
    })
    .filter(Boolean)
    .join("\n\n");
}

function inlinesToText(nodes: unknown[], vars: EmailVariables): string {
  return nodes
    .map((node) => {
      if (!node || typeof node !== "object") return "";
      const record = node as { type?: string; text?: string; children?: unknown[] };
      if (record.type === "link") return inlinesToText(record.children ?? [], vars);
      return fillSlots(record.text ?? "", vars);
    })
    .join("");
}

export function renderEmailHtml(nodes: BlockNode[], vars: EmailVariables = {}): string {
  const rows = nodes.map((node) => renderNodeHtml(node, vars)).filter(Boolean);
  return `<!doctype html><html><body style="margin:0;padding:16px;background:${paper};"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center"><table role="presentation" width="560" cellpadding="0" cellspacing="0" style="background:${surface};padding:16px;">${rows.join("")}</table></td></tr></table></body></html>`;
}

function renderNodeHtml(node: BlockNode, vars: EmailVariables): string {
  if (node.type === "heading") {
    const text = escapeHtml(fillSlots(propString(node.props.text), vars));
    const level = [1, 2, 3, 4].includes(Number(node.props.level))
      ? Number(node.props.level)
      : 1;
    const size = { 1: 24, 2: 20, 3: 18, 4: 16 }[level];
    return cell(`<h${level} style="margin:0;font-size:${size}px;">${text}</h${level}>`);
  }
  if (node.type === "text") return cell(richToHtml(node.props.body, vars));
  if (node.type === "button") {
    const label = escapeHtml(fillSlots(propString(node.props.label), vars));
    const href = escapeHtml(fillSlots(propString(node.props.href, "#"), vars));
    return cell(
      `<a href="${href}" style="display:inline-block;background:${accent};color:${onAccent};padding:10px 16px;text-decoration:none;border-radius:6px;">${label}</a>`,
    );
  }
  if (node.type === "divider") return cell(`<hr style="border:0;border-top:1px solid ${rule};">`);
  if (node.type === "spacer") {
    const height = { s: 12, m: 24, l: 40 }[String(node.props.size) as "s" | "m" | "l"] ?? 24;
    return `<table role="presentation" width="100%"><tr><td style="height:${height}px;line-height:${height}px;">&nbsp;</td></tr></table>`;
  }
  if (node.type === "variable") {
    const slot = propString(node.props.slot);
    return cell(escapeHtml(fillSlots(`{{${slot}}}`, vars)));
  }
  if (node.type === "image") return cell("");
  if (node.children?.length) {
    return node.children.map((child) => renderNodeHtml(child, vars)).join("");
  }
  return "";
}

export function renderEmailText(nodes: BlockNode[], vars: EmailVariables = {}): string {
  return nodes
    .map((node) => {
      if (node.type === "heading") return fillSlots(propString(node.props.text), vars);
      if (node.type === "text") return richToText(node.props.body, vars);
      if (node.type === "button") {
        return `${fillSlots(propString(node.props.label), vars)} ${fillSlots(propString(node.props.href), vars)}`;
      }
      if (node.type === "variable") return fillSlots(`{{${propString(node.props.slot)}}}`, vars);
      if (node.children?.length) return renderEmailText(node.children, vars);
      return "";
    })
    .filter(Boolean)
    .join("\n\n");
}
