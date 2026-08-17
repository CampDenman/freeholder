// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
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
    /** §4.9: what the language switcher offers, and what hreflang matches. */
    defaultLocale?: string;
    enabledLocales?: string[];
  } | null;
  /** Path currently being rendered, so nav can mark itself current. */
  path: string;
  /** Keep internal public/customer links in this render's selected locale. */
  localizeHref?: (href: string) => string;
  /**
   * The URL's query, for blocks whose state survives a page load.
   *
   * Added for the form block, and kept deliberately narrow: a form that
   * confirms a submission by re-rendering the page needs to know a submission
   * just happened, and the alternative — a client component holding the result
   * in state — would put the first hydration boundary on the public surface.
   * §5 and the SEO gate both rest on that surface being plain server-rendered
   * HTML, so a query parameter is the cheaper answer by a wide margin.
   */
  query?: Record<string, string | undefined>;
  /**
   * Wrap each block so the editor can trace a click back to a node.
   *
   * Only ever true inside the admin preview. The public surface renders
   * unwrapped, so what a visitor and a crawler receive is exactly what the
   * blocks produced — the SEO gate has to be checking the real markup, not a
   * version with editor scaffolding in it.
   */
  identifyBlocks?: boolean;
  /**
   * Which of this block's props may be typed into directly on the canvas.
   *
   * A block marks a *text* element with `editable(prop)` and the renderer
   * turns that into `contenteditable` — but only in the preview. The mechanism
   * is the block's, because only the block knows which element shows which
   * prop; the decision to allow it at all is the editor's.
   */
  editable?: (prop: string) => Record<string, string> | undefined;
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
  /**
   * When this returns false, children are not rendered at all (C2.10).
   * The paywall uses it so gated copy is never present in the HTML.
   */
  includeChildren?: (args: {
    props: z.output<Props>;
    ctx: BlockRenderContext;
  }) => boolean | Promise<boolean>;
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
