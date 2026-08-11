// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: AGPL-3.0-only
// Owner-defined typed fields over the Contact spine's deliberate JSONB seam.
import { and, asc, count, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import {
  contacts,
  customFieldDefinitions,
  organizations,
} from "@/core/contacts/schema";
import { isUniqueViolation } from "@/core/db";
import { defineService, ServiceError, type Tx } from "@/core/service";

export const CUSTOM_FIELD_ENTITIES = ["contact", "organization"] as const;
export const CUSTOM_FIELD_KINDS = [
  "text",
  "number",
  "boolean",
  "date",
  "select",
] as const;

export type CustomFieldEntity = (typeof CUSTOM_FIELD_ENTITIES)[number];
export type CustomFieldKind = (typeof CUSTOM_FIELD_KINDS)[number];

const entitySchema = z.enum(CUSTOM_FIELD_ENTITIES);
const kindSchema = z.enum(CUSTOM_FIELD_KINDS);
const keySchema = z
  .string()
  .trim()
  .min(1)
  .max(50)
  .regex(/^[a-z][a-z0-9_]*$/, "Use lowercase letters, numbers, and underscores.");
const optionSchema = z.string().trim().min(1).max(100);
const optionsSchema = z
  .array(optionSchema)
  .max(50)
  .default([])
  .transform((values) => [...new Set(values)]);

function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function normalizeValue(
  definition: typeof customFieldDefinitions.$inferSelect,
  value: unknown,
): string | number | boolean | undefined {
  if (value === null || value === undefined || value === "") return undefined;
  switch (definition.kind) {
    case "text":
      if (typeof value !== "string" || value.length > 5_000) {
        throw new ServiceError(
          "validation",
          `${definition.label} must be text no longer than 5,000 characters.`,
        );
      }
      return value;
    case "number":
      if (typeof value !== "number" || !Number.isFinite(value)) {
        throw new ServiceError("validation", `${definition.label} must be a number.`);
      }
      return value;
    case "boolean":
      if (typeof value !== "boolean") {
        throw new ServiceError("validation", `${definition.label} must be yes or no.`);
      }
      return value;
    case "date":
      if (typeof value !== "string" || !isCalendarDate(value)) {
        throw new ServiceError(
          "validation",
          `${definition.label} must be a calendar date in YYYY-MM-DD form.`,
        );
      }
      return value;
    case "select":
      if (typeof value !== "string" || !definition.options.includes(value)) {
        throw new ServiceError(
          "validation",
          `${definition.label} must be one of its configured choices.`,
        );
      }
      return value;
  }
}

/** Validate a caller's patch and preserve fields it did not address. */
export async function applyCustomFieldPatch(
  tx: Tx,
  entity: CustomFieldEntity,
  patch: Record<string, unknown>,
  existing: Record<string, unknown> = {},
): Promise<Record<string, unknown>> {
  const entries = Object.entries(patch);
  if (entries.length === 0) return { ...existing };
  const definitions = await tx
    .select()
    .from(customFieldDefinitions)
    .where(
      and(
        eq(customFieldDefinitions.entity, entity),
        inArray(
          customFieldDefinitions.key,
          entries.map(([key]) => key),
        ),
      ),
    );
  const byKey = new Map(definitions.map((definition) => [definition.key, definition]));
  const result = { ...existing };
  for (const [key, value] of entries) {
    const definition = byKey.get(key);
    if (!definition || !definition.active) {
      throw new ServiceError(
        "validation",
        `Custom field "${key}" is not active for this ${entity}.`,
      );
    }
    const normalized = normalizeValue(definition, value);
    if (normalized === undefined) delete result[key];
    else result[key] = normalized;
  }
  return result;
}

export const createCustomField = defineService({
  name: "contacts.createCustomField",
  summary: "Define a typed field an owner can use on contacts or organizations.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({
    entity: entitySchema,
    key: keySchema,
    label: z.string().trim().min(1).max(100),
    kind: kindSchema,
    helpText: z.string().trim().max(300).nullable().optional(),
    options: optionsSchema,
    position: z.number().int().min(0).max(10_000).default(0),
  }),
  handler: async (input, ctx) => {
    if (input.kind === "select" && input.options.length === 0) {
      throw new ServiceError("validation", "A choice field needs at least one choice.");
    }
    if (input.kind !== "select" && input.options.length > 0) {
      throw new ServiceError("validation", "Only a choice field can have choices.");
    }
    try {
      const [definition] = await ctx.tx
        .insert(customFieldDefinitions)
        .values(input)
        .returning();
      ctx.setSubject("customField", definition!.id);
      return definition!;
    } catch (error) {
      if (isUniqueViolation(error, "custom_field_definitions_entity_key_idx")) {
        throw new ServiceError(
          "conflict",
          `The key "${input.key}" is already used for ${input.entity} fields.`,
        );
      }
      throw error;
    }
  },
});

async function removedChoiceInUse(
  tx: Tx,
  entity: CustomFieldEntity,
  key: string,
  removed: string[],
): Promise<boolean> {
  if (removed.length === 0) return false;
  const [row] =
    entity === "contact"
      ? await tx
          .select({ n: count() })
          .from(contacts)
          .where(
            inArray(sql<string>`${contacts.customFields} ->> ${key}`, removed),
          )
      : await tx
          .select({ n: count() })
          .from(organizations)
          .where(
            inArray(
              sql<string>`${organizations.customFields} ->> ${key}`,
              removed,
            ),
          );
  return (row?.n ?? 0) > 0;
}

export const updateCustomField = defineService({
  name: "contacts.updateCustomField",
  summary: "Change a custom field's owner-visible definition without orphaning values.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({
    id: z.string().uuid(),
    label: z.string().trim().min(1).max(100).optional(),
    helpText: z.string().trim().max(300).nullable().optional(),
    options: optionsSchema.optional(),
    position: z.number().int().min(0).max(10_000).optional(),
    active: z.boolean().optional(),
  }),
  handler: async (input, ctx) => {
    const [definition] = await ctx.tx
      .select()
      .from(customFieldDefinitions)
      .where(eq(customFieldDefinitions.id, input.id))
      .limit(1);
    if (!definition) throw new ServiceError("not_found", "That custom field no longer exists.");
    if (input.options && definition.kind !== "select") {
      throw new ServiceError("validation", "Only a choice field can have choices.");
    }
    if (input.options && input.options.length === 0) {
      throw new ServiceError("validation", "A choice field needs at least one choice.");
    }
    if (input.options) {
      const removed = definition.options.filter((option) => !input.options!.includes(option));
      if (await removedChoiceInUse(ctx.tx, definition.entity, definition.key, removed)) {
        throw new ServiceError(
          "conflict",
          "A removed choice is still used. Change those records before removing it.",
        );
      }
    }
    const { id, ...changes } = input;
    if (Object.keys(changes).length === 0) {
      throw new ServiceError("validation", "Choose something to change.");
    }
    const [updated] = await ctx.tx
      .update(customFieldDefinitions)
      .set(changes)
      .where(eq(customFieldDefinitions.id, id))
      .returning();
    ctx.setSubject("customField", id);
    return updated!;
  },
});

export const listCustomFields = defineService({
  name: "contacts.listCustomFields",
  summary: "List the typed fields configured for contacts and organizations.",
  kind: "query",
  permission: "scoped",
  input: z.object({
    entity: entitySchema.optional(),
    includeInactive: z.boolean().default(false),
  }),
  handler: (input, ctx) =>
    ctx.tx
      .select()
      .from(customFieldDefinitions)
      .where(
        and(
          input.entity ? eq(customFieldDefinitions.entity, input.entity) : undefined,
          input.includeInactive ? undefined : eq(customFieldDefinitions.active, true),
        ),
      )
      .orderBy(
        asc(customFieldDefinitions.entity),
        asc(customFieldDefinitions.position),
        asc(customFieldDefinitions.label),
      ),
});

export default [createCustomField, updateCustomField, listCustomFields];
