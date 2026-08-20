// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// A playbook's parameters, declared as data (C4.08, MASTER.md §40).
//
// Deliberately a small closed vocabulary rather than "any JSON Schema": these
// definitions are rendered as a form an owner fills in, exported to other
// instances, and interpolated into a prompt. A spec small enough to render
// and validate exactly is worth more here than one big enough to express
// anything and validate approximately.
import { z } from "zod";
import { ServiceError } from "@/core/service";

export const PARAM_TYPES = ["string", "text", "number", "boolean", "choice"] as const;

export const playbookParam = z.object({
  name: z
    .string()
    .trim()
    .min(1)
    .max(60)
    // The name is a template placeholder, so it must be substitutable
    // without quoting rules: letters, digits and underscores only.
    .regex(/^[a-z][a-z0-9_]*$/i, "use letters, digits and underscores"),
  label: z.string().trim().min(1).max(120),
  type: z.enum(PARAM_TYPES).default("string"),
  required: z.boolean().default(false),
  /** Only meaningful for `choice`; ignored elsewhere. */
  choices: z.array(z.string().trim().min(1).max(120)).max(50).default([]),
  help: z.string().trim().max(500).optional(),
});

export type PlaybookParam = z.output<typeof playbookParam>;

export const playbookParamsSchema = z.object({
  params: z.array(playbookParam).max(30).default([]),
});

export function parseParamsSchema(value: unknown): PlaybookParam[] {
  const parsed = playbookParamsSchema.safeParse(value ?? {});
  return parsed.success ? parsed.data.params : [];
}

/**
 * Check the values an owner supplied against what the playbook declares.
 *
 * Undeclared values are dropped rather than passed through: a template can
 * only interpolate what it declared, so anything else is either a typo or an
 * attempt to reach past the form, and neither should reach a prompt.
 */
export function validateParamValues(
  params: PlaybookParam[],
  values: Record<string, unknown>,
): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  for (const param of params) {
    const value = values[param.name];
    // Only scalars survive the door. A nested object or array here is either
    // a mistake or somebody probing the form, and either way it must not be
    // stringified into a prompt as "[object Object]".
    const raw: string | number | boolean | null | undefined =
      value === null ||
      value === undefined ||
      typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "boolean"
        ? value
        : null;
    if (value !== null && value !== undefined && raw === null) {
      throw new ServiceError("validation", `${param.label} must be a single value.`);
    }
    const missing = raw === undefined || raw === null || raw === "";
    if (missing) {
      if (param.required) {
        throw new ServiceError("validation", `${param.label} is required.`);
      }
      continue;
    }
    if (param.type === "number") {
      const value = typeof raw === "number" ? raw : Number(String(raw).trim());
      if (!Number.isFinite(value)) {
        throw new ServiceError("validation", `${param.label} must be a number.`);
      }
      out[param.name] = value;
      continue;
    }
    if (param.type === "boolean") {
      out[param.name] =
        typeof raw === "boolean" ? raw : ["true", "yes", "on", "1"].includes(String(raw).toLowerCase());
      continue;
    }
    const text = String(raw).trim();
    if (param.type === "choice" && !param.choices.includes(text)) {
      throw new ServiceError(
        "validation",
        `${param.label} must be one of: ${param.choices.join(", ")}.`,
      );
    }
    if (text.length > 10_000) {
      throw new ServiceError("validation", `${param.label} is too long.`);
    }
    out[param.name] = text;
  }
  return out;
}

/**
 * Fill `{{name}}` placeholders from validated values.
 *
 * Only declared names are substituted, and an undeclared placeholder is left
 * standing rather than blanked: a brief that reads `{{custmer}}` in the run
 * view is a typo an owner can see and fix, where an empty gap is a silent
 * change of meaning.
 */
export function renderBrief(
  template: string,
  values: Record<string, string | number | boolean>,
): string {
  return template.replace(/\{\{\s*([a-z][a-z0-9_]*)\s*\}\}/gi, (whole, name: string) =>
    name in values ? String(values[name]) : whole,
  );
}
