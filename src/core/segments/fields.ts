// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// What a segment can ask about (MASTER.md §4.14, C7.04).
//
// §4.14: "Segments are the one definition of 'who'. The same saved query drives
// a campaign's audience, a price list's eligibility, an automation's entry
// condition and a report's cohort. A platform with four incompatible ways to
// say 'customers in Ontario who bought twice' is four places to be wrong."
//
// The interesting half of that sentence is "customers in Ontario who bought
// twice", because *bought* belongs to a module. So the field catalogue is a
// registry rather than a list: core contributes what it knows about a contact,
// and a module contributes its own facts when it is enabled. A segment written
// against a module that is later switched off stops matching rather than
// breaking, which is the honest behaviour — the business genuinely no longer
// knows who bought twice.
//
// Every field compiles to a **condition on `contacts.id`**, never a join. Two
// reasons: a segment is composed with AND and OR in arbitrary shapes, and joins
// do not compose that way without duplicating rows; and a correlated `exists`
// keeps each rule independently evaluable, which is what makes C7.04's
// explainability a matter of running one rule rather than diffing two result
// sets.
import { sql, type SQL } from "drizzle-orm";
import { contacts } from "@/core/contacts/schema";

/** What kind of value a field takes, which decides the operators it accepts. */
export type FieldType = "text" | "enum" | "number" | "date" | "boolean" | "tags";

export interface SegmentField {
  /** Stable and namespaced, because it is stored in a saved definition. */
  key: string;
  /** What an owner reads on the rule builder. */
  label: string;
  type: FieldType;
  /** Which module put it here, so a switched-off one can be explained. */
  source: string;
  /** For `enum`, the values offered. */
  options?: readonly string[];
  /**
   * The condition for one rule, over `contacts`.
   *
   * Given an operator and a value, return SQL that is true for the contacts
   * that match. Returning `null` means "this operator makes no sense for this
   * field", which the compiler turns into a refusal rather than a silent pass.
   */
  condition: (op: Operator, value: unknown) => SQL | null;
}

export const OPERATORS = [
  "is",
  "isNot",
  "isOneOf",
  "contains",
  "before",
  "after",
  "inLastDays",
  "atLeast",
  "atMost",
  "isSet",
  "isNotSet",
] as const;

export type Operator = (typeof OPERATORS)[number];

/** Which operators an owner is offered for each kind of value. */
export const OPERATORS_FOR: Record<FieldType, readonly Operator[]> = {
  text: ["is", "isNot", "contains", "isSet", "isNotSet"],
  enum: ["is", "isNot", "isOneOf", "isSet", "isNotSet"],
  number: ["is", "atLeast", "atMost"],
  date: ["before", "after", "inLastDays", "isSet", "isNotSet"],
  boolean: ["is"],
  tags: ["is", "isNot", "isOneOf"],
};

const registry = new Map<string, SegmentField>();

/**
 * Add a field a segment can ask about.
 *
 * Modules call this at import time, the same way they register a contact
 * reference or a privacy source. Registering a key twice is the same bug in
 * every one of those registries — two answers to one question — so the second
 * call wins loudly rather than quietly.
 */
export function registerSegmentField(field: SegmentField): void {
  registry.set(field.key, field);
}

export function segmentFields(): SegmentField[] {
  return [...registry.values()].sort((a, b) => a.key.localeCompare(b.key));
}

export function segmentField(key: string): SegmentField | undefined {
  return registry.get(key);
}

/** A text comparison that ignores case, because an owner typing a town does. */
function textCondition(column: SQL, op: Operator, value: unknown): SQL | null {
  const text = typeof value === "string" ? value : null;
  switch (op) {
    case "is":
      return text === null ? null : sql`lower(${column}) = lower(${text})`;
    case "isNot":
      return text === null ? null : sql`(${column} is null or lower(${column}) <> lower(${text}))`;
    case "contains":
      return text === null ? null : sql`${column} ilike ${`%${text}%`}`;
    case "isSet":
      return sql`${column} is not null and ${column} <> ''`;
    case "isNotSet":
      return sql`(${column} is null or ${column} = '')`;
    default:
      return null;
  }
}

function enumCondition(column: SQL, op: Operator, value: unknown): SQL | null {
  const list = Array.isArray(value) ? value.filter((one) => typeof one === "string") : [];
  switch (op) {
    case "isOneOf":
      // An empty list matches nobody rather than everybody. "One of nothing" is
      // an empty audience, and the other reading sends a campaign to the world.
      return list.length === 0 ? sql`false` : sql`${column} = any(${list})`;
    default:
      return textCondition(column, op, value);
  }
}

function dateCondition(column: SQL, op: Operator, value: unknown): SQL | null {
  switch (op) {
    case "before":
      return typeof value === "string" ? sql`${column} < ${new Date(value)}` : null;
    case "after":
      return typeof value === "string" ? sql`${column} > ${new Date(value)}` : null;
    case "inLastDays": {
      const days = Number(value);
      if (!Number.isFinite(days) || days <= 0 || days > 3_650) return null;
      // Relative rather than absolute, so a saved segment means the same thing
      // in March as it did in January. That is the whole point of a dynamic
      // segment, and freezing a date here would quietly turn one static.
      return sql`${column} > now() - make_interval(days => ${Math.floor(days)})`;
    }
    case "isSet":
      return sql`${column} is not null`;
    case "isNotSet":
      return sql`${column} is null`;
    default:
      return null;
  }
}

/**
 * Core's own fields: what the spine knows about a person without any module.
 *
 * Registered here rather than in a service file so the catalogue is complete
 * the moment anything imports it — a rule builder that renders an empty field
 * list because a service has not been touched yet is a bug nobody diagnoses.
 */
registerSegmentField({
  key: "contact.lifecycleStage",
  label: "Lifecycle stage",
  type: "enum",
  source: "core",
  options: ["lead", "prospect", "customer", "repeat"],
  condition: (op, value) => enumCondition(sql`${contacts.lifecycleStage}`, op, value),
});

registerSegmentField({
  key: "contact.country",
  label: "Country",
  type: "text",
  source: "core",
  condition: (op, value) => textCondition(sql`${contacts.country}`, op, value),
});

registerSegmentField({
  key: "contact.preferredLocale",
  label: "Language",
  type: "text",
  source: "core",
  condition: (op, value) => textCondition(sql`${contacts.preferredLocale}`, op, value),
});

registerSegmentField({
  key: "contact.source",
  label: "Where they came from",
  type: "text",
  source: "core",
  condition: (op, value) => textCondition(sql`${contacts.source}`, op, value),
});

registerSegmentField({
  key: "contact.email",
  label: "Email address",
  type: "text",
  source: "core",
  condition: (op, value) => textCondition(sql`${contacts.email}`, op, value),
});

registerSegmentField({
  key: "contact.tags",
  label: "Tag",
  type: "tags",
  source: "core",
  condition: (op, value) => {
    const list = Array.isArray(value)
      ? value.filter((one): one is string => typeof one === "string")
      : typeof value === "string"
        ? [value]
        : [];
    if (list.length === 0) return op === "isNot" ? sql`true` : sql`false`;
    switch (op) {
      case "is":
        // Every tag, not any: "is tagged VIP and trade" is two facts about one
        // person, and `overlaps` would answer a different question.
        return sql`${contacts.tags} @> ${list}`;
      case "isOneOf":
        return sql`${contacts.tags} && ${list}`;
      case "isNot":
        return sql`not (${contacts.tags} && ${list})`;
      default:
        return null;
    }
  },
});

registerSegmentField({
  key: "contact.createdAt",
  label: "Added",
  type: "date",
  source: "core",
  condition: (op, value) => dateCondition(sql`${contacts.createdAt}`, op, value),
});

/**
 * Marketing consent, derived from the record history rather than a flag.
 *
 * §4.14: consent is a record, not a boolean. The latest decision per purpose
 * wins, and an expired grant is not a grant — so this is the same derivation
 * the sending path uses, expressed once here so an audience and a send can
 * never disagree about who agreed.
 */
registerSegmentField({
  key: "consent.marketingEmail",
  label: "Agreed to marketing email",
  type: "boolean",
  source: "core",
  condition: (op, value) => {
    if (op !== "is") return null;
    const wanted = value === true || value === "true";
    const granted = sql`exists (
      select 1 from consent_records r
      where r.contact_id = ${contacts.id}
        and r.purpose = 'marketing'
        and (r.channel is null or r.channel = 'email')
        and r.occurred_at = (
          select max(r2.occurred_at) from consent_records r2
          where r2.contact_id = r.contact_id
            and r2.purpose = 'marketing'
            and (r2.channel is null or r2.channel = 'email')
        )
        and r.state = 'granted'
        and (r.expires_at is null or r.expires_at > now())
    )`;
    return wanted ? granted : sql`not ${granted}`;
  },
});

/**
 * What core's own scheduling knows (§4.4).
 *
 * Registered here rather than in `core/scheduling` because both are core and a
 * second registration site would only add a place to forget. A *module's*
 * fields go in the module — see `catalog` for the shape.
 *
 * "Completed" rather than "any": a cancelled appointment is not a visit, and a
 * segment that counted it would send "thanks for coming in" to somebody who
 * did not.
 */
registerSegmentField({
  key: "bookings.completedCount",
  label: "Appointments attended",
  type: "number",
  source: "core",
  condition: countOfRelated("bookings", "t.status = 'completed'"),
});

registerSegmentField({
  key: "bookings.lastCompletedAt",
  label: "Last appointment",
  type: "date",
  source: "core",
  condition: lastRelatedAt("bookings", "starts_at", "t.status = 'completed'"),
});

registerSegmentField({
  key: "bookings.upcomingCount",
  label: "Appointments booked ahead",
  type: "number",
  source: "core",
  condition: countOfRelated(
    "bookings",
    "t.starts_at > now() and t.status in ('requested', 'confirmed')",
  ),
});

/**
 * A helper for the shape almost every module field takes: "how many rows in
 * that table point at this contact", and "when was the most recent one".
 *
 * A correlated subquery rather than a join, so rules compose with AND and OR
 * without a contact appearing twice, and so one rule can be evaluated on its
 * own for an explanation.
 */
export function countOfRelated(
  table: string,
  where: string,
): (op: Operator, value: unknown) => SQL | null {
  return (op, value) => {
    const n = Number(value);
    if (!Number.isFinite(n) || n < 0 || n > 1_000_000) return null;
    const counted = sql`(select count(*) from ${sql.raw(table)} t where t.contact_id = ${contacts.id} and ${sql.raw(where)})`;
    switch (op) {
      case "is":
        return sql`${counted} = ${Math.floor(n)}`;
      case "atLeast":
        return sql`${counted} >= ${Math.floor(n)}`;
      case "atMost":
        return sql`${counted} <= ${Math.floor(n)}`;
      default:
        return null;
    }
  };
}

/** The same shape for "when did they last…", which is the other half of a cohort. */
export function lastRelatedAt(
  table: string,
  column: string,
  where: string,
): (op: Operator, value: unknown) => SQL | null {
  return (op, value) =>
    dateCondition(
      sql`(select max(t.${sql.raw(column)}) from ${sql.raw(table)} t where t.contact_id = ${contacts.id} and ${sql.raw(where)})`,
      op,
      value,
    );
}

/**
 * "Has spent at least" — the other question a cohort asks.
 *
 * Minor units throughout (§15.4), so the value an owner types in pounds is
 * converted by the caller and never by a `toFixed` anywhere near this.
 */
export function sumOfRelated(
  table: string,
  column: string,
  where: string,
): (op: Operator, value: unknown) => SQL | null {
  return (op, value) => {
    const n = Number(value);
    if (!Number.isInteger(n) || n < 0) return null;
    const summed = sql`(select coalesce(sum(t.${sql.raw(column)}), 0) from ${sql.raw(table)} t where t.contact_id = ${contacts.id} and ${sql.raw(where)})`;
    switch (op) {
      case "is":
        return sql`${summed} = ${n}`;
      case "atLeast":
        return sql`${summed} >= ${n}`;
      case "atMost":
        return sql`${summed} <= ${n}`;
      default:
        return null;
    }
  };
}
