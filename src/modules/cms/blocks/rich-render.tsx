// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Render a typed rich-text document to semantic HTML (C2.05).
import { Fragment, type ReactNode } from "react";
import { parseRichDoc, type RichDoc, type RichInline, type RichMark } from "./rich";

function markWrap(text: string, marks: RichMark[] | undefined): ReactNode {
  let node: ReactNode = text;
  if (marks?.includes("code")) node = <code>{node}</code>;
  if (marks?.includes("strong")) node = <strong>{node}</strong>;
  if (marks?.includes("em")) node = <em>{node}</em>;
  return node;
}

function renderInlines(nodes: RichInline[]): ReactNode {
  return nodes.map((node, index) => {
    if (node.type === "text") {
      return <Fragment key={index}>{markWrap(node.text, node.marks)}</Fragment>;
    }
    const href = node.href.startsWith("javascript:") ? "#" : node.href;
    return (
      <a key={index} href={href}>
        {renderInlines(node.children)}
      </a>
    );
  });
}

export function renderRichDoc(value: unknown): ReactNode {
  const doc: RichDoc = parseRichDoc(value, "lenient");
  return doc.map((block, index) => {
    if (block.type === "paragraph") {
      return <p key={index}>{renderInlines(block.children)}</p>;
    }
    const Tag = block.type === "orderedList" ? "ol" : "ul";
    return (
      <Tag key={index}>
        {block.children.map((item, itemIndex) => (
          <li key={itemIndex}>{renderInlines(item.children)}</li>
        ))}
      </Tag>
    );
  });
}
