// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// The instance's own contract (MASTER.md §28).
//
// "It is definitionally impossible for the spec to describe a shape the API
// doesn't enforce." That claim is only true if the spec is derived from the
// *same object* the request is validated against, and it is: every request
// body below is `z.toJSONSchema(service.def.input)`, where `service.def.input`
// is the schema `defineService` parses with. There is no second description to
// fall out of date, and nothing to regenerate by hand.
//
// Zod 4 emits JSON Schema natively, so no `zod-openapi` sits in between. That
// matters beyond one fewer dependency: a converter is exactly the kind of
// intermediary that can quietly disagree with the validator it is modelling.
//
// Responses come from `ServiceDef.output` when the service has one (C3.01).
// A service still missing an output schema is described as a generic object
// rather than a guessed shape. The completeness gate refuses that gap.
import { z } from "zod";
import { listServices, type Service } from "@/core/service";
import { API_BASE } from "@/core/api/dispatch";

export interface OpenApiOptions {
  /** Absolute origin this instance is served from (§5's configured origin). */
  origin: string;
  /** The platform version, so a consumer can tell two instances apart. */
  version: string;
  title: string;
}

/** Errors are the same shape everywhere, because respond.ts makes them so. */
const ERROR_SCHEMA = {
  type: "object",
  properties: {
    error: {
      type: "object",
      properties: {
        code: {
          type: "string",
          enum: [
            "validation",
            "permission",
            "not_found",
            "conflict",
            "rate_limited",
            "step_up_required",
            "internal",
          ],
        },
        message: { type: "string" },
      },
      required: ["code", "message"],
    },
  },
  required: ["error"],
} as const;

function errorResponses(): Record<string, unknown> {
  const body = { "application/json": { schema: ERROR_SCHEMA } };
  return {
    "400": { description: "The input did not match the schema.", content: body },
    "401": { description: "No credential was presented.", content: body },
    "403": {
      description: "The credential is not allowed to call this service.",
      content: body,
    },
    "404": { description: "No such service, or nothing matched.", content: body },
    "409": { description: "The request conflicts with what already exists.", content: body },
    "429": {
      description: "Rate limited. Retry-After says how long to wait.",
      content: body,
    },
  };
}

/**
 * A service's input as JSON Schema.
 *
 * `io: "input"` is the load-bearing option: a schema with `.default()` or
 * `.transform()` has a different shape going in than coming out, and it is the
 * *input* shape a caller has to satisfy. Asking for the output shape would
 * document defaults as required fields.
 */
function jsonSchema(schema: z.ZodType, io: "input" | "output"): unknown {
  try {
    const json = z.toJSONSchema(schema, {
      io,
      // Handler returns include Date objects. JSON Schema has no Date type;
      // C3.02 can emit format:date-time. Until then, do not fail the document.
      unrepresentable: "any",
    });
    const { $schema: _ignored, ...rest } = json as Record<string, unknown>;
    return rest;
  } catch (error) {
    console.warn(`[openapi] could not describe a ${io} schema`, error);
    return { type: "object" };
  }
}

function inputSchema(service: Service): unknown {
  try {
    return jsonSchema(service.def.input, "input");
  } catch (error) {
    // A schema JSON Schema cannot express should not take the whole document
    // down — the rest of the contract is still true, and an empty object says
    // "this accepts an object" without claiming to know which fields.
    console.warn(
      `[openapi] could not describe the input of ${service.def.name}`,
      error,
    );
    return { type: "object" };
  }
}

function outputSchema(service: Service): unknown {
  if (!service.def.output) return { type: "object" };
  return jsonSchema(service.def.output, "output");
}

/**
 * Everything this instance can do, as OpenAPI 3.1.
 *
 * Built from the registry at request time rather than at build time, because
 * §28's point is that *this* instance's contract reflects *its* enabled
 * modules and plugins — including one installed an hour ago.
 */
export function buildOpenApi(options: OpenApiOptions): Record<string, unknown> {
  const services = [...listServices().values()].sort((a, b) =>
    a.def.name.localeCompare(b.def.name),
  );

  const paths: Record<string, unknown> = {};
  for (const service of services) {
    const { name, summary, kind, permission } = service.def;
    const schema = inputSchema(service);
    const tag = name.split(".")[0]!;

    // Written into the description rather than left implicit: a caller reading
    // this is deciding which scope to ask their owner for, and the answer is
    // mechanical — the service name, or its family.
    const description = [
      summary,
      "",
      service.def.stepUp
        ? "Requires a signed-in person whose second-factor proof is no more than ten minutes old; API keys cannot call it."
        : service.def.agentCallable === false
          ? "Requires a signed-in person; API keys cannot call this human-review operation."
        : permission === "public"
        ? "Open to anyone, including callers with no credential."
        : permission === "authenticated"
          ? "Requires a signed-in person and is not available to API keys."
          : `Requires ${kind === "query" ? "view" : "manage"} access to the ${tag} module, or an API key scoped \`${name}\` or \`${tag}.*\`.`,
      service.def.rateLimit ? `\nRate limited: ${service.def.rateLimit.message}` : "",
    ]
      .join("\n")
      .trim();

    const responses = {
      "200": {
        description: "The service's result.",
        content: { "application/json": { schema: outputSchema(service) } },
      },
      ...errorResponses(),
    };

    const operations: Record<string, unknown> = {};
    if (kind === "query") {
      // A query is a GET whose input is the query string, and the same call is
      // available as a POST for inputs a query string cannot express — see
      // coerceQuery in dispatch.ts.
      operations.get = {
        operationId: name,
        summary,
        description,
        tags: [tag],
        parameters: [
          {
            name: "input",
            in: "query",
            required: false,
            description:
              "Each field is its own query parameter. Values that look like JSON (true, 42, [..], {..}) are parsed as JSON; anything else is a string. POST the same body as JSON when that is ambiguous.",
            schema,
          },
        ],
        responses,
      };
    }
    operations.post = {
      operationId: kind === "query" ? `${name}.post` : name,
      summary,
      description,
      tags: [tag],
      requestBody: {
        required: true,
        content: { "application/json": { schema } },
      },
      responses,
    };

    paths[`${API_BASE}/${name}`] = operations;
  }

  return {
    openapi: "3.1.0",
    info: {
      title: `${options.title} — Freeholder API`,
      version: options.version,
      description: [
        "Every service this instance exposes, generated from the same Zod schemas that validate each request (MASTER.md §28).",
        "",
        "Authenticate with `Authorization: Bearer <api key>`. Keys are minted in Settings, and each one is scoped to the services it may call.",
        "",
        "Responses are generated from the same output schemas that validate handler returns in development and tests (C3.01).",
      ].join("\n"),
    },
    servers: [{ url: options.origin }],
    security: [{ bearerAuth: [] }],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: "http",
          scheme: "bearer",
          description: "An API key from Settings → API keys.",
        },
      },
    },
    tags: [...new Set(services.map((s) => s.def.name.split(".")[0]!))]
      .sort()
      .map((name) => ({ name })),
    paths,
  };
}
