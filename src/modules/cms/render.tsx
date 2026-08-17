// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Rendering a block tree to semantic HTML on the server (MASTER.md §32, §5).
//
// Server-only by construction: the public surface is server-rendered HTML with
// the content present in the initial response (§5 "Rendering"), so there is no
// client component anywhere in this path and no hydration step between an
// owner publishing and a crawler reading. That is also what makes the SEO gate
// checkable — what the crawler sees is what this function returned.
import type { ReactNode } from "react";
import { getBlock } from "./blocks/registry";
import type { BlockNode, BlockRenderContext } from "./blocks/types";

/**
 * Render one tree.
 *
 * Nodes are resolved in parallel rather than in sequence: a page with a nav
 * and three live blocks should cost one round of queries, not four in a row.
 * Blocks are independent by contract — a block cannot see its siblings — so
 * there is nothing to serialize.
 */
export async function renderBlocks(
  nodes: BlockNode[],
  ctx: BlockRenderContext,
): Promise<ReactNode[]> {
  return Promise.all(nodes.map((node) => renderBlock(node, ctx)));
}

async function renderBlock(
  node: BlockNode,
  ctx: BlockRenderContext,
): Promise<ReactNode> {
  const identify = ctx.identifyBlocks === true;
  const definition = getBlock(node.type);
  if (!definition) {
    // Unreachable through the services, which validate against the same
    // registry before writing. Reached only if a block type is removed from
    // the code while trees still reference it — a plugin uninstalled, say. A
    // missing block leaves a gap in a page; it must never take the page down.
    console.warn(`[cms] no renderer for block type "${node.type}" — skipped`);
    return null;
  }

  const resolved = definition.resolve
    ? await definition.resolve(node.props, ctx)
    : (undefined as never);

  /**
   * Marks an element as directly typeable, in the preview only.
   *
   * A block spreads this onto whichever element shows the prop — only the
   * block knows which that is. On the public surface it returns nothing, so
   * the markup a visitor receives has no editor attributes in it at all.
   */
  const editable = identify
    ? (prop: string) => ({
        contentEditable: "plaintext-only",
        suppressContentEditableWarning: "true",
        "data-editable-prop": prop,
        // Typing into a heading should not also trigger the click that
        // selects it, and spellcheck squiggles on a design surface are noise.
        spellCheck: "false",
      })
    : () => undefined;

  const allowChildren = definition.includeChildren
    ? await definition.includeChildren({ props: node.props, ctx })
    : true;
  const children =
    allowChildren && node.children
      ? await renderBlocks(node.children, ctx)
      : undefined;

  const rendered = definition.render({
    props: node.props,
    ctx: { ...ctx, editable },
    resolved,
    children,
  });

  // In the editor's preview the same output is wrapped so a click can be
  // traced back to a node. On the public surface it is not wrapped at all —
  // the markup a visitor and a crawler receive stays exactly what the blocks
  // produced, which is what keeps the SEO gate checking the real thing.
  return identify ? (
    <div key={node.id} data-block-id={node.id} data-block-type={node.type}>
      {rendered}
    </div>
  ) : (
    <BlockFrame key={node.id}>{rendered}</BlockFrame>
  );
}

/**
 * A keyed wrapper, and nothing else.
 *
 * Deliberately not a styled container: §32 makes the *arrangement* the owner's,
 * so the renderer contributes no spacing, no borders and no opinions of its
 * own. Everything visual comes from the blocks themselves or from the flow
 * container the page puts them in.
 */
function BlockFrame({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
