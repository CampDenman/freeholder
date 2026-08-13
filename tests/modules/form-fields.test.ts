// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// The builder's key derivation, against the schema it has to satisfy.
import { describe, expect, it } from "vitest";
import { fieldSchema, fieldsSchema } from "@/modules/forms/fields";
import { deriveFieldKey } from "@/modules/forms/fieldKey";

const KEY_OK = (key: string) =>
  fieldSchema.safeParse({ key, label: "x", kind: "text" }).success;

describe("deriveFieldKey", () => {
  it("produces a key the field schema accepts", () => {
    const labels = [
      "What is your name?",
      "¿Cuál es tu teléfono?",
      "Adresse e-mail",
      "2026 budget",
      "!!!",
      "   ",
      "Tell us everything about the project you have in mind, in as much detail as you like",
    ];
    for (const label of labels) {
      const key = deriveFieldKey(label, []);
      expect(KEY_OK(key), `${label} -> ${key}`).toBe(true);
    }
  });

  it("strips diacritics rather than dropping the word", () => {
    expect(deriveFieldKey("Adresse e-mail", [])).toBe("adresse_e_mail");
    expect(deriveFieldKey("¿Cuál es tu teléfono?", [])).toBe("cual_es_tu_telefono");
  });

  it("falls back when a label has nothing to derive from", () => {
    expect(deriveFieldKey("!!!", [])).toBe("question");
    expect(deriveFieldKey("", [])).toBe("question");
  });

  it("never returns a key already taken", () => {
    const taken: string[] = [];
    for (let i = 0; i < 5; i++) {
      const key = deriveFieldKey("Your name", taken);
      expect(taken).not.toContain(key);
      taken.push(key);
    }
    expect(taken).toEqual([
      "your_name",
      "your_name_2",
      "your_name_3",
      "your_name_4",
      "your_name_5",
    ]);
  });

  it("stays inside the length limit when it has to disambiguate", () => {
    const long = "Tell us about the project you have in mind in detail";
    const first = deriveFieldKey(long, []);
    const second = deriveFieldKey(long, [first]);
    expect(first).toHaveLength(40);
    expect(second).toHaveLength(40);
    expect(second).not.toBe(first);
    expect(KEY_OK(second)).toBe(true);
  });

  it("keeps a list of derived keys valid as a whole", () => {
    const taken: string[] = [];
    const fields = ["Name", "Name", "Éclair?", "2026"].map((label) => {
      const key = deriveFieldKey(label, taken);
      taken.push(key);
      return { key, label, kind: "text" as const };
    });
    expect(fieldsSchema.safeParse(fields).success).toBe(true);
  });
});
