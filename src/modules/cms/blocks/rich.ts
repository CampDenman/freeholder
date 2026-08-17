// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Constrained typed rich text (MASTER.md C2.05).
//
// Stored as a Zod-validated JSON document, never as HTML. The renderer is
// the only thing that produces tags, which is what keeps SEO, migrations and
// re-theming possible. A string that already looks like markup is refused on
// write so the soup cannot sneak in through a textarea.
import { z } from "zod";

export const RICH_MARKS = ["strong", "em", "code"] as const;
export type RichMark = (typeof RICH_MARKS)[number];

export type RichTextSpan = {
  type: "text";
  text: string;
  marks?: RichMark[];
};

export type RichLinkSpan = {
  type: "link";
  href: string;
  children: RichTextSpan[];
};

export type RichInline = RichTextSpan | RichLinkSpan;

export type RichParagraph = { type: "paragraph"; children: RichInline[] };
export type RichListItem = { type: "listItem"; children: RichInline[] };
export type RichBulletList = { type: "bulletList"; children: RichListItem[] };
export type RichOrderedList = { type: "orderedList"; children: RichListItem[] };
export type RichBlock = RichParagraph | RichBulletList | RichOrderedList;
export type RichDoc = RichBlock[];

const HTML_TAG = /<\/?[a-zA-Z][^>]*>/;

export function looksLikeHtml(value: string): boolean {
  return HTML_TAG.test(value);
}

const marksSchema = z
  .array(z.enum(RICH_MARKS))
  .max(3)
  .transform((marks) => [...new Set(marks)])
  .optional();

const textSpanSchema = z.object({
  type: z.literal("text"),
  text: z.string().max(20_000),
  marks: marksSchema,
});

const linkSpanSchema = z.object({
  type: z.literal("link"),
  href: z
    .string()
    .trim()
    .min(1)
    .max(2048)
    .refine((href) => !/^\s*javascript:/i.test(href), "links cannot run script"),
  children: z.array(textSpanSchema).min(1).max(40),
});

const inlineSchema = z.discriminatedUnion("type", [textSpanSchema, linkSpanSchema]);

const listItemSchema = z.object({
  type: z.literal("listItem"),
  children: z.array(inlineSchema).min(1).max(80),
});

const paragraphSchema = z.object({
  type: z.literal("paragraph"),
  children: z.array(inlineSchema).min(1).max(80),
});

const bulletListSchema = z.object({
  type: z.literal("bulletList"),
  children: z.array(listItemSchema).min(1).max(80),
});

const orderedListSchema = z.object({
  type: z.literal("orderedList"),
  children: z.array(listItemSchema).min(1).max(80),
});

export const richBlockSchema = z.discriminatedUnion("type", [
  paragraphSchema,
  bulletListSchema,
  orderedListSchema,
]);

export const richDocSchema = z.array(richBlockSchema).min(1).max(200);

export function paragraphFromPlain(text: string): RichParagraph {
  return {
    type: "paragraph",
    children: [{ type: "text", text: text.length > 0 ? text : " " }],
  };
}

export function fromPlainString(value: string): RichDoc {
  const paragraphs = value
    .split(/\n{2,}/)
    .map((part) => part.replace(/\n/g, " ").trim())
    .filter(Boolean);
  if (paragraphs.length === 0) return [paragraphFromPlain(" ")];
  return paragraphs.map(paragraphFromPlain);
}

export function toPlainText(doc: RichDoc): string {
  const inlineText = (nodes: RichInline[]): string =>
    nodes
      .map((node) => (node.type === "text" ? node.text : inlineText(node.children)))
      .join("");
  const parts: string[] = [];
  for (const block of doc) {
    if (block.type === "paragraph") {
      parts.push(inlineText(block.children));
      continue;
    }
    for (const item of block.children) parts.push(inlineText(item.children));
  }
  return parts.join("\n\n");
}

export class RichValidationError extends Error {}

/**
 * Accept a stored value as a rich document.
 *
 * `strict` is the write path: HTML soup is refused. `lenient` is the read
 * path for rows saved before this schema existed — a leftover string becomes
 * paragraphs, and a leftover HTML string is kept as *text*, never parsed as
 * markup.
 */
export function parseRichDoc(
  value: unknown,
  mode: "strict" | "lenient" = "strict",
): RichDoc {
  if (typeof value === "string") {
    if (looksLikeHtml(value)) {
      if (mode === "strict") {
        throw new RichValidationError(
          "Rich text cannot be stored as HTML. Use emphasis, links, code and lists.",
        );
      }
      return [paragraphFromPlain(value)];
    }
    const doc = fromPlainString(value);
    return richDocSchema.parse(doc);
  }
  const parsed = richDocSchema.safeParse(value);
  if (!parsed.success) {
    if (mode === "lenient") return [paragraphFromPlain(toFallbackPlain(value))];
    throw new RichValidationError("That is not a typed rich-text document.");
  }
  return parsed.data;
}

function toFallbackPlain(value: unknown): string {
  if (typeof value === "string") return value;
  return " ";
}

function encodeInlines(nodes: RichInline[]): string {
  return nodes
    .map((node) => {
      if (node.type === "link") {
        return `[${encodeInlines(node.children)}](${node.href})`;
      }
      let text = node.text.replace(/[\[\]*`]/g, (ch) => `\\${ch}`);
      if (node.marks?.includes("code")) text = `\`${text}\``;
      if (node.marks?.includes("strong")) text = `**${text}**`;
      if (node.marks?.includes("em")) text = `*${text}*`;
      return text;
    })
    .join("");
}

/** Owner-facing markup. Storage stays typed JSON; this is only the form. */
export function toEditorMarkup(doc: RichDoc): string {
  return doc
    .map((block) => {
      if (block.type === "paragraph") return encodeInlines(block.children);
      const prefix = block.type === "orderedList" ? "1. " : "- ";
      return block.children.map((item) => `${prefix}${encodeInlines(item.children)}`).join("\n");
    })
    .join("\n\n");
}

function parseInlines(input: string): RichInline[] {
  const out: RichInline[] = [];
  const source = input;
  let i = 0;
  const pushText = (text: string, marks?: RichMark[]) => {
    if (!text) return;
    out.push(marks?.length ? { type: "text", text, marks } : { type: "text", text });
  };
  while (i < source.length) {
    if (source.startsWith("[", i)) {
      const close = source.indexOf("](", i);
      const end = close === -1 ? -1 : source.indexOf(")", close + 2);
      if (close > i && end > close) {
        const label = source.slice(i + 1, close);
        const href = source.slice(close + 2, end);
        if (href && !looksLikeHtml(href)) {
          out.push({
            type: "link",
            href,
            children: [{ type: "text", text: label || href }],
          });
          i = end + 1;
          continue;
        }
      }
    }
    if (source.startsWith("**", i)) {
      const close = source.indexOf("**", i + 2);
      if (close > i + 1) {
        pushText(source.slice(i + 2, close), ["strong"]);
        i = close + 2;
        continue;
      }
    }
    if (source.startsWith("`", i)) {
      const close = source.indexOf("`", i + 1);
      if (close > i) {
        pushText(source.slice(i + 1, close), ["code"]);
        i = close + 1;
        continue;
      }
    }
    if (source.startsWith("*", i) && !source.startsWith("**", i)) {
      const close = source.indexOf("*", i + 1);
      if (close > i) {
        pushText(source.slice(i + 1, close), ["em"]);
        i = close + 1;
        continue;
      }
    }
    const next = source.slice(i).search(/(\[|\*\*|`|\*)/);
    const take = next === -1 ? source.length - i : next;
    pushText(source.slice(i, i + Math.max(take, 1)));
    i += Math.max(take, 1);
  }
  return out.length > 0 ? out : [{ type: "text", text: " " }];
}

export function fromEditorMarkup(value: string): RichDoc {
  if (looksLikeHtml(value)) {
    throw new RichValidationError(
      "Rich text cannot be stored as HTML. Use emphasis, links, code and lists.",
    );
  }
  const chunks = value.split(/\n{2,}/);
  const blocks: RichBlock[] = [];
  for (const chunk of chunks) {
    const lines = chunk.split("\n").map((line) => line.trimEnd());
    if (lines.every((line) => /^\s*[-*]\s+/.test(line))) {
      blocks.push({
        type: "bulletList",
        children: lines.map((line) => ({
          type: "listItem" as const,
          children: parseInlines(line.replace(/^\s*[-*]\s+/, "")),
        })),
      });
      continue;
    }
    if (lines.every((line) => /^\s*\d+\.\s+/.test(line))) {
      blocks.push({
        type: "orderedList",
        children: lines.map((line) => ({
          type: "listItem" as const,
          children: parseInlines(line.replace(/^\s*\d+\.\s+/, "")),
        })),
      });
      continue;
    }
    const text = lines.join(" ").trim();
    if (!text) continue;
    blocks.push({ type: "paragraph", children: parseInlines(text) });
  }
  return richDocSchema.parse(blocks.length > 0 ? blocks : fromPlainString(" "));
}

/** Zod field: strings coerce to paragraphs; HTML soup fails the write. */
export const richBodySchema = z.unknown().transform((value, ctx) => {
  try {
    return parseRichDoc(value, "strict");
  } catch (error) {
    ctx.addIssue({
      code: "custom",
      message: error instanceof Error ? error.message : "invalid rich text",
    });
    return z.NEVER;
  }
});
