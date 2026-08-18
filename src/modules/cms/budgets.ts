// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Image and page size budgets (C2.22).
import type { BlockNode } from "./blocks/types";

export const PAGE_BLOCK_BUDGET = 80;
export const PAGE_IMAGE_BUDGET = 24;
export const PAGE_HTML_CHARS_BUDGET = 20_000;

export interface PageBudget {
  blocks: number;
  images: number;
  htmlChars: number;
}

export function measurePageBudget(nodes: BlockNode[]): PageBudget {
  let blocks = 0;
  let images = 0;
  let htmlChars = 0;
  const walk = (list: BlockNode[]) => {
    for (const node of list) {
      blocks += 1;
      if (node.type === "image" || node.type === "gallery") images += 1;
      if (node.type === "html" && typeof node.props.markup === "string") {
        htmlChars += node.props.markup.length;
      }
      if (node.children?.length) walk(node.children);
    }
  };
  walk(nodes);
  return { blocks, images, htmlChars };
}

export function budgetViolations(measured: PageBudget): string[] {
  const over: string[] = [];
  if (measured.blocks > PAGE_BLOCK_BUDGET) {
    over.push(`This page has ${measured.blocks} blocks; the limit is ${PAGE_BLOCK_BUDGET}.`);
  }
  if (measured.images > PAGE_IMAGE_BUDGET) {
    over.push(`This page has ${measured.images} images; the limit is ${PAGE_IMAGE_BUDGET}.`);
  }
  if (measured.htmlChars > PAGE_HTML_CHARS_BUDGET) {
    over.push(
      `Custom HTML on this page is ${measured.htmlChars} characters; the limit is ${PAGE_HTML_CHARS_BUDGET}.`,
    );
  }
  return over;
}

export function budgetMessage(nodes: BlockNode[]): string | null {
  return budgetViolations(measurePageBudget(nodes))[0] ?? null;
}
