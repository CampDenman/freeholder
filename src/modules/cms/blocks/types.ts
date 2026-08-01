// Copyright (C) 2026 Camp Denman Society
// SPDX-License-Identifier: AGPL-3.0-only
// The block contract (MASTER.md §32).
//
// "Typed blocks, never markup blobs": every block is a Zod-schema'd JSON node
// rendered by a server component. §32 is explicit about why — stored HTML soup
// "forfeits the SEO gate, sane migrations, and re-theming forever". A schema is
// what lets the platform validate a tree it did not author, migrate a block
// type without a find-and-replace over strings, and guarantee that what
// reaches the page is semantic HTML.
//
// A block definition is the whole vocabulary entry: its name, its shape, and
// how it renders. Plugins register new ones through the module manifest (§24)
// and they appear in the editor palette with no editor changes, because the
// palette is generated from this registry rather than hand-listed.
import type { ReactNode } from "react";
import type { z } from "zod";
import type { Translate } from "@/core/i18n";
import type { FieldHint } from "./fields";

/**
 * What a block can see while rendering.
 *
 * Deliberately narrow. A block gets the request's locale and the business
 * profile because those are properties of *where it is being rendered*; it
 * does not get a database handle, an actor, or the ability to call services at
 * will. A block is a pure function from its own validated props to semantic
 * HTML, and blocks that need live data get it through a resolver on the
 * definition (below) rather than by reaching out mid-render.
 */
export interface BlockRenderContext {
  locale: string;
  t: Translate;
  business: {
    name: string;
    tagline: string | null;
  } | null;
  /** Path currently being rendered, so nav can mark itself current. */
  path: string;
}

/**
 * One entry in the vocabulary.
 *
 * `resolve` exists for blocks whose content is *live* rather than authored —
 * a nav that lists published pages, a brand that reads the business name. It
 * runs before render, on the server, and its result is passed to `render`.
 * Blocks without one are pure and render straight from their props.
 */
export interface BlockDefinition<
  Props extends z.ZodType = z.ZodType,
  Resolved = void,
> {
  /** Stable identifier, stored in the tree. Renaming one is a migration. */
  type: string;
  /** Catalog key for the editor palette — copy, so it is not a literal. */
  labelKey: string;
  /** Where this block may be used. Email excludes interactive blocks (§32). */
  contexts: ReadonlyArray<"page" | "chrome">;
  schema: Props;
  /**
   * The props a freshly added block starts with.
   *
   * Required rather than derived, because a schema cannot invent copy: a
   * heading's `text` has no default and `""` fails its own `min(1)`, so
   * deriving would produce a block that cannot be saved the moment it is
   * added. Starter values are placeholder content the owner immediately
   * replaces, which is a different thing from a default.
   */
  starter: () => z.input<Props>;
  /**
   * Per-field editing hints — that a string is a paragraph, that a field is
   * machinery. On the block rather than in the editor, so a plugin carries its
   * own (§24).
   */
  fieldHints?: Record<string, FieldHint>;
  /** True when this block holds other blocks, so the tree walker recurses. */
  container?: boolean;
  resolve?: (
    props: z.output<Props>,
    ctx: BlockRenderContext,
  ) => Promise<Resolved>;
  render: (args: {
    props: z.output<Props>;
    ctx: BlockRenderContext;
    resolved: Resolved;
    /** Rendered children, for container blocks. */
    children?: ReactNode;
  }) => ReactNode;
  /**
   * JSON-LD this block contributes to the page it is on (§5: "FAQPage/HowTo
   * where blocks warrant"). Returning a value is how a block earns structured
   * data without the SEO layer knowing what an FAQ is.
   */
  jsonLd?: (props: z.output<Props>) => Record<string, unknown> | undefined;
}

/** A node in a stored tree. Children are only meaningful on containers. */
export interface BlockNode {
  id: string;
  type: string;
  props: Record<string, unknown>;
  children?: BlockNode[];
}

/** Helper that keeps a definition's generics inferred rather than widened. */
export function defineBlock<Props extends z.ZodType, Resolved = void>(
  definition: BlockDefinition<Props, Resolved>,
): BlockDefinition<Props, Resolved> {
  return definition;
}
