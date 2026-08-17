// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Typed rich text never stores HTML soup (C2.05).

import { describe, expect, it } from "vitest";
import {
  fromEditorMarkup,
  fromPlainString,
  looksLikeHtml,
  parseRichDoc,
  RichValidationError,
  toEditorMarkup,
  toPlainText,
} from "@/modules/cms/blocks/rich";
import { parseBlockTree } from "@/modules/cms/blocks/registry";
import { sanitizeOwnerHtml } from "@/modules/cms/blocks/html";
import {
  duplicateNodes,
  filterPalette,
  moveSiblings,
  readClipboard,
  removeNodes,
  writeClipboard,
} from "@/modules/cms/blocks/edit";
import type { BlockNode } from "@/modules/cms/blocks/types";

describe("typed rich text", () => {
  it("turns a leftover plain string into paragraphs", () => {
    const doc = parseRichDoc("Hello\n\nThere");
    expect(doc).toEqual([
      { type: "paragraph", children: [{ type: "text", text: "Hello" }] },
      { type: "paragraph", children: [{ type: "text", text: "There" }] },
    ]);
    expect(toPlainText(doc)).toBe("Hello\n\nThere");
  });

  it("refuses HTML soup on the write path", () => {
    expect(looksLikeHtml("<p>Hi</p>")).toBe(true);
    expect(() => parseRichDoc("<p>Hi</p>")).toThrow(RichValidationError);
    expect(() => fromEditorMarkup("<strong>nope</strong>")).toThrow(RichValidationError);
    const lenient = parseRichDoc("<p>Hi</p>", "lenient");
    expect(lenient[0]).toMatchObject({ type: "paragraph" });
    expect(toPlainText(lenient)).toContain("<p>Hi</p>");
  });

  it("round-trips emphasis, links, code and lists through editor markup", () => {
    const doc = fromEditorMarkup(
      "A **bold** and *italic* and `code` and [site](/about).\n\n- One\n- Two\n\n1. First\n2. Second",
    );
    expect(doc[0]).toMatchObject({ type: "paragraph" });
    expect(doc[1]).toMatchObject({ type: "bulletList" });
    expect(doc[2]).toMatchObject({ type: "orderedList" });
    expect(toPlainText(doc)).toContain("bold");
    expect(toEditorMarkup(doc)).toContain("**bold**");
    expect(toEditorMarkup(doc)).toContain("[site](/about)");
  });

  it("coerces a text block's leftover string body on write", () => {
    const [node] = parseBlockTree(
      [{ id: "t", type: "text", props: { body: "Plain copy." } }],
      "page",
    );
    expect(node!.props.body).toEqual(fromPlainString("Plain copy."));
  });

  it("refuses a text block whose body is HTML", () => {
    expect(() =>
      parseBlockTree(
        [{ id: "t", type: "text", props: { body: "<script>alert(1)</script>" } }],
        "page",
      ),
    ).toThrow(/HTML/);
  });
});

describe("owner HTML", () => {
  it("strips script, handlers and javascript urls", () => {
    const cleaned = sanitizeOwnerHtml(
      `<p onclick="steal()">Hi</p><script>alert(1)</script><a href="javascript:alert(1)">x</a>`,
    );
    expect(cleaned).not.toContain("script");
    expect(cleaned).not.toContain("onclick");
    expect(cleaned).not.toContain("javascript:");
    expect(cleaned).toContain("<p>");
    expect(cleaned).toContain("Hi");
  });
});

describe("editor operations", () => {
  const tree = (): BlockNode[] => [
    { id: "a", type: "heading", props: { text: "A" } },
    { id: "b", type: "heading", props: { text: "B" } },
    { id: "c", type: "heading", props: { text: "C" } },
  ];

  it("duplicates, removes and moves selected siblings", () => {
    const copied = duplicateNodes(tree(), new Set(["b"]));
    expect(copied.map((node) => node.props.text)).toEqual(["A", "B", "B", "C"]);
    expect(copied[2]!.id).not.toBe("b");

    expect(removeNodes(tree(), new Set(["b"])).map((node) => node.id)).toEqual(["a", "c"]);
    expect(moveSiblings(tree(), new Set(["b"]), -1).map((node) => node.id)).toEqual([
      "b",
      "a",
      "c",
    ]);
  });

  it("filters the slash palette and round-trips a clipboard payload", () => {
    const palette = [
      { type: "heading", label: "Heading" },
      { type: "text", label: "Text" },
      { type: "video", label: "Video" },
    ];
    expect(filterPalette(palette, "/he").map((entry) => entry.type)).toEqual(["heading"]);
    const raw = writeClipboard(tree());
    expect(readClipboard(raw)?.map((node) => node.id)).toEqual(["a", "b", "c"]);
    expect(readClipboard("not json")).toBeUndefined();
  });
});
