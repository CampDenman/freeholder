// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Typed @freeholder/sdk source generated from the live registry (C3.03).
import { toContractJsonSchema } from "@/core/contract/json-schema";
import { listExternalServices, type Service } from "@/core/service";

const HEADER = `// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Generated from the live service registry (MASTER.md §28, C3.03).
// Do not edit. Regenerate with \`pnpm sdk:generate\`.
`;

const IDENT = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

export interface SdkCatalog {
  names: string[];
  pageable: string[];
  source: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNumericSchema(schema: unknown): boolean {
  if (!isRecord(schema)) return false;
  return schema.type === "number" || schema.type === "integer";
}

function isArraySchema(schema: unknown): boolean {
  return isRecord(schema) && schema.type === "array";
}

function requiredKeys(schema: unknown): string[] {
  if (!isRecord(schema) || !Array.isArray(schema.required)) return [];
  return schema.required.filter((key): key is string => typeof key === "string");
}

function propertiesOf(schema: unknown): Record<string, unknown> {
  if (!isRecord(schema) || !isRecord(schema.properties)) return {};
  return schema.properties;
}

/** Offset/limit in, `{ rows, total }` out — the only list shape `paginate` understands. */
export function isPageableSchema(input: unknown, output: unknown): boolean {
  const inputProps = propertiesOf(input);
  const outputProps = propertiesOf(output);
  return (
    isNumericSchema(inputProps.offset) &&
    isNumericSchema(inputProps.limit) &&
    isArraySchema(outputProps.rows) &&
    isNumericSchema(outputProps.total)
  );
}

function quoteProp(name: string): string {
  return IDENT.test(name) ? name : JSON.stringify(name);
}

function wrapUnion(type: string, parens: boolean): string {
  return parens && /[|&]/.test(type) ? `(${type})` : type;
}

function defsOf(schema: unknown): Record<string, unknown> {
  if (!isRecord(schema)) return {};
  const defs = schema.$defs ?? schema.definitions;
  return isRecord(defs) ? defs : {};
}

function resolveRef(ref: string, defs: Record<string, unknown>): unknown {
  const match = /^#\/(?:\$defs|definitions)\/(.+)$/.exec(ref);
  if (!match) return undefined;
  const key = match[1]!.replace(/~1/g, "/").replace(/~0/g, "~");
  return defs[key];
}

export function jsonSchemaToTs(
  schema: unknown,
  options: { parens?: boolean; defs?: Record<string, unknown>; seen?: Set<string> } = {},
): string {
  const defs = options.defs ?? defsOf(schema);
  const seen = options.seen ?? new Set<string>();
  const parens = options.parens ?? false;

  if (schema === true) return "unknown";
  if (schema === false) return "never";
  if (!isRecord(schema)) return "unknown";

  if (typeof schema.$ref === "string") {
    if (seen.has(schema.$ref)) return "unknown";
    const resolved = resolveRef(schema.$ref, defs);
    if (resolved === undefined) return "unknown";
    seen.add(schema.$ref);
    const type = jsonSchemaToTs(resolved, { parens, defs, seen });
    seen.delete(schema.$ref);
    return type;
  }

  if (Object.keys(schema).length === 0) return "unknown";

  if ("const" in schema) return JSON.stringify(schema.const);

  if (Array.isArray(schema.enum) && schema.enum.length > 0) {
    const union = schema.enum.map((value) => JSON.stringify(value)).join(" | ");
    return wrapUnion(union, parens);
  }

  const alternatives = schema.anyOf ?? schema.oneOf;
  if (Array.isArray(alternatives) && alternatives.length > 0) {
    const parts = alternatives.map((entry) =>
      jsonSchemaToTs(entry, { parens: true, defs, seen }),
    );
    const unique = [...new Set(parts)];
    if (unique.length === 1) return wrapUnion(unique[0]!, parens);
    return wrapUnion(unique.join(" | "), parens);
  }

  if (Array.isArray(schema.allOf) && schema.allOf.length > 0) {
    const parts = schema.allOf.map((entry) =>
      jsonSchemaToTs(entry, { parens: true, defs, seen }),
    );
    const unique = [...new Set(parts)];
    if (unique.length === 1) return wrapUnion(unique[0]!, parens);
    return wrapUnion(unique.join(" & "), parens);
  }

  const types = Array.isArray(schema.type)
    ? schema.type.filter((entry): entry is string => typeof entry === "string")
    : typeof schema.type === "string"
      ? [schema.type]
      : [];

  if (types.length > 1) {
    const union = types
      .map((type) => jsonSchemaToTs({ ...schema, type }, { parens: true, defs, seen }))
      .join(" | ");
    return wrapUnion(union, parens);
  }

  const type = types[0];
  if (type === "string") return "string";
  if (type === "number" || type === "integer") return "number";
  if (type === "boolean") return "boolean";
  if (type === "null") return "null";

  if (type === "array") {
    if (Array.isArray(schema.prefixItems) && schema.prefixItems.length > 0) {
      const items = schema.prefixItems.map((entry) =>
        jsonSchemaToTs(entry, { defs, seen }),
      );
      return `[${items.join(", ")}]`;
    }
    const items = jsonSchemaToTs(schema.items ?? {}, { parens: true, defs, seen });
    return `${items}[]`;
  }

  if (type === "object" || schema.properties || schema.additionalProperties !== undefined) {
    return objectToTs(schema, defs, seen);
  }

  if (type === undefined) return "unknown";
  return "unknown";
}

function objectToTs(
  schema: Record<string, unknown>,
  defs: Record<string, unknown>,
  seen: Set<string>,
): string {
  const properties = propertiesOf(schema);
  const required = new Set(requiredKeys(schema));
  const additional = schema.additionalProperties;
  const names = Object.keys(properties);
  const extraType =
    additional === false || additional === undefined
      ? undefined
      : additional === true || (isRecord(additional) && Object.keys(additional).length === 0)
        ? "unknown"
        : jsonSchemaToTs(additional, { defs, seen });

  if (names.length === 0) {
    if (extraType) return `{ [key: string]: ${extraType} }`;
    return "Record<string, never>";
  }

  const fields = names.map((name) => {
    const optional = required.has(name) ? "" : "?";
    const value = jsonSchemaToTs(properties[name], { defs, seen });
    return `${quoteProp(name)}${optional}: ${value}`;
  });
  if (extraType) fields.push(`[key: string]: ${extraType}`);
  return `{ ${fields.join("; ")} }`;
}

function serviceSchemas(service: Service): { input: unknown; output: unknown } {
  return {
    input: toContractJsonSchema(service.def.input, "input"),
    output: service.def.output
      ? toContractJsonSchema(service.def.output, "output")
      : { type: "object" },
  };
}

function inputIsOptional(input: unknown): boolean {
  return requiredKeys(input).length === 0;
}

function emitApi(services: Service[]): string {
  const families = new Map<string, Service[]>();
  for (const service of services) {
    const family = service.def.name.split(".")[0]!;
    const list = families.get(family) ?? [];
    list.push(service);
    families.set(family, list);
  }
  const blocks: string[] = ["export interface FreeholderApi {"];
  for (const family of [...families.keys()].sort()) {
    blocks.push(`  ${quoteProp(family)}: {`);
    for (const service of families.get(family)!) {
      const verb = service.def.name.slice(family.length + 1);
      const { input } = serviceSchemas(service);
      const optional = inputIsOptional(input) ? "?" : "";
      const catalog = `ServiceCatalog[${JSON.stringify(service.def.name)}]`;
      blocks.push(
        `    ${quoteProp(verb)}: (input${optional}: ${catalog}["input"]) => Promise<${catalog}["output"]>;`,
      );
    }
    blocks.push("  };");
  }
  blocks.push("}");
  return blocks.join("\n");
}

export function generateSdkCatalog(): SdkCatalog {
  const services = [...listExternalServices().values()].sort((a, b) =>
    a.def.name < b.def.name ? -1 : a.def.name > b.def.name ? 1 : 0,
  );
  const names = services.map((service) => service.def.name);
  const pageable = services
    .filter((service) => {
      const { input, output } = serviceSchemas(service);
      return isPageableSchema(input, output);
    })
    .map((service) => service.def.name);

  const catalogLines = ["export interface ServiceCatalog {"];
  for (const service of services) {
    const { input, output } = serviceSchemas(service);
    catalogLines.push(`  ${JSON.stringify(service.def.name)}: {`);
    catalogLines.push(`    input: ${jsonSchemaToTs(input)};`);
    catalogLines.push(`    output: ${jsonSchemaToTs(output)};`);
    catalogLines.push("  };");
  }
  catalogLines.push("}");

  const nameList = names.map((name) => `  ${JSON.stringify(name)},`).join("\n");
  const pageList = pageable.map((name) => `  ${JSON.stringify(name)},`).join("\n");

  const source = [
    HEADER,
    `export const SERVICE_NAMES = [`,
    nameList,
    `] as const;`,
    ``,
    `export type ServiceName = (typeof SERVICE_NAMES)[number];`,
    ``,
    catalogLines.join("\n"),
    ``,
    `export type ServiceInput<K extends ServiceName> = ServiceCatalog[K]["input"];`,
    `export type ServiceOutput<K extends ServiceName> = ServiceCatalog[K]["output"];`,
    ``,
    `export const PAGEABLE_SERVICES = [`,
    pageList,
    `] as const;`,
    ``,
    `export type PageableService = (typeof PAGEABLE_SERVICES)[number];`,
    ``,
    emitApi(services),
    ``,
  ].join("\n");

  return { names, pageable, source };
}

export function generateSdkSource(): string {
  return generateSdkCatalog().source;
}
