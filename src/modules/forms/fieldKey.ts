// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: AGPL-3.0-only
// Turning a question into the key its answers are stored under.
//
// Lives beside `fields.ts` rather than in the builder that calls it, because
// the two have to agree exactly: `fieldSchema.key` is
// `/^[a-z][a-z0-9_]*$/`, and a builder that can produce anything else is a
// builder that fails validation on a label somebody was always going to type.
// A key that came from a label like "¿Cuál es tu teléfono?" is the normal
// case, not the exotic one.
const MAX = 40;

/**
 * A key for `label`, avoiding everything in `taken`.
 *
 * Derived rather than asked for: nobody setting up a contact form should have
 * to invent an identifier, and the ones people invent by hand are the ones
 * that collide. It stays editable in the builder — a derived key can be ugly —
 * but only until an answer has been stored under it, after which changing it
 * orphans every past answer.
 */
export function deriveFieldKey(label: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  const base =
    label
      .normalize("NFD")
      .replace(/\p{Diacritic}/gu, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      // The schema wants a letter first, and "2026" is a plausible label.
      .replace(/^([0-9])/, "q$1")
      .slice(0, MAX) || "question";

  if (!used.has(base)) return base;
  for (let n = 2; n < 1000; n++) {
    const suffix = `_${n}`;
    const candidate = `${base.slice(0, MAX - suffix.length)}${suffix}`;
    if (!used.has(candidate)) return candidate;
  }
  // Unreachable with a 50-field ceiling; still not a silent duplicate.
  throw new Error("Too many questions share that wording.");
}
