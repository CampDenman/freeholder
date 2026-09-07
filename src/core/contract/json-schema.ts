// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// One JSON Schema projection for OpenAPI and the SDK (MASTER.md §28, C3.03).
import { z } from "zod";

/**
 * A service schema as JSON Schema.
 *
 * `io: "input"` is the load-bearing option: a schema with `.default()` or
 * `.transform()` has a different shape going in than coming out, and it is the
 * *input* shape a caller has to satisfy. Asking for the output shape would
 * document defaults as required fields.
 *
 * Dates travel on the wire as ISO-8601 strings — the same override OpenAPI
 * uses — so the generated client cannot disagree with `/api/openapi.json`.
 */
export function toContractJsonSchema(
  schema: z.ZodType,
  io: "input" | "output",
): unknown {
  try {
    const json = z.toJSONSchema(schema, {
      io,
      unrepresentable: "any",
      override: (ctx) => {
        const def = (ctx.zodSchema as { def?: { type?: string } }).def;
        if (def?.type === "date") {
          ctx.jsonSchema.type = "string";
          ctx.jsonSchema.format = "date-time";
        }
      },
    });
    const { $schema: _ignored, ...rest } = json as Record<string, unknown>;
    return rest;
  } catch (error) {
    console.warn(`[contract] could not describe a ${io} schema`, error);
    return { type: "object" };
  }
}
