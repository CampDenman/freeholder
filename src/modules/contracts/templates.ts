// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Rendering an agreement from a template (MASTER.md §4.3, C6.14).
//
// C6.09 built the half that matters legally: a signed document is a snapshot
// of the words somebody read, hashed, with the signature's identifying facts
// beside it. This is the authoring half, and it renders **into** that snapshot
// rather than replacing it — which is why the substitution here is
// deliberately unclever.
//
// **Variables are replaced, never evaluated.** `{{customer_name}}` is a
// lookup, not an expression. A template language with logic in it is a
// template language somebody can be talked into running, and the thing being
// produced is a document a court may read: it has to say exactly what the
// owner wrote plus the values the platform filled in, and nothing that emerged
// from a loop.
//
// **An unknown variable is left visible, not blanked.** A contract that
// silently says "Dear ," because a field was empty is worse than one that says
// `{{customer_name}}` — the second is obviously wrong to whoever proofreads
// it, and the first is obviously wrong only to the person receiving it.
import { z } from "zod";

/** `{{name}}`, with optional spaces. Nothing else is syntax. */
const VARIABLE = /\{\{\s*([a-z][a-z0-9_]{0,40})\s*\}\}/gi;

export const templateVariable = z.object({
  key: z.string().trim().regex(/^[a-z][a-z0-9_]{0,40}$/i),
  label: z.string().trim().min(1).max(120),
  /** What to put there when nothing supplies a value. */
  fallback: z.string().trim().max(500).nullable(),
});

export type TemplateVariable = z.infer<typeof templateVariable>;

/** Every variable a body mentions, in the order it first mentions them. */
export function variablesIn(body: string): string[] {
  const found: string[] = [];
  for (const match of body.matchAll(VARIABLE)) {
    const key = match[1]!.toLowerCase();
    if (!found.includes(key)) found.push(key);
  }
  return found;
}

export interface RenderResult {
  body: string;
  /** Variables the template asked for that nothing supplied. */
  missing: string[];
}

/**
 * Fill a template's variables from a set of values.
 *
 * One pass over the source rather than a replace per variable, which matters
 * for a reason that is easy to miss: replacing one at a time means a *value*
 * containing `{{something}}` gets substituted on the next pass. A customer
 * whose company name happened to contain double braces should not be able to
 * reach into the contract, and the single pass is what makes that impossible
 * rather than unlikely.
 */
export function renderTemplate(
  body: string,
  values: Readonly<Record<string, string | null | undefined>>,
  declared: readonly TemplateVariable[] = [],
): RenderResult {
  const fallbacks = new Map(
    declared.map((variable) => [variable.key.toLowerCase(), variable.fallback]),
  );
  const missing: string[] = [];
  const rendered = body.replace(VARIABLE, (whole, rawKey: string) => {
    const key = rawKey.toLowerCase();
    const supplied = values[key];
    if (supplied != null && supplied !== "") return supplied;
    const fallback = fallbacks.get(key);
    if (fallback != null && fallback !== "") return fallback;
    if (!missing.includes(key)) missing.push(key);
    // Left visible on purpose. "Dear ," is wrong only to the person receiving
    // it; `{{customer_name}}` is wrong to whoever proofreads it.
    return whole;
  });
  return { body: rendered, missing };
}
