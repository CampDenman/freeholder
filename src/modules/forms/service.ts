// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
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
import { and, count, desc, eq, inArray, sql } from "drizzle-orm";
import { listed, row, timestamp, uuid } from "@/core/contract";
import { defineService, ServiceError } from "@/core/service";
import { isUniqueViolation } from "@/core/db";
import {
  registerContactReference,
  resolveContact,
} from "@/core/contacts/service";
import { db } from "@/core/db";
import { registerContactPrivacySource } from "@/core/privacy/service";
import { forms, formSubmissions } from "./schema";
import {
  emailFrom,
  fieldsSchema,
  nameFrom,
  submissionSchema,
  type FormField,
} from "./fields";
import { HONEYPOT_FIELD, inspect, STAMP_FIELD } from "./antispam";
import type { EventDeliveryContext } from "@/core/events";
import { createNotification } from "@/core/notifications/service";
import {
  demoHandlerInputSchema,
  demoLoadResultSchema,
  demoPurgeResultSchema,
  demoVerifyResultSchema,
} from "@/core/onboarding/contract";
import { requireDemoHandlerRun } from "@/core/demo/handler";

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
  captureForUndo: async (tx, duplicateId, survivingId) => ({
    state: await tx
      .select({ id: formSubmissions.id, contactId: formSubmissions.contactId })
      .from(formSubmissions)
      .where(inArray(formSubmissions.contactId, [duplicateId, survivingId])),
    undoable: true,
  }),
  restoreAfterUndo: async (tx, beforeState, afterState, duplicateId) => {
    const schema = z.array(
      z.object({ id: z.string().uuid(), contactId: z.string().uuid().nullable() }),
    );
    const before = schema.parse(beforeState);
    const after = schema.parse(afterState);
    const current = after.length
      ? await tx
          .select({ id: formSubmissions.id, contactId: formSubmissions.contactId })
          .from(formSubmissions)
          .where(inArray(formSubmissions.id, after.map((row) => row.id)))
      : [];
    const byId = new Map(current.map((row) => [row.id, row.contactId]));
    if (
      current.length !== after.length ||
      after.some((row) => byId.get(row.id) !== row.contactId)
    ) {
      throw new ServiceError(
        "conflict",
        "A form submission changed after this merge. Leave the merge in place or restore that submission first.",
      );
    }
    const moved = before.filter((row) => row.contactId === duplicateId);
    if (moved.length) {
      await tx
        .update(formSubmissions)
        .set({ contactId: duplicateId })
        .where(inArray(formSubmissions.id, moved.map((row) => row.id)));
    }
  },
});

registerContactPrivacySource({
  scope: "forms.submissions",
  tables: ["form_submissions"],
  exportData: (tx, contactId) =>
    tx
      .select()
      .from(formSubmissions)
      .where(eq(formSubmissions.contactId, contactId))
      .orderBy(formSubmissions.createdAt),
  erase: async (tx, contactId) => {
    const rows = await tx
      .update(formSubmissions)
      .set({ data: {}, sourceUrl: null, spamReasons: [] })
      .where(eq(formSubmissions.contactId, contactId))
      .returning({ id: formSubmissions.id });
    return { affected: rows.length };
  },
});

const slug = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Use lower-case words separated by hyphens.");

const formRow = row({
  id: uuid,
  slug: z.string(),
  name: z.string(),
  fields: z.unknown(),
  submitLabel: z.string().nullable(),
  successMessage: z.string().nullable(),
  destination: z.enum(["contact", "none"]),
  notify: listed(z.string()),
  status: z.enum(["active", "closed"]),
  createdAt: timestamp,
  updatedAt: timestamp,
});

const formSubmissionRow = row({
  id: uuid,
  formId: uuid,
  contactId: uuid.nullable(),
  data: z.unknown(),
  sourceUrl: z.string().nullable(),
  status: z.enum(["received", "spam"]),
  spamReasons: listed(z.string()),
  createdAt: timestamp,
});

/* ------------------------------------------------------------------ authoring */

export const listForms = defineService({
  name: "forms.list",
  summary: "Every form, with how many submissions each has taken.",
  kind: "query",
  permission: "scoped",
  input: z.object({}),
  output: listed(
    row({
      id: uuid,
      slug: z.string(),
      name: z.string(),
      status: z.enum(["active", "closed"]),
      destination: z.enum(["contact", "none"]),
      fields: z.unknown(),
      updatedAt: timestamp,
      submissions: z.coerce.number().int(),
    }),
  ),
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
  output: formRow.nullable(),
  handler: async (input, ctx) => {
    const [form] = await ctx.tx
      .select()
      .from(forms)
      .where(eq(forms.slug, input.slug))
      .limit(1);
    return form ?? null;
  },
});

/**
 * One whole form, by id — what the builder loads.
 *
 * `forms.get` cannot do this job: it is keyed by slug, because that is what a
 * rendered page has, and it is public, because that page is. An admin screen
 * arrives with an id and needs the columns a visitor never sees — who gets
 * notified, what the thank-you says — so this is staff-only and returns the
 * row rather than a projection.
 */
export const getFormById = defineService({
  name: "forms.byId",
  summary: "One form, whole, for editing it.",
  kind: "query",
  permission: "scoped",
  input: z.object({ id: z.string().uuid() }),
  output: formRow.nullable(),
  handler: async (input, ctx) => {
    const [form] = await ctx.tx
      .select()
      .from(forms)
      .where(eq(forms.id, input.id))
      .limit(1);
    return form ?? null;
  },
});

export const createForm = defineService({
  name: "forms.create",
  summary: "Add a form.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({
    slug,
    name: z.string().min(1).max(120),
    fields: fieldsSchema.default([]),
    submitLabel: z.string().max(60).optional(),
    successMessage: z.string().max(300).optional(),
    destination: z.enum(["contact", "none"]).default("contact"),
    notify: z.array(z.string().email()).default([]),
  }),
  output: formRow,
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
  permission: "scoped",
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
  output: formRow,
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

export const deleteForm = defineService({
  name: "forms.delete",
  summary: "Permanently remove a form and its submissions.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({ id: z.string().uuid() }),
  output: row({ id: uuid, slug: z.string() }),
  handler: async (input, ctx) => {
    const [form] = await ctx.tx
      .delete(forms)
      .where(eq(forms.id, input.id))
      .returning({ id: forms.id, slug: forms.slug });
    if (!form) throw new ServiceError("not_found", "That form is gone.");
    ctx.setSubject("form", form.id);
    ctx.queueEvent("forms.deleted", { formId: form.id, slug: form.slug });
    return form;
  },
});

const DEMO_FORM = {
  en: {
    name: "[Demo] Project enquiry",
    submitLabel: "Send demo enquiry",
    successMessage: "Demo enquiry received.",
    nameLabel: "Your name",
    emailLabel: "Email",
  },
  fr: {
    name: "[Demo] Demande de projet",
    submitLabel: "Envoyer la demande demo",
    successMessage: "Demande demo recue.",
    nameLabel: "Votre nom",
    emailLabel: "Courriel",
  },
  es: {
    name: "[Demo] Consulta de proyecto",
    submitLabel: "Enviar consulta demo",
    successMessage: "Consulta demo recibida.",
    nameLabel: "Tu nombre",
    emailLabel: "Correo electronico",
  },
} as const;

export const loadDemoForms = defineService({
  name: "forms.loadDemoFixture",
  summary: "Load the forms contribution for a tracked demo run.",
  kind: "mutation",
  permission: "scoped",
  input: demoHandlerInputSchema,
  output: demoLoadResultSchema,
  handler: async (input, ctx) => {
    await requireDemoHandlerRun(
      ctx.tx,
      input,
      { key: "forms.current-modules", version: 1 },
      "load",
    );
    const copy = DEMO_FORM[input.locale as keyof typeof DEMO_FORM];
    if (!copy) throw new ServiceError("validation", "Unsupported demo locale.");
    const form = await ctx.callAsSystem(createForm, {
      slug: "freeholder-demo-enquiry",
      name: copy.name,
      submitLabel: copy.submitLabel,
      successMessage: copy.successMessage,
      destination: "none",
      fields: [
        { key: "name", label: copy.nameLabel, kind: "text", required: true },
        { key: "email", label: copy.emailLabel, kind: "email", required: true },
      ],
    });
    return demoLoadResultSchema.parse({
      records: [
        {
          fixtureKey: "enquiry-form",
          subjectType: "form",
          subjectId: form.id,
          label: form.name,
        },
      ],
    });
  },
});

export const purgeDemoForms = defineService({
  name: "forms.purgeDemoFixture",
  summary: "Purge only forms proven to belong to a tracked demo run.",
  kind: "mutation",
  permission: "scoped",
  input: demoHandlerInputSchema,
  output: demoPurgeResultSchema,
  handler: async (input, ctx) => {
    await requireDemoHandlerRun(
      ctx.tx,
      input,
      { key: "forms.current-modules", version: 1 },
      "purge",
    );
    const purged: Array<{ subjectType: string; subjectId: string }> = [];
    for (const record of input.records) {
      if (record.fixtureKey !== "enquiry-form" || record.subjectType !== "form") {
        throw new ServiceError("validation", "Unexpected forms demo provenance.");
      }
      const [existing] = await ctx.tx
        .select({ id: forms.id })
        .from(forms)
        .where(eq(forms.id, record.subjectId))
        .limit(1);
      if (existing) await ctx.callAsSystem(deleteForm, { id: existing.id });
      purged.push({ subjectType: record.subjectType, subjectId: record.subjectId });
    }
    return demoPurgeResultSchema.parse({ purged });
  },
});

export const verifyDemoForms = defineService({
  name: "forms.verifyDemoFixture",
  summary: "Verify the visible forms outcome for a tracked demo run.",
  kind: "query",
  permission: "scoped",
  input: demoHandlerInputSchema,
  output: demoVerifyResultSchema,
  handler: async (input, ctx) => {
    await requireDemoHandlerRun(
      ctx.tx,
      input,
      { key: "forms.current-modules", version: 1 },
      "verify",
    );
    const ids = input.records
      .filter((record) => record.subjectType === "form")
      .map((record) => record.subjectId);
    const [form] = ids.length
      ? await ctx.tx
          .select({ id: forms.id, slug: forms.slug, name: forms.name })
          .from(forms)
          .where(eq(forms.id, ids[0]!))
          .limit(1)
      : [];
    return demoVerifyResultSchema.parse({
      outcomes: [
        {
          key: "forms.current-modules.visible",
          achieved:
            form?.slug === "freeholder-demo-enquiry" &&
            form.name.startsWith("[Demo]"),
          detail: form?.name,
        },
      ],
    });
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
  output: z.object({
    ok: z.literal(true),
    submissionId: uuid,
    message: z.string(),
  }),
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
  permission: "scoped",
  input: z.object({
    formId: z.string().uuid(),
    status: z.enum(["received", "spam", "all"]).default("received"),
    limit: z.number().int().min(1).max(200).default(50),
  }),
  output: listed(formSubmissionRow),
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
  permission: "scoped",
  input: z.object({
    id: z.string().uuid(),
    status: z.enum(["received", "spam"]),
  }),
  output: formSubmissionRow,
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
  permission: "scoped",
  input: z.object({}),
  output: z.object({
    received: z.coerce.number().int(),
    spam: z.coerce.number().int(),
  }),
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
export async function onFormSubmitted(
  payload: unknown,
  _eventName?: string,
  context?: EventDeliveryContext,
): Promise<void> {
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
  const messageParams = {
    form: row.form.name,
    answers: answers.join("\n").slice(0, 3400),
    ...(row.submission.sourceUrl ? { source: row.submission.sourceUrl } : {}),
  };
  for (const to of recipients) {
    await createNotification.call({
      recipient: { kind: "email", address: to },
      topic: "forms.submission",
      priority: "information",
      titleKey: "notifications.form.title",
      bodyKey: row.submission.sourceUrl
        ? "notifications.form.bodyWithSource"
        : "notifications.form.body",
      messageParams,
      href: `/admin/forms/${row.form.id}`,
      replyTo: from,
      sourceEventId: context?.eventId,
      sourceEventName: "forms.submitted",
      idempotencyKey: `form:${submissionId}:notify:${to.toLowerCase()}`,
      dedupeKey: `form-submission:${submissionId}:${to.toLowerCase()}`,
    }, { kind: "system" });
  }
}

export { HONEYPOT_FIELD, STAMP_FIELD };

export default [
  listForms,
  getForm,
  getFormById,
  createForm,
  updateForm,
  deleteForm,
  loadDemoForms,
  purgeDemoForms,
  verifyDemoForms,
  submitForm,
  listSubmissions,
  reviewSubmission,
  submissionCounts,
];
