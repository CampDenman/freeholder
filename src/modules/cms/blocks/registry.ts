// Copyright (C) 2026 Camp Denman Society
// SPDX-License-Identifier: AGPL-3.0-only
// The block registry — the single list of what the vocabulary contains.
//
// Everything else about blocks is derived from this: the validator that guards
// every write, the editor palette, and (when plugins land, §24) the merge point
// where a plugin's block types join without the editor changing. One source,
// several projections — the same shape as the service registry in §28.
import { z } from "zod";
import { deriveFields, type FieldDescriptor } from "./fields";
import type { BlockDefinition, BlockNode } from "./types";
import {
  brand,
  button,
  columns,
  divider,
  faq,
  heading,
  image,
  locales,
  nav,
  spacer,
  text,
} from "./library";

const definitions: BlockDefinition<z.ZodType, never>[] = [
  heading,
  text,
  image,
  button,
  columns,
  divider,
  spacer,
  faq,
  brand,
  nav,
  locales,
] as unknown as BlockDefinition<z.ZodType, never>[];

const byType = new Map(definitions.map((d) => [d.type, d]));

/**
 * Add a block type from a module (§11's `blocks` manifest entry, §24).
 *
 * Idempotent for the same definition, because boot is a precondition rather
 * than a one-shot event (core/runtime.ts) and a graph may legitimately be
 * asked to boot twice. Two *different* definitions claiming one type must
 * still fail: silently letting the second win would route an owner's existing
 * content at whichever module happened to load last.
 */
export function registerBlock(definition: BlockDefinition<z.ZodType, never>): void {
  const existing = byType.get(definition.type);
  if (existing === definition) return;
  if (existing) {
    throw new Error(
      `block type "${definition.type}" is registered twice, by two different definitions`,
    );
  }
  definitions.push(definition);
  byType.set(definition.type, definition);
}

export function blockTypes(): string[] {
  return [...byType.keys()];
}

export function getBlock(type: string): BlockDefinition<z.ZodType, never> | undefined {
  return byType.get(type);
}

export interface PaletteEntry {
  type: string;
  labelKey: string;
  container: boolean;
  /** Derived from the block's own schema — see blocks/fields.ts. */
  fields: FieldDescriptor[];
  /** Props a freshly added block starts with. */
  starter: Record<string, unknown>;
}

/**
 * Everything the editor needs to offer a context's blocks, derived rather than
 * listed (§24: a plugin's block "appears in the palette with zero editor
 * changes"). The editor knows about *fields*, never about headings or FAQs.
 */
export function paletteFor(context: "page" | "chrome"): PaletteEntry[] {
  return definitions
    .filter((d) => d.contexts.includes(context))
    .map((d) => ({
      type: d.type,
      labelKey: d.labelKey,
      container: Boolean(d.container),
      fields: deriveFields(d.type, d.schema, d.fieldHints),
      // Parsed on the way out so a starter carries the schema's defaults too,
      // and so a block whose starter is wrong fails here rather than at the
      // owner's first save.
      starter: d.schema.parse(d.starter()) as Record<string, unknown>,
    }));
}

export class BlockValidationError extends Error {}

/**
 * Validate a stored tree against the registry.
 *
 * This is the guard that makes jsonb honest (§2 principle 12). Every node's
 * props are parsed by its own block's schema, unknown types are refused rather
 * than silently rendered as nothing, and children are only permitted on blocks
 * that declared themselves containers — so a tree that parses is a tree the
 * renderer can walk without defensive checks at every level.
 *
 * Returns a *normalized* tree: Zod defaults are applied, so a block added
 * before a prop existed reads with that prop's default rather than undefined.
 * That is what makes adding an optional prop to a block a non-migration.
 */
export function parseBlockTree(
  input: unknown,
  context: "page" | "chrome",
  path = "blocks",
): BlockNode[] {
  if (!Array.isArray(input)) {
    throw new BlockValidationError(`${path}: expected an array of blocks`);
  }

  return input.map((raw, i) => {
    const at = `${path}[${i}]`;
    if (typeof raw !== "object" || raw === null) {
      throw new BlockValidationError(`${at}: expected a block object`);
    }
    const node = raw as Partial<BlockNode>;
    if (typeof node.type !== "string") {
      throw new BlockValidationError(`${at}: missing a block type`);
    }

    const definition = byType.get(node.type);
    if (!definition) {
      // Refused rather than dropped. Silently discarding an unknown block is
      // how an owner loses a section by disabling the plugin that drew it —
      // and how they lose it *permanently*, because the next save writes the
      // tree back without it.
      throw new BlockValidationError(
        `${at}: no block type "${node.type}" is registered. If it came from a plugin, that plugin is not installed.`,
      );
    }
    if (!definition.contexts.includes(context)) {
      throw new BlockValidationError(
        `${at}: "${node.type}" cannot be used in ${context}.`,
      );
    }

    const parsed = definition.schema.safeParse(node.props ?? {});
    if (!parsed.success) {
      const detail = parsed.error.issues
        .map((issue) => `${issue.path.join(".") || "props"}: ${issue.message}`)
        .join("; ");
      throw new BlockValidationError(`${at} (${node.type}): ${detail}`);
    }

    if (node.children !== undefined && !definition.container) {
      throw new BlockValidationError(
        `${at}: "${node.type}" does not hold other blocks.`,
      );
    }

    return {
      id: typeof node.id === "string" && node.id ? node.id : `${node.type}-${i}`,
      type: node.type,
      props: parsed.data as Record<string, unknown>,
      ...(definition.container
        ? { children: parseBlockTree(node.children ?? [], context, `${at}.children`) }
        : {}),
    };
  });
}

/** Zod wrapper, so a service's input schema can carry a whole tree. */
export const blockTreeSchema = (context: "page" | "chrome") =>
  z.unknown().transform((value, ctx) => {
    try {
      return parseBlockTree(value, context);
    } catch (error) {
      ctx.addIssue({
        code: "custom",
        message: error instanceof Error ? error.message : "invalid block tree",
      });
      return z.NEVER;
    }
  });

/**
 * Every JSON-LD object the blocks on a page contribute (§5).
 *
 * Walked here rather than in the renderer because structured data belongs in
 * the document head, which renders before the body — so the SEO layer asks the
 * tree what it contains rather than collecting it as a side effect of drawing.
 */
export function collectJsonLd(nodes: BlockNode[]): Record<string, unknown>[] {
  const found: Record<string, unknown>[] = [];
  const walk = (list: BlockNode[]) => {
    for (const node of list) {
      const definition = byType.get(node.type);
      const emitted = definition?.jsonLd?.(node.props);
      if (emitted) found.push(emitted);
      if (node.children) walk(node.children);
    }
  };
  walk(nodes);
  return found;
}
