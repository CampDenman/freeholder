// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// PM Shield screening and lead capture for public forms (C3.32).
//
// Both are optional and both sit *beside* §36's own traps, never instead of
// them: the honeypot and signed time-trap run on every submission whatever
// Paradise Modern says, and nothing here can reject one outright. A shield
// verdict only adds a reason to quarantine, which is the same flag-don't-drop
// rule the traps follow, because a real enquiry silently discarded costs an
// owner a customer.
//
// Screening has to happen before the submission's transaction opens (provider
// I/O never runs inside one), so the public form action asks PM first and
// hands `forms.submit` a sealed verdict. The seal is an HMAC bound to the
// form and to these exact answers, which is what makes the verdict
// unforgeable on the public API: a caller that skips the form cannot invent
// "allowed", and cannot reuse a verdict issued for somebody else's words.
//
// Fail-safe in both directions. PM unreachable, slow, or not enabled for the
// site seals "unavailable", and the submission proceeds on Freeholder's own
// traps. Lead forwarding runs after commit through the outbox, so a PM outage
// delays the copy in PM's CRM and never loses the submission here.
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { paradiseRequest, ParadiseRequestError } from "@/adapters/paradise/http";
import { db } from "@/core/db";
import { env } from "@/core/env";
import type { Actor, RequestMetadata } from "@/core/service";
import { emailFrom, messageFrom, nameFrom, type FormField } from "./fields";
import { forms, formSubmissions } from "./schema";

const SEAL_VERSION = "v1";
/** Long enough for a slow submit, short enough that a seal is not a credential. */
const SEAL_TTL_MS = 15 * 60 * 1000;
const SHIELD_TIMEOUT_MS = 4_000;

type ScreeningState = "allow" | "blocked" | "unavailable";

export function shieldEnabled(): boolean {
  const current = env();
  return current.PARADISEMODERN_SHIELD === "on" && Boolean(current.PARADISEMODERN_API_KEY);
}

export function leadForwardingEnabled(): boolean {
  const current = env();
  return current.PARADISEMODERN_LEADS === "on" && Boolean(current.PARADISEMODERN_API_KEY);
}

function secret(): string {
  return env().SESSION_SECRET ?? "development-only-form-stamp-secret";
}

/** Canonical digest of the answers, so a seal cannot travel to other words. */
function answersDigest(values: Record<string, unknown>): string {
  const canonical = JSON.stringify(
    Object.keys(values)
      .sort()
      .map((key) => [key, values[key]]),
  );
  return createHash("sha256").update(canonical).digest("base64url");
}

function signature(parts: string[]): string {
  return createHmac("sha256", secret())
    .update(["forms-screening", ...parts].join("|"))
    .digest("base64url");
}

export function sealScreening(
  state: ScreeningState,
  slug: string,
  values: Record<string, unknown>,
  now = new Date(),
): string {
  const issued = String(now.getTime());
  const sig = signature([SEAL_VERSION, state, issued, slug, answersDigest(values)]);
  return `${SEAL_VERSION}.${state}.${issued}.${sig}`;
}

/** The sealed state, or null when the seal is absent, stale or not ours. */
export function openScreening(
  token: string | undefined,
  slug: string,
  values: Record<string, unknown>,
  now = new Date(),
): ScreeningState | null {
  if (!token) return null;
  const [version, state, issued, sig] = token.split(".");
  if (version !== SEAL_VERSION || !sig || !issued) return null;
  if (state !== "allow" && state !== "blocked" && state !== "unavailable") return null;
  const age = now.getTime() - Number(issued);
  if (!Number.isFinite(age) || age < -60_000 || age > SEAL_TTL_MS) return null;
  const expected = Buffer.from(signature([version, state, issued, slug, answersDigest(values)]));
  const provided = Buffer.from(sig);
  if (expected.length !== provided.length || !timingSafeEqual(expected, provided)) return null;
  return state;
}

/**
 * The quarantine reason screening adds, if any.
 *
 * Only anonymous traffic is screened: PM Shield exists for it, and a member
 * booking through the portal or a scoped API key is not that.
 */
export function screeningReason(
  token: string | undefined,
  slug: string,
  values: Record<string, unknown>,
  actor: Actor,
): string | null {
  if (!shieldEnabled() || actor.kind !== "anonymous") return null;
  const state = openScreening(token, slug, values);
  if (state === null) return "was not checked by the site's spam screening";
  if (state === "blocked") return "was flagged by the site's spam screening";
  return null;
}

/**
 * Ask PM Shield about one public submission, before it is recorded.
 *
 * Only the fields PM's server assessment accepts are sent — a name and the
 * prose — never the email, phone or other answers.
 */
export async function screenPublicSubmission(input: {
  slug: string;
  values: Record<string, unknown>;
  request: RequestMetadata;
}): Promise<string | undefined> {
  if (!shieldEnabled()) return undefined;
  const [form] = await db()
    .select({ fields: forms.fields })
    .from(forms)
    .where(and(eq(forms.slug, input.slug), isNull(forms.trashedAt)))
    .limit(1);
  if (!form) return undefined;
  return assessWithShield({ ...input, fields: form.fields as FormField[] });
}

/** The PM half of {@link screenPublicSubmission}, given the form's fields. */
export async function assessWithShield(input: {
  slug: string;
  values: Record<string, unknown>;
  fields: FormField[];
  request: RequestMetadata;
}): Promise<string> {
  const clientIp = input.request.trustedIp ?? input.request.ip;
  if (!clientIp) return sealScreening("unavailable", input.slug, input.values);

  const fields = input.fields;
  const email = emailFrom(fields, input.values);
  const name = nameFrom(fields, input.values, email);
  const message = messageFrom(fields, input.values);
  try {
    const { body } = await paradiseRequest<{ allow?: unknown }>("/api/shield/assess", {
      timeoutMs: SHIELD_TIMEOUT_MS,
      body: {
        form_id: `freeholder:${input.slug}`.slice(0, 120),
        client_ip: clientIp,
        user_agent: input.request.userAgent ?? "",
        submission: {
          ...(name && name !== "Form submission" ? { name: name.slice(0, 240) } : {}),
          ...(message ? { message: message.slice(0, 4000) } : {}),
        },
      },
    });
    if (body.allow === true) return sealScreening("allow", input.slug, input.values);
    if (body.allow === false) return sealScreening("blocked", input.slug, input.values);
    return sealScreening("unavailable", input.slug, input.values);
  } catch {
    // Unreachable, slow, `shield_not_enabled`, a key problem: none of these
    // is evidence about the visitor. Freeholder's own traps decide.
    return sealScreening("unavailable", input.slug, input.values);
  }
}

/**
 * Who an accepted submission identifies, for a consented conversion event.
 * Null when it was quarantined: suspected spam is never anybody's lead.
 */
export async function acceptedSubmissionIdentity(
  submissionId: string,
): Promise<{ email?: string; phone?: string } | null> {
  const [row] = await db()
    .select({ submission: formSubmissions, form: forms })
    .from(formSubmissions)
    .innerJoin(forms, eq(forms.id, formSubmissions.formId))
    .where(eq(formSubmissions.id, submissionId))
    .limit(1);
  if (!row || row.submission.status !== "received") return null;
  const fields = row.form.fields as FormField[];
  const data = row.submission.data as Record<string, unknown>;
  const phoneField = fields.find((field) => field.kind === "tel");
  const phone = phoneField ? data[phoneField.key] : undefined;
  return {
    email: emailFrom(fields, data),
    ...(typeof phone === "string" && phone ? { phone } : {}),
  };
}

/** The `/api/collect/lead` body for one accepted submission. */
export function leadBody(
  form: { slug: string; fields: FormField[] },
  submission: { id: string; data: Record<string, unknown>; sourceUrl: string | null },
): Record<string, unknown> {
  const { fields } = form;
  const data = submission.data;
  const email = emailFrom(fields, data);
  const phoneField = fields.find((field) => field.kind === "tel");
  const phone = phoneField ? data[phoneField.key] : undefined;
  const message = messageFrom(fields, data);
  const answers = Object.fromEntries(
    fields
      .filter((field) => data[field.key] !== undefined && data[field.key] !== "")
      .map((field) => [field.label, data[field.key]]),
  );
  const origin = new URL(env().APP_URL).origin;
  return {
    name: nameFrom(fields, data, email).slice(0, 500),
    ...(email ? { email } : {}),
    ...(typeof phone === "string" && phone ? { phone } : {}),
    ...(message ? { message: message.slice(0, 5000) } : {}),
    source: `form:${form.slug}`.slice(0, 200),
    // Freeholder's id, so PM's copy points back at the original.
    externalId: submission.id,
    fields: answers,
    ...(submission.sourceUrl
      ? { referer: new URL(submission.sourceUrl, origin).href.slice(0, 2000) }
      : {}),
  };
}

/**
 * Copy an accepted submission into PM's CRM as a lead.
 *
 * An outbox listener on `forms.submitted`, which only fires for submissions
 * that passed quarantine. Retryable failures throw so the outbox retries with
 * backoff; a permanent refusal (PM's own screening, a bad key) is logged and
 * not retried forever — the submission itself is already safe here.
 */
export async function forwardLead(payload: unknown): Promise<void> {
  if (!leadForwardingEnabled()) return;
  const { submissionId } = (payload ?? {}) as { submissionId?: string };
  if (!submissionId) return;
  const [row] = await db()
    .select({ submission: formSubmissions, form: forms })
    .from(formSubmissions)
    .innerJoin(forms, eq(forms.id, formSubmissions.formId))
    .where(eq(formSubmissions.id, submissionId))
    .limit(1);
  if (!row || row.submission.status !== "received") return;
  try {
    await paradiseRequest("/api/collect/lead", {
      body: leadBody(
        { slug: row.form.slug, fields: row.form.fields as FormField[] },
        {
          id: row.submission.id,
          data: row.submission.data as Record<string, unknown>,
          sourceUrl: row.submission.sourceUrl,
        },
      ),
    });
  } catch (error) {
    if (error instanceof ParadiseRequestError && error.retryable) throw error;
    console.warn(
      `[forms] Paradise Modern did not accept lead ${submissionId} (HTTP ${
        error instanceof ParadiseRequestError ? error.status : "?"
      }); the submission is kept here.`,
    );
  }
}
