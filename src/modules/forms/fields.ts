// Copyright (C) 2026 Camp Denman Society
// SPDX-License-Identifier: AGPL-3.0-only
// What a form field is, and how a submission is checked against one.
//
// The same idea as the block registry (§32): the *kinds* of field are code and
// the fields themselves are data. An owner adding a question writes a row; the
// validator that accepts their visitors' answers is derived from it, so the
// two can never disagree.
//
// Deliberately a small set. Every field kind here maps to an input a browser
// renders natively, with a keyboard that suits it on a phone — a date picker
// or a file upload would each bring a week of accessibility work, and neither
// is what a lead-capture form is for.
import { z } from "zod";

export const FIELD_KINDS = [
  "text",
  "email",
  "tel",
  "multiline",
  "select",
  "checkbox",
  "number",
] as const;

export type FieldKind = (typeof FIELD_KINDS)[number];

export const fieldSchema = z.object({
  /** Stable key the answer is stored under. Never shown to a visitor. */
  key: z
    .string()
    .min(1)
    .max(40)
    .regex(/^[a-z][a-z0-9_]*$/, "Use lower-case letters, digits and underscores."),
  label: z.string().min(1).max(120),
  kind: z.enum(FIELD_KINDS),
  required: z.boolean().default(false),
  placeholder: z.string().max(120).optional(),
  help: z.string().max(300).optional(),
  /** For `select`. Ignored by every other kind. */
  options: z.array(z.string().min(1).max(120)).optional(),
  maxLength: z.number().int().positive().max(5000).optional(),
});

export type FormField = z.output<typeof fieldSchema>;
/**
 * A field as it is *written* — `required` has a default, so seed data and
 * imports need not restate it. The output type is what everything downstream
 * reads.
 */
export type FormFieldInput = z.input<typeof fieldSchema>;

/**
 * The field list, checked for the mistakes that only show up at submit time.
 *
 * Duplicate keys are the interesting one: two fields called `name` render
 * fine, and then one silently overwrites the other in the stored answer.
 */
export const fieldsSchema = z
  .array(fieldSchema)
  .max(50)
  .superRefine((fields, ctx) => {
    const seen = new Set<string>();
    for (const field of fields) {
      if (seen.has(field.key)) {
        ctx.addIssue({
          code: "custom",
          message: `Two fields share the key "${field.key}"; the second would overwrite the first.`,
        });
      }
      seen.add(field.key);
      if (field.kind === "select" && (field.options ?? []).length === 0) {
        ctx.addIssue({
          code: "custom",
          message: `The field "${field.key}" is a dropdown with no options.`,
        });
      }
    }
  });

/** One field's answer, as a schema. Built at submit time from the definition. */
function answerSchema(field: FormField): z.ZodType {
  const optional = <T extends z.ZodType>(schema: T) =>
    field.required ? schema : schema.optional();

  switch (field.kind) {
    case "email":
      // Trimmed and lowercased here so the spine sees the same address
      // whatever a visitor's keyboard capitalised (§4.1: one contact per
      // email address).
      return optional(
        z
          .string()
          .trim()
          .toLowerCase()
          .pipe(z.string().email(`${field.label} does not look like an email address.`)),
      );
    case "number":
      return optional(z.coerce.number({ message: `${field.label} must be a number.` }));
    case "checkbox":
      // An unchecked box sends nothing at all, so absence is false — and a
      // required checkbox is a consent box, which must be *true*.
      return field.required
        ? z.literal(true, { message: `${field.label} is required.` })
        : z.boolean().default(false);
    case "select":
      return optional(
        z.enum((field.options ?? []) as [string, ...string[]], {
          message: `Choose one of the options for ${field.label}.`,
        }),
      );
    default: {
      let schema = z.string().trim().max(field.maxLength ?? 2000);
      if (field.required) schema = schema.min(1, `${field.label} is required.`);
      return field.required ? schema : schema.optional();
    }
  }
}

/**
 * A Zod object that accepts exactly what this form asked for.
 *
 * Unknown keys are stripped rather than rejected: a bot posting extra fields
 * is not worth a 400, and a form edited between render and submit should not
 * lose the answer somebody typed.
 */
export function submissionSchema(fields: FormField[]): z.ZodType {
  return z.object(
    Object.fromEntries(fields.map((field) => [field.key, answerSchema(field)])),
  );
}

/** The email a submission identifies the visitor by, if it asked for one. */
export function emailFrom(
  fields: FormField[],
  data: Record<string, unknown>,
): string | undefined {
  const field = fields.find((f) => f.kind === "email");
  const value = field ? data[field.key] : undefined;
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/**
 * A display name for the contact, from whatever the form happens to ask.
 *
 * Falls back to the email's local part rather than "Unknown": a contact list
 * full of "Unknown" is a contact list nobody opens.
 */
export function nameFrom(
  fields: FormField[],
  data: Record<string, unknown>,
  email?: string,
): string {
  const named = fields.find(
    (f) => f.kind === "text" && /^(name|full_name|first_name)$/.test(f.key),
  );
  const value = named ? data[named.key] : undefined;
  if (typeof value === "string" && value.trim()) return value.trim();

  const anyText = fields.find((f) => f.kind === "text");
  const fallback = anyText ? data[anyText.key] : undefined;
  if (typeof fallback === "string" && fallback.trim()) return fallback.trim();

  return email ? (email.split("@")[0] ?? email) : "Form submission";
}
