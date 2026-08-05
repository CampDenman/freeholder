// Copyright (C) 2026 Camp Denman Society
// SPDX-License-Identifier: AGPL-3.0-only
// Forms services (MASTER.md §4.6, §36, and CLAUDE.md's spine non-negotiable).
//
// This is the first module whose *public* surface writes. Everything the
// platform claims about the spine gets tested here for real: an anonymous
// visitor's submission has to become a Contact without the visitor having any
// permission to create one, and without forms inventing a private notion of
// "customer".
//
// The path is exactly the one the non-negotiable names — `contacts.resolve`,
// never `contacts.create`, reached through `ctx.callAsSystem` so the elevation
// is one greppable call rather than a service that quietly trusts its caller.
import { z } from "zod";
import { and, count, desc, eq, sql } from "drizzle-orm";
import { defineService, ServiceError } from "@/core/service";
import { isUniqueViolation } from "@/core/db";
import {
  registerContactReference,
  resolveContact,
} from "@/core/contacts/service";
import { db } from "@/core/db";
import { forms, formSubmissions } from "./schema";
import {
  emailFrom,
  fieldsSchema,
  nameFrom,
  submissionSchema,
  type FormField,
} from "./fields";
import { HONEYPOT_FIELD, inspect, STAMP_FIELD } from "./antispam";

// CLAUDE.md's non-negotiable, honoured by the module that creates the
// obligation: a submission points at a contact, so merging two duplicates has
// to bring the submissions with it. Registered at module load, which boot does
// exactly when this module is installed.
//
// Repointing is unconditional because nothing here is unique per contact — one
// person may submit the same form fifty times, and after a merge all fifty
// belong to the survivor.
registerContactReference({
  table: "form_submissions",
  repoint: (tx, duplicateId, survivingId) =>
    tx
      .update(formSubmissions)
      .set({ contactId: survivingId })
      .where(eq(formSubmissions.contactId, duplicateId)),
});

const slug = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Use lower-case words separated by hyphens.");

/* ------------------------------------------------------------------ authoring */

export const listForms = defineService({
  name: "forms.list",
  summary: "Every form, with how many submissions each has taken.",
  kind: "query",
  permission: "staff",
  input: z.object({}),
  handler: async (_input, ctx) => {
    const rows = await ctx.tx
      .select({
        id: forms.id,
        slug: forms.slug,
        name: forms.name,
        status: forms.status,
        destination: forms.destination,
        fields: forms.fields,
        updatedAt: forms.updatedAt,
        submissions: count(formSubmissions.id),
      })
      .from(forms)
      .leftJoin(formSubmissions, eq(formSubmissions.formId, forms.id))
      .groupBy(forms.id)
      .orderBy(desc(forms.updatedAt));
    return rows;
  },
});

/** The definition a public page renders from. Public, and deliberately thin. */
export const getForm = defineService({
  name: "forms.get",
  summary: "One form's definition, for rendering it.",
  kind: "query",
  permission: "public",
  input: z.object({ slug }),
  handler: async (input, ctx) => {
    const [form] = await ctx.tx
      .select()
      .from(forms)
      .where(eq(forms.slug, input.slug))
      .limit(1);
    return form ?? null;
  },
});

export const createForm = defineService({
  name: "forms.create",
  summary: "Add a form.",
  kind: "mutation",
  permission: "staff",
  input: z.object({
    slug,
    name: z.string().min(1).max(120),
    fields: fieldsSchema.default([]),
    submitLabel: z.string().max(60).optional(),
    successMessage: z.string().max(300).optional(),
    destination: z.enum(["contact", "none"]).default("contact"),
    notify: z.array(z.string().email()).default([]),
  }),
  handler: async (input, ctx) => {
    const [form] = await ctx.tx
      .insert(forms)
      .values(input)
      .returning()
      .catch((error: unknown) => {
        if (isUniqueViolation(error)) {
          throw new ServiceError(
            "conflict",
            `There is already a form at "${input.slug}".`,
          );
        }
        throw error;
      });
    ctx.setSubject("form", form!.id);
    ctx.queueEvent("forms.created", { formId: form!.id, slug: form!.slug });
    return form!;
  },
});

export const updateForm = defineService({
  name: "forms.update",
  summary: "Change a form's questions or settings.",
  kind: "mutation",
  permission: "staff",
  input: z.object({
    id: z.string().uuid(),
    name: z.string().min(1).max(120).optional(),
    fields: fieldsSchema.optional(),
    submitLabel: z.string().max(60).nullish(),
    successMessage: z.string().max(300).nullish(),
    destination: z.enum(["contact", "none"]).optional(),
    notify: z.array(z.string().email()).optional(),
    status: z.enum(["active", "closed"]).optional(),
  }),
  handler: async (input, ctx) => {
    const { id, ...changes } = input;
    if (Object.keys(changes).length === 0) {
      throw new ServiceError("validation", "Nothing to change.");
    }
    const [form] = await ctx.tx
      .update(forms)
      .set(changes)
      .where(eq(forms.id, id))
      .returning();
    if (!form) throw new ServiceError("not_found", "That form is gone.");
    ctx.setSubject("form", form.id);
    ctx.queueEvent("forms.updated", { formId: form.id, slug: form.slug });
    return form;
  },
});

/* ---------------------------------------------------------------- submitting */

export const submitForm = defineService({
  name: "forms.submit",
  summary: "Record what somebody filled in, and put them on the spine.",
  kind: "mutation",
  permission: "public",
  input: z.object({
    slug,
    /** Raw values as posted. Validated against the form's own fields below. */
    values: z.record(z.string(), z.unknown()),
    sourceUrl: z.string().max(2000).optional(),
  }),
  // A public write needs a ceiling that does not depend on anyone being
  // logged in. Per form rather than per visitor: an anonymous surface has no
  // trustworthy identity to key on, and threading a client address through a
  // Server Action is not something Next offers honestly (see the backlog).
  rateLimit: {
    limit: 30,
    windowSeconds: 10 * 60,
    subject: (input) => `form:${input.slug}`,
    message: "This form has taken a lot of submissions just now. Try again shortly.",
  },
  handler: async (input, ctx) => {
    const [form] = await ctx.tx
      .select()
      .from(forms)
      .where(eq(forms.slug, input.slug))
      .limit(1);
    if (!form) throw new ServiceError("not_found", "That form no longer exists.");
    if (form.status === "closed") {
      throw new ServiceError(
        "validation",
        "This form is no longer accepting responses.",
      );
    }

    const fields = form.fields as FormField[];

    // The traps are read *before* validation, so a bot that also fails the
    // field rules is still recorded as spam rather than as a validation error
    // an owner never sees.
    const verdict = inspect(input.values);

    const parsed = submissionSchema(fields).safeParse(input.values);
    if (!parsed.success) {
      // A real person seeing a real message about their own answer. Only the
      // first issue: a wall of red is how forms get abandoned.
      const first = parsed.error.issues[0];
      throw new ServiceError(
        "validation",
        first?.message ?? "Some answers need another look.",
      );
    }
    const data = parsed.data as Record<string, unknown>;

    // §4.1's identity rule, on an anonymous path. `resolve` rather than
    // `create` because a returning visitor is the same person, and
    // `callAsSystem` because they are allowed to identify themselves and
    // nothing more.
    let contactId: string | null = null;
    const email = emailFrom(fields, data);
    if (form.destination === "contact" && email && !verdict.suspected) {
      // `resolve` answers with whether it created or enriched, which is worth
      // more than the row: it is how the timeline can say "new enquiry" rather
      // than "someone filled in a form again".
      const resolved = await ctx.callAsSystem(resolveContact, {
        email,
        name: nameFrom(fields, data, email),
        source: `form:${form.slug}`,
      });
      contactId = resolved.contact.id;
    }

    const [submission] = await ctx.tx
      .insert(formSubmissions)
      .values({
        formId: form.id,
        contactId,
        data,
        sourceUrl: input.sourceUrl,
        status: verdict.suspected ? "spam" : "received",
        spamReasons: verdict.reasons,
      })
      .returning();

    ctx.setSubject("form_submission", submission!.id);

    // Suspected spam gets no timeline entry and no event: an owner's CRM
    // should not fill with noise, and an automation should not fire on it.
    // The row exists, flagged, for review.
    if (!verdict.suspected) {
      if (contactId) {
        await ctx.emitTimeline({
          contactId,
          eventType: "form.submitted",
          subjectType: "form_submission",
          subjectId: submission!.id,
          payload: { form: form.slug, name: form.name },
        });
      }
      ctx.queueEvent("forms.submitted", {
        formId: form.id,
        submissionId: submission!.id,
        contactId,
      });
    }

    return {
      ok: true,
      submissionId: submission!.id,
      message: form.successMessage ?? "Thank you — your message has been sent.",
    };
  },
});

/* --------------------------------------------------------------- reviewing */

export const listSubmissions = defineService({
  name: "forms.listSubmissions",
  summary: "Submissions for one form, newest first.",
  kind: "query",
  permission: "staff",
  input: z.object({
    formId: z.string().uuid(),
    status: z.enum(["received", "spam", "all"]).default("received"),
    limit: z.number().int().min(1).max(200).default(50),
  }),
  handler: (input, ctx) =>
    ctx.tx
      .select()
      .from(formSubmissions)
      .where(
        input.status === "all"
          ? eq(formSubmissions.formId, input.formId)
          : and(
              eq(formSubmissions.formId, input.formId),
              eq(formSubmissions.status, input.status),
            ),
      )
      .orderBy(desc(formSubmissions.createdAt))
      .limit(input.limit),
});

/**
 * Move a submission between the queue and the inbox.
 *
 * The half of §36's quarantine that makes it a queue rather than a bin: an
 * owner who finds a real enquiry in there can rescue it, and rescuing it puts
 * the person on the spine exactly as an unflagged submission would have.
 */
export const reviewSubmission = defineService({
  name: "forms.reviewSubmission",
  summary: "Mark a submission as spam, or rescue one that is not.",
  kind: "mutation",
  permission: "staff",
  input: z.object({
    id: z.string().uuid(),
    status: z.enum(["received", "spam"]),
  }),
  handler: async (input, ctx) => {
    const [before] = await ctx.tx
      .select()
      .from(formSubmissions)
      .where(eq(formSubmissions.id, input.id))
      .limit(1);
    if (!before) throw new ServiceError("not_found", "That submission is gone.");

    const [form] = await ctx.tx
      .select()
      .from(forms)
      .where(eq(forms.id, before.formId))
      .limit(1);

    let contactId = before.contactId;
    const rescuing = before.status === "spam" && input.status === "received";
    if (rescuing && !contactId && form?.destination === "contact") {
      const fields = form.fields as FormField[];
      const data = before.data as Record<string, unknown>;
      const email = emailFrom(fields, data);
      if (email) {
        const resolved = await ctx.callAsSystem(resolveContact, {
          email,
          name: nameFrom(fields, data, email),
          source: `form:${form.slug}`,
        });
        contactId = resolved.contact.id;
        await ctx.emitTimeline({
          contactId: resolved.contact.id,
          eventType: "form.submitted",
          subjectType: "form_submission",
          subjectId: before.id,
          payload: { form: form.slug, name: form.name, rescued: true },
        });
      }
    }

    const [row] = await ctx.tx
      .update(formSubmissions)
      .set({ status: input.status, contactId })
      .where(eq(formSubmissions.id, input.id))
      .returning();

    ctx.setSubject("form_submission", input.id);
    return row!;
  },
});

/** How much is waiting in the quarantine queue, for the admin's attention. */
export const submissionCounts = defineService({
  name: "forms.submissionCounts",
  summary: "How many submissions are waiting, and how many are flagged.",
  kind: "query",
  permission: "staff",
  input: z.object({}),
  handler: async (_input, ctx) => {
    const [row] = await ctx.tx
      .select({
        received: sql<number>`count(*) filter (where ${formSubmissions.status} = 'received')::int`,
        spam: sql<number>`count(*) filter (where ${formSubmissions.status} = 'spam')::int`,
      })
      .from(formSubmissions);
    return row ?? { received: 0, spam: 0 };
  },
});

/**
 * Tell the owner somebody wrote to them.
 *
 * On the bus rather than inline in `submitForm`, for two reasons. A visitor
 * must never wait for an SMTP handshake to see "thank you". And a mail server
 * having a bad afternoon must not roll back a submission that is already
 * safely stored — the outbox will retry the *notification* without asking the
 * person to fill the form in again.
 *
 * Suspected spam is never notified. A quarantine that emails the owner about
 * every caught message is a quarantine that trains them to ignore it.
 */
export async function onFormSubmitted(payload: unknown): Promise<void> {
  const { submissionId } = (payload ?? {}) as { submissionId?: string };
  if (!submissionId) return;

  const [row] = await db()
    .select({ submission: formSubmissions, form: forms })
    .from(formSubmissions)
    .innerJoin(forms, eq(forms.id, formSubmissions.formId))
    .where(eq(formSubmissions.id, submissionId))
    .limit(1);
  if (!row || row.submission.status !== "received") return;

  const recipients = row.form.notify;
  if (recipients.length === 0) return;

  const fields = row.form.fields as FormField[];
  const data = row.submission.data as Record<string, unknown>;
  const answers = fields
    .map((field) => {
      const value = data[field.key];
      if (value === undefined || value === "") return null;
      return `${field.label}: ${typeof value === "string" ? value : JSON.stringify(value)}`;
    })
    .filter((line): line is string => line !== null);

  const from = emailFrom(fields, data);
  const { mail } = await import("@/adapters/mail");
  for (const to of recipients) {
    await mail().send({
      to,
      subject: `${row.form.name}: a new submission`,
      // The reply goes to the person who wrote, not to the platform — an
      // owner reading this on a phone should be able to press reply.
      replyTo: from,
      text: [
        `Somebody filled in "${row.form.name}".`,
        "",
        ...answers,
        "",
        row.submission.sourceUrl ? `Sent from ${row.submission.sourceUrl}` : "",
      ]
        .filter(Boolean)
        .join("\n"),
    });
  }
}

export { HONEYPOT_FIELD, STAMP_FIELD };

export default [
  listForms,
  getForm,
  createForm,
  updateForm,
  submitForm,
  listSubmissions,
  reviewSubmission,
  submissionCounts,
];
