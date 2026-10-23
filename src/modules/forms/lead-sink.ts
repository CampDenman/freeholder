// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Copying accepted submissions to the configured lead sink (C3.34).
//
// An outbox listener on `forms.submitted`, which only fires for submissions
// that passed quarantine, and which runs after the submission has committed.
// Only submissions sealed by a site form are copied: those are the ones whose
// sender saw the notice naming the provider. Owner entries, API and MCP
// submissions are never copied.
//
// Every failure throws. The outbox retries with backoff and, after its last
// attempt, dead-letters the delivery, which the owner sees under Jobs →
// Outbox and can replay once the cause is fixed. A lead is never dropped
// silently, and the submission itself is already kept here either way.
import { eq } from "drizzle-orm";
import { leadSink, type LeadCopy } from "@/adapters/lead-sink";
import { db } from "@/core/db";
import { env } from "@/core/env";
import { emailFrom, messageFrom, nameFrom, type FormField } from "./fields";
import { forms, formSubmissions } from "./schema";

/** What is copied for one submission: the fields the privacy notice lists. */
export function leadCopy(
  form: { slug: string; fields: FormField[] },
  submission: { id: string; data: Record<string, unknown>; sourceUrl: string | null },
): LeadCopy {
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
  let pageUrl: string | undefined;
  if (submission.sourceUrl) {
    try {
      pageUrl = new URL(submission.sourceUrl, new URL(env().APP_URL).origin).href;
    } catch {
      pageUrl = undefined;
    }
  }
  return {
    submissionId: submission.id,
    formSlug: form.slug,
    name: nameFrom(fields, data, email),
    ...(email ? { email } : {}),
    ...(typeof phone === "string" && phone ? { phone } : {}),
    ...(message ? { message } : {}),
    answers,
    ...(pageUrl ? { pageUrl } : {}),
  };
}

export async function copySubmissionToLeadSink(payload: unknown): Promise<void> {
  const sink = leadSink();
  if (!sink) return;
  const { submissionId, fromSiteForm } = (payload ?? {}) as { submissionId?: string; fromSiteForm?: boolean };
  if (!submissionId || fromSiteForm !== true) return;
  const [row] = await db()
    .select({ submission: formSubmissions, form: forms })
    .from(formSubmissions)
    .innerJoin(forms, eq(forms.id, formSubmissions.formId))
    .where(eq(formSubmissions.id, submissionId))
    .limit(1);
  // Re-checked here: an owner may have marked it spam since it was accepted.
  if (!row || row.submission.status !== "received") return;
  const lead = leadCopy(
    { slug: row.form.slug, fields: row.form.fields as FormField[] },
    {
      id: row.submission.id,
      data: row.submission.data as Record<string, unknown>,
      sourceUrl: row.submission.sourceUrl,
    },
  );
  try {
    await sink.send(lead);
  } catch (error) {
    // The message carries a status and a code, never the visitor's answers.
    throw new Error(
      `${sink.displayName} did not accept the copy of form submission ${submissionId}: ${
        error instanceof Error ? error.message : "refused"
      } The submission is kept in Freeholder; replay this delivery once the cause is fixed.`,
    );
  }
}
