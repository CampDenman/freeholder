// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Form screening, sealed (C3.33, MASTER.md §12, §36).
//
// A screening provider is asked *before* the submission's transaction opens
// (provider I/O never runs inside one), so the public form action asks first
// and hands `forms.submit` a sealed verdict. The seal is an HMAC under
// `SESSION_SECRET`, bound to the form and to these exact answers: a caller
// that skips the form cannot invent "allow", and cannot reuse a verdict
// issued for somebody else's words.
//
// The verdict can only *add* a quarantine reason beside the honeypot and time
// trap, never drop one, and quarantine still stores the submission for the
// owner to review. Fails closed: with no `SESSION_SECRET` no seal is ever
// issued, so while a provider is configured an anonymous submission without a
// valid seal is quarantined as unchecked rather than trusted. A provider that
// is down, slow or refusing seals "unavailable", and the traps decide alone.
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { formScreening, type ScreeningOutcome } from "@/adapters/form-screening";
import { db } from "@/core/db";
import { env } from "@/core/env";
import type { Actor, RequestMetadata } from "@/core/service";
import { messageFrom, type FormField } from "./fields";
import { forms } from "./schema";

const SEAL_VERSION = "v1";
/** Long enough for a slow submit, short enough that a seal is not a credential. */
const SEAL_TTL_MS = 15 * 60 * 1000;

export const UNCHECKED_REASON = "was not checked by the site's spam screening";
export const BLOCKED_REASON = "was flagged by the site's spam screening";

/** Canonical digest of the answers, so a seal cannot travel to other words. */
function answersDigest(values: Record<string, unknown>): string {
  const canonical = JSON.stringify(
    Object.keys(values)
      .sort()
      .map((key) => [key, values[key]]),
  );
  return createHash("sha256").update(canonical).digest("base64url");
}

function signature(secret: string, parts: string[]): string {
  return createHmac("sha256", secret)
    .update(["forms-screening", ...parts].join("|"))
    .digest("base64url");
}

/** A seal for this verdict, or undefined when the site has no secret to sign with. */
export function sealScreening(
  outcome: ScreeningOutcome,
  slug: string,
  values: Record<string, unknown>,
  now = new Date(),
): string | undefined {
  const secret = env().SESSION_SECRET;
  if (!secret) return undefined;
  const issued = String(now.getTime());
  const sig = signature(secret, [SEAL_VERSION, outcome, issued, slug, answersDigest(values)]);
  return `${SEAL_VERSION}.${outcome}.${issued}.${sig}`;
}

/** The sealed outcome, or null when the seal is absent, stale, or not ours. */
export function openScreening(
  token: string | undefined,
  slug: string,
  values: Record<string, unknown>,
  now = new Date(),
): ScreeningOutcome | null {
  const secret = env().SESSION_SECRET;
  if (!token || !secret) return null;
  const [version, outcome, issued, sig] = token.split(".");
  if (version !== SEAL_VERSION || !sig || !issued) return null;
  if (outcome !== "allow" && outcome !== "blocked" && outcome !== "unavailable") return null;
  const age = now.getTime() - Number(issued);
  if (!Number.isFinite(age) || age < -60_000 || age > SEAL_TTL_MS) return null;
  const expected = Buffer.from(signature(secret, [version, outcome, issued, slug, answersDigest(values)]));
  const provided = Buffer.from(sig);
  if (expected.length !== provided.length || !timingSafeEqual(expected, provided)) return null;
  return outcome;
}

/**
 * The quarantine reason screening adds, if any.
 *
 * Only anonymous submissions are screened: the category exists for them, and
 * a signed-in person or a scoped API key is not that.
 */
export function screeningReason(
  token: string | undefined,
  slug: string,
  values: Record<string, unknown>,
  actor: Actor,
): string | null {
  if (!formScreening() || actor.kind !== "anonymous") return null;
  const outcome = openScreening(token, slug, values);
  if (outcome === null) return UNCHECKED_REASON;
  if (outcome === "blocked") return BLOCKED_REASON;
  return null;
}

/**
 * Ask the configured provider about one anonymous public submission, before
 * it is recorded. Undefined when the category is off or the form is unknown
 * (`forms.submit` then refuses or quarantines on its own terms).
 */
export async function screenPublicSubmission(input: {
  slug: string;
  values: Record<string, unknown>;
  request: RequestMetadata | undefined;
}): Promise<string | undefined> {
  const adapter = formScreening();
  if (!adapter) return undefined;
  const [form] = await db()
    .select({ fields: forms.fields })
    .from(forms)
    .where(and(eq(forms.slug, input.slug), isNull(forms.trashedAt)))
    .limit(1);
  if (!form) return undefined;
  const clientIp = input.request?.trustedIp ?? input.request?.ip;
  // The provider's API requires the address; without one there is nothing to
  // ask, and the traps decide alone.
  const outcome: ScreeningOutcome = clientIp
    ? await adapter.assess({
        formRef: `freeholder:${input.slug}`,
        clientIp,
        message: messageFrom(form.fields as FormField[], input.values),
      })
    : "unavailable";
  return sealScreening(outcome, input.slug, input.values);
}
