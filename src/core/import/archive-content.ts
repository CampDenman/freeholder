// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C3.22: retain owned audio/video/document intent through the shared converter.
import { parseFragment, serialize, type DefaultTreeAdapterTypes } from "parse5";
import { randomUUID } from "node:crypto";
import { budgetMessage } from "@/modules/cms/budgets";
import type { BlockNode } from "@/modules/cms/blocks/types";
import { wordpressBodyToBlocks, type BodyContext, type BodyConversion } from "./wordpress";

export type ArchiveMediaMatch = { assetId: string; kind: "image" | "video" | "audio" | "doc"; filename: string };
type Node = DefaultTreeAdapterTypes.Node;
type Element = DefaultTreeAdapterTypes.Element;
const attr = (node: Element, name: string) => node.attrs.find(value => value.name === name)?.value;
function words(node: Node): string {
  return node.nodeName === "#text" ? (node as DefaultTreeAdapterTypes.TextNode).value : "childNodes" in node ? node.childNodes.map(words).join(" ") : "";
}

export function archiveBodyToBlocks(body: string, context: BodyContext & { resolveMedia(src: string): ArchiveMediaMatch | null }): BodyConversion {
  const document = parseFragment(body);
  const referenceBase = `https://${randomUUID()}.static-archive.invalid/`;
  const references = new Map<string, { media: ArchiveMediaMatch; presentation: "video" | "file"; label: string }>();
  const walk = (parent: DefaultTreeAdapterTypes.ParentNode) => {
    for (let index = 0; index < parent.childNodes.length; index++) {
      const node = parent.childNodes[index]!;
      if (!("tagName" in node)) continue;
      const source = node.tagName === "a" ? attr(node, "href") : node.tagName === "object" ? attr(node, "data") : ["video", "audio", "embed"].includes(node.tagName) ? attr(node, "src") ?? node.childNodes.flatMap(child => "tagName" in child && child.tagName === "source" ? [attr(child, "src")] : []).find(Boolean) : undefined;
      const media = source ? context.resolveMedia(source) : null;
      if (media && media.kind !== "image") {
        const token = `archive-media-${references.size}`;
        references.set(token, { media, presentation: node.tagName === "video" && media.kind === "video" ? "video" : "file", label: words(node).replace(/\s+/g, " ").trim().slice(0, 200) || media.filename.slice(0, 200) });
        const replacement = parseFragment("<img>").childNodes[0] as Element;
        replacement.attrs = [{ name: "src", value: `${referenceBase}${token}` }];
        replacement.parentNode = parent;
        parent.childNodes[index] = replacement;
      } else walk(node);
    }
  };
  walk(document);
  const converted = wordpressBodyToBlocks(serialize(document), {
    ...context,
    resolveImage(src, wpId) {
      if (src.startsWith(referenceBase)) {
        const token = src.slice(referenceBase.length);
        if (references.has(token)) return { assetId: token };
      }
      return context.resolveImage(src, wpId);
    },
  });
  const replace = (node: BlockNode): BlockNode[] => {
    if (node.type === "image" && typeof node.props.assetId === "string") {
      const reference = references.get(node.props.assetId);
      if (reference) return [{ id: node.id, type: reference.presentation, props: { assetId: reference.media.assetId, ...(reference.presentation === "video" ? { caption: reference.label } : { label: reference.label }) } }];
    }
    if (node.type === "gallery" && Array.isArray(node.props.items)) {
      const values: unknown[] = node.props.items;
      const items = values.filter((item): item is { assetId: string; caption?: string } => item !== null && typeof item === "object" && "assetId" in item && typeof item.assetId === "string" && (!("caption" in item) || typeof item.caption === "string"));
      if (items.some(item => references.has(item.assetId))) return items.flatMap((item, index) => replace({ id: `${node.id}-${index}`, type: "image", props: { assetId: item.assetId, ...(item.caption ? { alt: item.caption } : {}) } }));
    }
    return [{ ...node, ...(node.children ? { children: node.children.flatMap(replace) } : {}) }];
  };
  const blocks = converted.blocks.flatMap(replace);
  return { ...converted, blocks, overBudget: converted.overBudget ?? budgetMessage(blocks) };
}
