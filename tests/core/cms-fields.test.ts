// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Deriving edit forms from block schemas (MASTER.md §24, §32).
//
// This is what makes "a plugin's block appears in the palette with zero editor
// changes" true rather than aspirational, so it is worth testing against a
// schema the editor has never seen — a stand-in for a plugin.
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { deriveFields } from "@/modules/cms/blocks/fields";
import { paletteFor } from "@/modules/cms/blocks/registry";
import { t } from "@/core/i18n";

describe("deriveFields()", () => {
  it("reads a schema the editor has never seen", () => {
    // Deliberately not one of ours: if this needed a change to the editor,
    // §24's promise would be false.
    const pluginBlock = z.object({
      sku: z.string(),
      blurb: z.string().optional(),
      featured: z.boolean().default(false),
      badge: z.enum(["new", "sale"]).default("new"),
      columns: z.union([z.literal(1), z.literal(2)]).default(1),
      specs: z.array(z.object({ name: z.string(), value: z.string() })),
    });

    const fields = deriveFields("plugin.product", pluginBlock, {
      blurb: { control: "multiline" },
    });

    expect(fields.map((f) => [f.name, f.kind])).toEqual([
      ["sku", "text"],
      ["blurb", "multiline"],
      ["featured", "boolean"],
      ["badge", "choice"],
      ["columns", "choice"],
      ["specs", "list"],
    ]);
  });

  it("marks a field required only when it has no default and is not optional", () => {
    const fields = deriveFields(
      "x",
      z.object({
        must: z.string(),
        defaulted: z.string().default("d"),
        maybe: z.string().optional(),
      }),
    );
    expect(fields.map((f) => [f.name, f.required])).toEqual([
      ["must", true],
      ["defaulted", false],
      ["maybe", false],
    ]);
  });

  it("offers the values an enum and a literal union actually admit", () => {
    const [enumField, unionField] = deriveFields(
      "x",
      z.object({
        align: z.enum(["start", "center"]).default("start"),
        level: z.union([z.literal(1), z.literal(2)]).default(2),
      }),
    );
    expect(enumField!.choices?.map((c) => c.value)).toEqual(["start", "center"]);
    expect(unionField!.choices?.map((c) => c.value)).toEqual(["1", "2"]);
  });

  it("describes the shape of a list's items", () => {
    const [items] = deriveFields(
      "x",
      z.object({
        items: z.array(z.object({ question: z.string(), answer: z.string() })),
      }),
    );
    expect(items!.kind).toBe("list");
    expect(items!.itemFields?.map((f) => f.name)).toEqual(["question", "answer"]);
  });

  it("omits a hidden field rather than showing machinery to an owner", () => {
    const fields = deriveFields(
      "x",
      z.object({ visible: z.string(), ariaLabelKey: z.string().default("k") }),
      { ariaLabelKey: { hidden: true } },
    );
    expect(fields.map((f) => f.name)).toEqual(["visible"]);
  });

  it("skips a shape it cannot draw instead of failing", () => {
    // A plugin with an exotic field should lose that one input, not take the
    // editor down — and the block still renders, which never depended on this.
    const fields = deriveFields(
      "x",
      z.object({
        fine: z.string(),
        exotic: z.record(z.string(), z.unknown()),
        alsoExotic: z.number(),
      }),
    );
    expect(fields.map((f) => f.name)).toEqual(["fine"]);
  });
});

describe("the editor palette", () => {
  it("gives every block a starter that satisfies its own schema", () => {
    // paletteFor() parses each starter, so a block whose starter is invalid
    // fails here rather than when an owner adds it and cannot save.
    expect(() => paletteFor("page")).not.toThrow();
    expect(() => paletteFor("chrome")).not.toThrow();

    for (const entry of [...paletteFor("page"), ...paletteFor("chrome")]) {
      expect(entry.starter, `${entry.type} has no starter props`).toBeDefined();
    }
  });

  it("names every derived field and choice in the default catalog", () => {
    // A field the editor can draw but nobody named would render its own key
    // as a label. The fallback keeps a plugin usable; core has no excuse.
    const missing: string[] = [];
    const check = (key: string) => {
      if (t("en", key) === key) missing.push(key);
    };

    for (const entry of [...paletteFor("page"), ...paletteFor("chrome")]) {
      const walk = (fields: typeof entry.fields) => {
        for (const field of fields) {
          check(`cms.field.${field.name}`);
          for (const choice of field.choices ?? []) check(choice.labelKey);
          if (field.itemFields) walk(field.itemFields);
        }
      };
      walk(entry.fields);
    }

    expect([...new Set(missing)]).toEqual([]);
  });
});
