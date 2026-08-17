// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Turning a block tree into a list of sentences, and back (MASTER.md §4.9).
//
// §4.9 stores a translation as the *fields that differ*, and for a page those
// fields include the whole block tree. Handing an owner a jsonb blob and
// asking them to translate the strings inside it without disturbing the
// structure is not a feature, it is a trap: one stray brace and the tree fails
// its own validator, one edited `src` and the French page points at a missing
// image.
//
// So the tree is projected into a flat list of translatable strings and the
// translation is projected back onto a *copy of the source tree*. Two
// consequences fall out of that, and both are the point:
//
//   - **Structure cannot drift.** The translated tree is the source tree with
//     strings replaced. A block cannot be added, removed or reordered in one
//     language only, which is exactly the "parallel site somebody has to keep
//     in step" that §4.9's one-entity-many-locales model exists to prevent.
//   - **Only words are offered.** Which props are words is not a list kept
//     here — it is `deriveFields`, the same derivation the editor draws its
//     controls from. A plugin's block becomes translatable when it declares a
//     string field, with no change to this file (§24).
//
// An asset field is a string and is deliberately *not* translatable: a
// different image per locale is a real thing to want, and it is not this.
import { getBlock } from "./blocks/registry";
import { deriveFields, type FieldDescriptor } from "./blocks/fields";
import type { BlockNode } from "./blocks/types";

/** One string an owner is asked to translate, and where it came from. */
export interface TranslatableString {
  /**
   * Where the value lives, as a JSON pointer-ish path of keys and indices.
   * Opaque to the screen: it round-trips as the name of an input.
   */
  path: (string | number)[];
  /** The source-language text. */
  value: string;
  /** `heading`, `text` — for grouping the screen by block. */
  blockType?: string;
  /** The prop's name, for a label beside the box. */
  field: string;
  /** True when it wants a textarea rather than a line. */
  multiline: boolean;
}

/** A path, as one string. Stable enough to be a form field name. */
export function pathKey(path: (string | number)[]): string {
  return path.map(String).join(".");
}

function collectFromProps(
  props: Record<string, unknown>,
  fields: FieldDescriptor[],
  base: (string | number)[],
  blockType: string,
  out: TranslatableString[],
): void {
  for (const field of fields) {
    const value = props[field.name];

    if (field.kind === "rich") {
      collectRichStrings(value, [...base, field.name], blockType, field.name, out);
      continue;
    }

    if (field.kind === "text" || field.kind === "multiline") {
      // An empty string is not offered: there is nothing to translate, and a
      // row of blank boxes is how a screen stops being read.
      if (typeof value === "string" && value.trim() !== "") {
        out.push({
          path: [...base, field.name],
          value,
          blockType,
          field: field.name,
          multiline: field.kind === "multiline",
        });
      }
      continue;
    }

    if (field.kind === "list" && Array.isArray(value) && field.itemFields) {
      value.forEach((item, index) => {
        if (item && typeof item === "object") {
          collectFromProps(
            item as Record<string, unknown>,
            field.itemFields!,
            [...base, field.name, index],
            blockType,
            out,
          );
        }
      });
    }
    // asset, boolean, choice: not words.
  }
}

function collectRichStrings(
  value: unknown,
  base: (string | number)[],
  blockType: string,
  field: string,
  out: TranslatableString[],
): void {
  if (!Array.isArray(value)) return;
  const walkInlines = (nodes: unknown[], path: (string | number)[]) => {
    nodes.forEach((node, index) => {
      if (!node || typeof node !== "object") return;
      const record = node as { type?: string; text?: string; children?: unknown };
      if (record.type === "text" && typeof record.text === "string" && record.text.trim()) {
        out.push({
          path: [...path, index, "text"],
          value: record.text,
          blockType,
          field,
          multiline: true,
        });
      }
      if (record.type === "link" && Array.isArray(record.children)) {
        walkInlines(record.children, [...path, index, "children"]);
      }
    });
  };
  value.forEach((block, index) => {
    if (!block || typeof block !== "object") return;
    const record = block as { type?: string; children?: unknown };
    if (!Array.isArray(record.children)) return;
    if (record.type === "paragraph") {
      walkInlines(record.children, [...base, index, "children"]);
      return;
    }
    record.children.forEach((item, itemIndex) => {
      if (!item || typeof item !== "object") return;
      const listItem = item as { children?: unknown };
      if (Array.isArray(listItem.children)) {
        walkInlines(listItem.children, [...base, index, "children", itemIndex, "children"]);
      }
    });
  });
}

/**
 * Every translatable string in a tree, in the order it appears on the page.
 *
 * Reading order matters more than it sounds: a translator working down a list
 * that matches the page can tell a heading from the caption under it, and one
 * working down a list in schema order cannot.
 */
export function translatableStrings(nodes: BlockNode[]): TranslatableString[] {
  const out: TranslatableString[] = [];
  const walk = (list: BlockNode[], base: (string | number)[]) => {
    list.forEach((node, index) => {
      const definition = getBlock(node.type);
      if (definition) {
        collectFromProps(
          node.props,
          deriveFields(node.type, definition.schema, definition.fieldHints),
          [...base, index, "props"],
          node.type,
          out,
        );
      }
      if (node.children) walk(node.children, [...base, index, "children"]);
    });
  };
  walk(nodes, []);
  return out;
}

/**
 * The source tree with translated strings substituted in.
 *
 * Only paths this function was *given* are touched, and only where the source
 * still holds a string — so a translation written before a block was edited
 * lands where it still fits and is ignored where it no longer does, rather
 * than writing a translated sentence over a structure that changed underneath
 * it. Anything untranslated keeps the source words, which is what makes a
 * half-finished translation a readable page instead of a page with holes.
 */
export function applyTranslations(
  nodes: BlockNode[],
  values: Record<string, string>,
): BlockNode[] {
  // A deep copy, because the source tree belongs to the page and this is the
  // translated one. Structured clone semantics are enough: a parsed tree is
  // JSON.
  const copy = JSON.parse(JSON.stringify(nodes)) as BlockNode[];

  for (const [key, replacement] of Object.entries(values)) {
    if (typeof replacement !== "string" || replacement.trim() === "") continue;
    const steps = key.split(".");
    let cursor: unknown = copy;
    for (let i = 0; i < steps.length - 1; i += 1) {
      if (cursor === null || typeof cursor !== "object") {
        cursor = undefined;
        break;
      }
      cursor = (cursor as Record<string, unknown>)[steps[i]!];
    }
    const last = steps[steps.length - 1]!;
    if (cursor && typeof cursor === "object") {
      const holder = cursor as Record<string, unknown>;
      // Only over a string. A path that now names an array or an object is a
      // path the tree outgrew.
      if (typeof holder[last] === "string") holder[last] = replacement;
    }
  }

  return copy;
}
