// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Who an accepted submission identifies, for a consented lead conversion
// (C3.32). Read after the submission's transaction has committed, from the
// public form action's after-response hook — never inside a transaction.
import { eq } from "drizzle-orm";
import { db } from "@/core/db";
import { emailFrom, type FormField } from "./fields";
import { forms, formSubmissions } from "./schema";

/**
 * The contact details an accepted submission carries, or null when it was
 * quarantined: suspected spam is never anybody's lead.
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
  const email = emailFrom(fields, data);
  return {
    ...(email ? { email } : {}),
    ...(typeof phone === "string" && phone ? { phone } : {}),
  };
}
