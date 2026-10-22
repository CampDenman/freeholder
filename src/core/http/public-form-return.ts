// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// What a refused public form tells the visitor, and what it gives back.
//
// The public forms are Server Actions that redirect, so the page re-renders
// from scratch: without help, every refusal wiped what the visitor had typed
// and said "check the fields below" whether or not a field was wrong — a
// playground refusal or a server fault included (2026-10-22 audit). Two
// things fix that without a client component on the public surface:
//
//   - a *reason code* in the URL — never text, for the phishing reason in
//     app/(public)/form-actions.ts — so the page can say honestly whether the
//     answers need another look, the visitor should wait, the action is not
//     available here, or the fault was ours; and
//   - the visitor's own answers, returned to their own browser in a
//     short-lived httpOnly cookie the routing layer reads on the next render,
//     so the form comes back filled in.
//
// The reasons stay coarse on purpose. Spam traps still answer "sent", and
// "invalid" does not say which rule tripped beyond what the form's own
// fields already state.
import { env } from "@/core/env";
import { ServiceError } from "@/core/service";

export type PublicFailure = "invalid" | "busy" | "unavailable" | "server";

export const PUBLIC_FAILURES: readonly PublicFailure[] = ["invalid", "busy", "unavailable", "server"];

export function publicFailure(error: unknown): PublicFailure {
  if (!(error instanceof ServiceError)) return "server";
  switch (error.code) {
    case "validation":
    case "conflict":
    case "not_found":
      return "invalid";
    case "rate_limited":
      return "busy";
    case "permission":
    case "step_up_required":
      return "unavailable";
    default:
      return "server";
  }
}

/** The reason a page was handed, or undefined for anything unrecognised. */
export function failureFromQuery(value: unknown): PublicFailure | undefined {
  return typeof value === "string" && (PUBLIC_FAILURES as readonly string[]).includes(value)
    ? (value as PublicFailure)
    : undefined;
}

export const FORM_RETURN_COOKIE = "fh_form_return";
/** Long enough to survive the redirect, short enough to be gone by tomorrow. */
export const FORM_RETURN_MAX_AGE = 120;
const MAX_VALUE = 2_000;
const MAX_COOKIE = 3_600;

export interface FormReturn {
  /** Which form the answers belong to, e.g. `form:contact`. */
  key: string;
  values: Record<string, string>;
}

/**
 * The cookie value for a refused submission, or null when the answers are
 * too large to carry — the visitor then gets the honest message without the
 * refill, which is the old behaviour rather than a broken cookie.
 */
export function encodeFormReturn(key: string, values: Record<string, unknown>, omit: readonly string[] = []): string | null {
  const kept: Record<string, string> = {};
  for (const [name, value] of Object.entries(values)) {
    if (omit.includes(name)) continue;
    if (typeof value === "string") kept[name] = value.slice(0, MAX_VALUE);
    else if (value === true) kept[name] = "on";
  }
  const encoded = Buffer.from(JSON.stringify({ key, values: kept }), "utf8").toString("base64url");
  return encoded.length > MAX_COOKIE ? null : encoded;
}

export function decodeFormReturn(raw: string | undefined): FormReturn | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as unknown;
    if (!parsed || typeof parsed !== "object") return null;
    const { key, values } = parsed as { key?: unknown; values?: unknown };
    if (typeof key !== "string" || !values || typeof values !== "object") return null;
    const clean: Record<string, string> = {};
    for (const [name, value] of Object.entries(values as Record<string, unknown>)) {
      if (typeof value === "string") clean[name] = value.slice(0, MAX_VALUE);
    }
    return { key, values: clean };
  } catch {
    return null;
  }
}

/** The answers for one form, if this render was handed that form's. */
export function returnedValues(formReturn: FormReturn | null | undefined, key: string): Record<string, string> | undefined {
  return formReturn && formReturn.key === key ? formReturn.values : undefined;
}

/**
 * The catalog key for a refusal. "invalid" (and an old link with no reason)
 * keeps the surface's own wording, which already says what to check; the
 * others are shared, and the playground says plainly that the demo — not the
 * visitor — is the reason.
 */
export function failureMessageKey(failure: PublicFailure | undefined, invalidKey: string): string {
  switch (failure) {
    case "busy":
      return "public.failure.busy";
    case "unavailable":
      return env().FREEHOLDER_PLAYGROUND === "1" ? "public.failure.playground" : "public.failure.unavailable";
    case "server":
      return "public.failure.server";
    default:
      return invalidKey;
  }
}
