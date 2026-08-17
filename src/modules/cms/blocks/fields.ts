// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Deriving an edit form from a block's Zod schema (MASTER.md §24, §32).
//
// §24 promises that a plugin's new block "appears in the palette with zero
// editor changes". That is only true if the editor never learns about
// individual blocks — so it reads the schema instead, which the block already
// had to declare in order to be storable at all. One schema, three surfaces
// (§9): it validates the write, describes the API, and now draws the form.
//
// The derivation is deliberately conservative. A shape it does not recognise
// yields no field rather than a broken control, so an exotic plugin schema
// loses one input instead of taking the editor down with it — and the block
// still renders, because rendering never depended on this.
import type { z } from "zod";

export type FieldKind =
  | "text"
  | "multiline"
  | "rich"
  | "boolean"
  | "choice"
  | "list"
  | "asset";

export interface FieldChoice {
  value: string;
  /** Catalog key; the admin translates before handing these to the client. */
  labelKey: string;
}

export interface FieldDescriptor {
  name: string;
  kind: FieldKind;
  required: boolean;
  /** For `choice`. */
  choices?: FieldChoice[];
  /** For `list`: the shape of one item. */
  itemFields?: FieldDescriptor[];
  /** For `asset`. */
  assetKind?: "image" | "video";
}

/**
 * Per-field editing hints a block may declare.
 *
 * Everything the *form* needs beyond what a validator can say: that a string
 * is a paragraph rather than a line, or that a field is machinery the owner
 * should not be shown. Hints live on the block definition rather than in the
 * editor, so a plugin can carry its own without the editor knowing it exists.
 */
export interface FieldHint {
  /**
   * `asset` turns a string field into a picker over the media library. The
   * *derivation* still knows nothing about images — it only knows this field
   * names something the editor should offer a chooser for, which is why a
   * plugin can ask for one without touching the editor (§24).
   */
  control?: "multiline" | "asset" | "rich";
  /** When `control` is `asset`, limit the picker to one media kind. */
  assetKind?: "image" | "video";
  hidden?: boolean;
}

/** The parts of a Zod schema this reads, named rather than reached for as `any`. */
interface ZodInternals {
  def?: {
    type?: string;
    innerType?: unknown;
    element?: unknown;
    shape?: Record<string, unknown>;
    entries?: Record<string, unknown>;
    options?: unknown[];
    values?: unknown[];
  };
}

const internals = (schema: unknown): ZodInternals["def"] =>
  (schema as ZodInternals).def;

/**
 * Strip the wrappers that describe *optionality* rather than shape.
 *
 * `z.string().default("x")` is a ZodDefault around a ZodString; the form wants
 * the string. Whether a default exists is separately interesting, so it comes
 * back alongside.
 */
function unwrap(schema: unknown): { inner: unknown; optional: boolean } {
  let current = schema;
  let optional = false;
  for (let depth = 0; depth < 6; depth += 1) {
    const def = internals(current);
    if (!def) break;
    if (def.type === "default" || def.type === "optional" || def.type === "nullable") {
      optional = true;
      current = def.innerType;
      continue;
    }
    break;
  }
  return { inner: current, optional };
}

/** The literal values a union of literals admits, or undefined if it is not one. */
function literalChoices(def: NonNullable<ZodInternals["def"]>): string[] | undefined {
  if (def.type !== "union" || !Array.isArray(def.options)) return undefined;
  const values: string[] = [];
  for (const option of def.options) {
    const optionDef = internals(option);
    if (optionDef?.type !== "literal" || !Array.isArray(optionDef.values)) {
      return undefined;
    }
    for (const value of optionDef.values) {
      if (typeof value !== "string" && typeof value !== "number") return undefined;
      values.push(String(value));
    }
  }
  return values.length > 0 ? values : undefined;
}

function describeField(
  name: string,
  schema: unknown,
  hint: FieldHint | undefined,
  blockType: string,
): FieldDescriptor | undefined {
  if (hint?.hidden) return undefined;
  if (hint?.control === "rich") {
    return { name, kind: "rich", required: false };
  }

  const { inner, optional } = unwrap(schema);
  const def = internals(inner);
  if (!def?.type) return undefined;

  const base = { name, required: !optional };

  if (def.type === "string") {
    if (hint?.control === "asset") {
      return { ...base, kind: "asset", assetKind: hint.assetKind };
    }
    return { ...base, kind: hint?.control === "multiline" ? "multiline" : "text" };
  }
  if (def.type === "boolean") {
    return { ...base, kind: "boolean" };
  }
  if (def.type === "enum" && def.entries) {
    return {
      ...base,
      kind: "choice",
      choices: Object.keys(def.entries).map((value) => ({
        value,
        labelKey: `cms.choice.${name}.${value}`,
      })),
    };
  }

  const union = literalChoices(def);
  if (union) {
    return {
      ...base,
      kind: "choice",
      choices: union.map((value) => ({
        value,
        labelKey: `cms.choice.${name}.${value}`,
      })),
    };
  }

  if (def.type === "array") {
    const { inner: element } = unwrap(def.element);
    const elementDef = internals(element);
    if (elementDef?.type !== "object" || !elementDef.shape) return undefined;
    const itemFields = Object.entries(elementDef.shape)
      .map(([key, value]) => describeField(key, value, undefined, blockType))
      .filter((field): field is FieldDescriptor => field !== undefined);
    if (itemFields.length === 0) return undefined;
    return { ...base, kind: "list", itemFields };
  }

  // Numbers, objects, records, anything else: no control rather than a wrong
  // one. The block keeps working; only this input is missing from the form.
  return undefined;
}

/** The editable fields of one block, in the order the schema declares them. */
export function deriveFields(
  blockType: string,
  schema: z.ZodType,
  hints: Record<string, FieldHint> = {},
): FieldDescriptor[] {
  const shape = internals(schema)?.shape;
  if (!shape) return [];
  return Object.entries(shape)
    .map(([name, field]) => describeField(name, field, hints[name], blockType))
    .filter((field): field is FieldDescriptor => field !== undefined);
}
