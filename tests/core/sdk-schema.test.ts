// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// JSON Schema → TypeScript for the generated SDK (C3.03).
import { describe, expect, it } from "vitest";
import { isPageableSchema, jsonSchemaToTs } from "@/core/contract/sdk";

describe("jsonSchemaToTs (C3.03)", () => {
  it("renders primitives, enums, unions and dates-as-strings", () => {
    expect(jsonSchemaToTs({ type: "string" })).toBe("string");
    expect(jsonSchemaToTs({ type: "integer" })).toBe("number");
    expect(jsonSchemaToTs({ type: "boolean", const: true })).toBe("true");
    expect(jsonSchemaToTs({ type: "string", enum: ["lead", "customer"] })).toBe(
      '"lead" | "customer"',
    );
    expect(jsonSchemaToTs({ type: "string", format: "date-time" })).toBe("string");
    expect(jsonSchemaToTs({})).toBe("unknown");
    expect(
      jsonSchemaToTs({
        anyOf: [{ type: "string" }, { type: "null" }],
      }),
    ).toBe("string | null");
  });

  it("renders objects, optional fields, loose rows and records", () => {
    expect(
      jsonSchemaToTs({
        type: "object",
        properties: {
          name: { type: "string" },
          email: { anyOf: [{ type: "string" }, { type: "null" }] },
          limit: { type: "integer", default: 25 },
        },
        required: ["name"],
      }),
    ).toBe("{ name: string; email?: string | null; limit?: number }");

    expect(
      jsonSchemaToTs({
        type: "object",
        properties: { id: { type: "string" } },
        required: ["id"],
        additionalProperties: {},
      }),
    ).toBe("{ id: string; [key: string]: unknown }");

    expect(
      jsonSchemaToTs({
        type: "object",
        propertyNames: { type: "string" },
        additionalProperties: {},
      }),
    ).toBe("{ [key: string]: unknown }");

    expect(jsonSchemaToTs({ type: "object", properties: {} })).toBe(
      "Record<string, never>",
    );
  });

  it("renders arrays, tuples and intersections", () => {
    expect(jsonSchemaToTs({ type: "array", items: { type: "string" } })).toBe(
      "string[]",
    );
    expect(
      jsonSchemaToTs({
        type: "array",
        prefixItems: [{ type: "string" }, { type: "number" }],
      }),
    ).toBe("[string, number]");
    expect(
      jsonSchemaToTs({
        allOf: [
          { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
          {
            type: "object",
            properties: { extra: { type: "number" } },
            required: ["extra"],
          },
        ],
      }),
    ).toBe("{ id: string } & { extra: number }");
  });

  it("detects the paginate-able list shape", () => {
    expect(
      isPageableSchema(
        {
          type: "object",
          properties: { limit: { type: "integer" }, offset: { type: "integer" } },
        },
        {
          type: "object",
          properties: {
            rows: { type: "array", items: { type: "object" } },
            total: { type: "integer" },
          },
        },
      ),
    ).toBe(true);
    expect(
      isPageableSchema(
        { type: "object", properties: { name: { type: "string" } } },
        { type: "object", properties: { id: { type: "string" } } },
      ),
    ).toBe(false);
  });
});
