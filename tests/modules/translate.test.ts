// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Projecting a block tree into sentences and back (MASTER.md §4.9).
import { describe, expect, it } from "vitest";
import { parseBlockTree } from "@/modules/cms/blocks/registry";
import {
  applyTranslations,
  pathKey,
  translatableStrings,
} from "@/modules/cms/translate";

const tree = () =>
  parseBlockTree(
    [
      { id: "a", type: "heading", props: { text: "Our services", level: 1 } },
      { id: "b", type: "text", props: { body: "We photograph weddings." } },
      {
        id: "c",
        type: "image",
        props: {
          assetId: "11111111-1111-4111-8111-111111111111",
          alt: "A couple on a beach",
        },
      },
      {
        id: "d",
        type: "faq",
        props: {
          items: [
            { question: "Do you travel?", answer: "Yes, anywhere in the state." },
            { question: "How long?", answer: "About six hours." },
          ],
        },
      },
    ],
    "page",
  );

describe("translatableStrings", () => {
  it("offers the words and not the machinery", () => {
    const found = translatableStrings(tree());
    const values = found.map((s) => s.value);

    expect(values).toContain("Our services");
    expect(values).toContain("We photograph weddings.");
    expect(values).toContain("Do you travel?");
    expect(values).toContain("Yes, anywhere in the state.");
    // A path to a file is a string and is not a sentence.
    expect(values).not.toContain("11111111-1111-4111-8111-111111111111");
  });

  it("keeps reading order, so a translator can tell what they are looking at", () => {
    const found = translatableStrings(tree());
    expect(found.map((s) => s.value).slice(0, 3)).toEqual([
      "Our services",
      "We photograph weddings.",
      "A couple on a beach",
    ]);
  });

  it("reaches inside a list", () => {
    const found = translatableStrings(tree());
    const answer = found.find((s) => s.value === "About six hours.");
    expect(answer).toBeDefined();
    expect(pathKey(answer!.path)).toBe("3.props.items.1.answer");
  });

  it("skips empty strings rather than offering blank boxes", () => {
    const withEmpty = parseBlockTree(
      [{ id: "a", type: "text", props: { body: "  " } }],
      "page",
    );
    expect(translatableStrings(withEmpty)).toEqual([]);
  });
});

describe("applyTranslations", () => {
  it("replaces the words and nothing else", () => {
    const source = tree();
    const strings = translatableStrings(source);
    const values = Object.fromEntries(
      strings.map((s) => [pathKey(s.path), `FR: ${s.value}`]),
    );

    const translated = applyTranslations(source, values);

    expect(translated[0]!.props.text).toBe("FR: Our services");
    expect(translated[2]!.props.assetId).toBe("11111111-1111-4111-8111-111111111111");
    expect((translated[0]!.props as { level: number }).level).toBe(1);
    // And the structure is the source's, so the two languages cannot diverge.
    expect(translated).toHaveLength(source.length);
    expect(translated.map((n) => n.type)).toEqual(source.map((n) => n.type));
  });

  it("leaves the source untouched", () => {
    const source = tree();
    applyTranslations(source, { "0.props.text": "Nos services" });
    expect(source[0]!.props.text).toBe("Our services");
  });

  it("keeps the source words where a translation is missing", () => {
    const translated = applyTranslations(tree(), { "0.props.text": "Nos services" });
    expect(translated[0]!.props.text).toBe("Nos services");
    expect(translated[1]!.props.body).toBe("We photograph weddings.");
  });

  it("ignores a path the tree has outgrown", () => {
    // The saved translation names a block that has since been deleted, and a
    // prop that is now a number. Neither may corrupt the tree.
    const translated = applyTranslations(tree(), {
      "9.props.text": "Nothing here",
      "0.props.level": "Deux",
      "0.props.text.nested": "Nonsense",
    });
    expect((translated[0]!.props as { level: number }).level).toBe(1);
    expect(translated).toHaveLength(4);
  });

  it("produces a tree that still passes the block validator", () => {
    const source = tree();
    const values = Object.fromEntries(
      translatableStrings(source).map((s) => [pathKey(s.path), `FR: ${s.value}`]),
    );
    expect(() => parseBlockTree(applyTranslations(source, values), "page")).not.toThrow();
  });
});
