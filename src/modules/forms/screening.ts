// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Form screening, sealed (C3.33, MASTER.md §12, §36), and the site-form seal
// the lead sink relies on (C3.34).
//
// The site's own form surfaces (the page form block and the booking intake
// form) call `sealSiteSubmission` before `forms.submit`. When a screening
// provider is configured it is asked first, outside any transaction, but only
// after Freeholder's own traps and a per-client budget have had their say: a
// submission the honeypot or time trap already flags, or a client over its
// budget, never reaches the provider. The outcome travels to `forms.submit`
// sealed with an HMAC under `SESSION_SECRET`, bound to the form and to these
// exact answers, so it cannot be invented or moved to other words.
//
// The seal does two jobs:
// - screening: a "blocked" outcome adds one quarantine reason beside the
//   honeypot and time trap. Nothing here can remove a reason, and quarantine
//   keeps the submission for review rather than dropping it.
// - provenance: a valid seal proves the submission came through a form that
//   showed the provider notice, which is what the lead sink requires before
//   copying anything.
//
// Screening covers anonymous submissions on every path. While a provider is
// configured, an anonymous submission without a valid seal — posted straight
// to the public API or MCP, a forged or stale seal, or any submission at all
// when `SESSION_SECRET` is unset (no seal is ever issued then) — is held as
// unchecked. Only authenticated callers (owner and staff sessions, API keys,
// agents) are exempt from the seal. The traps and the per-form rate limit in
// `forms.submit` apply to everyone. A submission without a seal is never
// copied to the lead sink.
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { formScreening, type ScreeningOutcome } from "@/adapters/form-screening";
import { leadSink } from "@/adapters/lead-sink";
import { db } from "@/core/db";
import { env } from "@/core/env";
import { clientNetwork, consume } from "@/core/security/rate-limit";
import type { Actor, RequestMetadata } from "@/core/service";
import { inspect } from "./antispam";
import type { FormField } from "./fields";
import { forms } from "./schema";

const SEAL_VERSION = "v1";
/** Long enough for a slow submit, short enough that a seal is not a credential. */
const SEAL_TTL_MS = 15 * 60 * 1000;
/** Provider calls one client may cause per form, matching `forms.submit`'s own limit. */
const SCREENING_BUDGET = { limit: 30, windowSeconds: 10 * 60 };

/** What a seal can carry: a provider outcome, or "not asked". */
export type SealedOutcome = ScreeningOutcome | "unscreened";
const OUTCOMES = new Set<SealedOutcome>(["allow", "blocked", "unavailable", "unscreened"]);

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

/** A seal for this outcome, or undefined when the site has no secret to sign with. */
export function sealScreening(
  outcome: SealedOutcome,
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
): SealedOutcome | null {
  const secret = env().SESSION_SECRET;
  if (!token || !secret) return null;
  const [version, outcome, issued, sig] = token.split(".");
  if (version !== SEAL_VERSION || !sig || !issued) return null;
  if (!outcome || !OUTCOMES.has(outcome as SealedOutcome)) return null;
  const age = now.getTime() - Number(issued);
  if (!Number.isFinite(age) || age < -60_000 || age > SEAL_TTL_MS) return null;
  const expected = Buffer.from(signature(secret, [version, outcome, issued, slug, answersDigest(values)]));
  const provided = Buffer.from(sig);
  if (expected.length !== provided.length || !timingSafeEqual(expected, provided)) return null;
  return outcome as SealedOutcome;
}

/**
 * The quarantine reason screening adds, if any. Every anonymous submission
 * is screened, on every path; a signed-in person, an API key or an agent is
 * not who it exists for.
 */
export function screeningReason(
  token: string | undefined,
  slug: string,
  values: Record<string, unknown>,
  actor: Actor,
): string | null {
  if (!formScreening() || actor.kind !== "anonymous") return null;
  // No seal, a seal that does not open, or no secret to open one with: the
  // submission did not pass through screening, whatever path it took.
  const outcome = openScreening(token, slug, values);
  if (outcome === null) return UNCHECKED_REASON;
  if (outcome === "blocked") return BLOCKED_REASON;
  return null;
}

/**
 * The text a screening provider examines: the longest multi-line answer, the
 * form's message box. A form without one sends nothing, rather than a name
 * or an address in its place.
 */
export function screenedText(fields: FormField[], values: Record<string, unknown>): string {
  let longest = "";
  for (const field of fields) {
    if (field.kind !== "multiline") continue;
    const value = values[field.key];
    if (typeof value === "string" && value.trim().length > longest.length) longest = value.trim();
  }
  return longest;
}

/**
 * The seal a site form hands `forms.submit`, or undefined when neither
 * screening nor a lead sink is configured (nothing then needs one).
 */
export async function sealSiteSubmission(input: {
  slug: string;
  values: Record<string, unknown>;
  request: RequestMetadata | undefined;
}): Promise<string | undefined> {
  const adapter = formScreening();
  if (!adapter && !leadSink()) return undefined;
  if (!adapter) return sealScreening("unscreened", input.slug, input.values);
  return sealScreening(await screenOutcome(adapter, input), input.slug, input.values);
}

async function screenOutcome(
  adapter: NonNullable<ReturnType<typeof formScreening>>,
  input: { slug: string; values: Record<string, unknown>; request: RequestMetadata | undefined },
): Promise<SealedOutcome> {
  // Freeholder's own traps first: what they already flag is quarantined
  // anyway, and needs no outside opinion.
  if (inspect(input.values).suspected) return "unscreened";
  const clientIp = input.request?.trustedIp ?? input.request?.ip;
  // The provider's API requires the address; without one there is nothing
  // to ask, and the traps decide alone.
  if (!clientIp) return "unavailable";
  const [form] = await db()
    .select({ id: forms.id, fields: forms.fields })
    .from(forms)
    .where(and(eq(forms.slug, input.slug), isNull(forms.trashedAt)))
    .limit(1);
  if (!form) return "unscreened";
  // A client past its budget never reaches the provider; `forms.submit`
  // refuses the submission with its own limit.
  const network = createHash("sha256").update(clientNetwork(clientIp)).digest("hex");
  const budget = await consume(`forms.screen:${form.id}:${network}`, SCREENING_BUDGET);
  if (!budget.allowed) return "unscreened";
  return adapter.assess({
    formRef: `freeholder:${input.slug}`,
    clientIp,
    message: screenedText(form.fields as FormField[], input.values),
  });
}
