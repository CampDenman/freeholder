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
import { createHash } from "node:crypto";
import { clientNetwork, consumeAccepted } from "@/core/security/rate-limit";
import { and, count, desc, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import { listed, row, timestamp, uuid } from "@/core/contract";
import {
  actorString,
  defineService,
  getService,
  listServices,
  ServiceError,
  type ServiceContext,
} from "@/core/service";
import { env } from "@/core/env";
import { PLAYGROUND_SUBMISSION_BYTES } from "@/core/demo/playground-policy";
import { isUniqueViolation } from "@/core/db";
import {
  registerContactReference,
  resolveContact,
} from "@/core/contacts/service";
import { db } from "@/core/db";
import { registerContactPrivacySource } from "@/core/privacy/service";
import { withoutHoldCascade } from "@/core/retention/holds";
import { makeTrashServices } from "@/core/trash";
import { forms, formSubmissionFiles, formSubmissions } from "./schema";
import { assets } from "@/core/media/schema";
import { contacts } from "@/core/contacts/schema";
import {
  acceptedKinds,
  emailFrom,
  fieldsSchema,
  fileFieldMaxBytes,
  isFileAnswer,
  messageFrom,
  nameFrom,
  submissionSchema,
  type FileAnswer,
  type FormField,
} from "./fields";
import { HONEYPOT_FIELD, inspect, STAMP_FIELD } from "./antispam";
import { openScreening, screeningReason } from "./screening";
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
  tables: ["form_submissions", "form_submission_files"],
  // C3.38: a file somebody uploaded with a form is theirs as much as what they
  // typed, so the export lists it beside the answers and erasure removes it.
  exportData: async (tx, contactId) => ({
    submissions: await tx
      .select()
      .from(formSubmissions)
      .where(eq(formSubmissions.contactId, contactId))
      .orderBy(formSubmissions.createdAt),
    files: await tx
      .select({
        submissionId: formSubmissionFiles.submissionId,
        fieldKey: formSubmissionFiles.fieldKey,
        assetId: formSubmissionFiles.assetId,
        filename: assets.filename,
        mime: assets.mime,
        bytes: assets.bytes,
        checksumSha256: assets.checksumSha256,
        uploadedAt: assets.createdAt,
      })
      .from(formSubmissionFiles)
      .innerJoin(formSubmissions, eq(formSubmissions.id, formSubmissionFiles.submissionId))
      .innerJoin(assets, eq(assets.id, formSubmissionFiles.assetId))
      .where(eq(formSubmissions.contactId, contactId))
      .orderBy(formSubmissionFiles.createdAt),
  }),
  erase: async (tx, contactId) => {
    // The files first, while the submission still says whose they are. The
    // asset is trashed with an immediate purge date, so the media purge
    // removes the bytes from storage on its next pass; the link goes now.
    const files = await tx
      .select({ id: formSubmissionFiles.id, assetId: formSubmissionFiles.assetId })
      .from(formSubmissionFiles)
      .innerJoin(formSubmissions, eq(formSubmissions.id, formSubmissionFiles.submissionId))
      .where(eq(formSubmissions.contactId, contactId));
    if (files.length) {
      const now = new Date();
      await tx
        .update(assets)
        .set({ status: "trashed", deletedAt: now, purgeAfter: now, updatedAt: now })
        .where(inArray(assets.id, files.map((file) => file.assetId)));
      await tx
        .delete(formSubmissionFiles)
        .where(inArray(formSubmissionFiles.id, files.map((file) => file.id)));
    }
    const rows = await tx
      .update(formSubmissions)
      .set({ data: {}, sourceUrl: null, spamReasons: [] })
      .where(eq(formSubmissions.contactId, contactId))
      .returning({ id: formSubmissions.id });
    return { affected: rows.length + files.length };
  },
});

const slug = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Use lower-case words separated by hyphens.");

/**
 * What an intake form opens (C3.37). `projectTitle` may name answers in
 * braces — `{name}`, `{company}`, any field key — and `{form}` for the form's
 * own name; an unknown name is left as written.
 */
export const intakeSchema = z
  .object({ projectTitle: z.string().trim().min(1).max(200) })
  .strict();

/** The service intake hands each accepted submission to. Owned by projects. */
const INTAKE_SERVICE = "projects.openFromIntake";

/**
 * An intake needs somewhere to open the project and somebody to open it for.
 * Checked on every write, so a form cannot be left marked as an intake that
 * would silently open nothing.
 */
function requireIntakeReady(form: { intake: unknown; destination: string }): void {
  if (!form.intake) return;
  if (!listServices().has(INTAKE_SERVICE)) {
    throw new ServiceError("validation", "An intake form needs the projects module, which is not installed.");
  }
  if (form.destination !== "contact") {
    throw new ServiceError(
      "validation",
      "An intake form opens a project for the person who sent it, so it has to put them on your contact list.",
    );
  }
}

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
  intake: intakeSchema.nullable(),
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

/**
 * Reversible removal (C11.14). Trashing a form trashes *the definition
 * only*: submissions stay live, because they are evidence of what somebody
 * told the business. Purging is the existing hard delete — the form row and,
 * by its long-standing cascade, its submissions — now gated behind trash,
 * typed confirmation and the hold below: a form whose submissions include a
 * person under an active retention exception cannot be purged, because the
 * cascade would reach their held data.
 */
const trash = makeTrashServices({
  family: "forms",
  table: forms,
  rowSchema: formRow,
  subjectKind: "form",
  gone: "That form is gone.",
  holdGuard: withoutHoldCascade(
    formSubmissions,
    formSubmissions.formId,
    sql`${forms.id}`,
    formSubmissions.contactId,
    "forms.submissions",
  ),
});
export const { remove: removeForm, restore: restoreForm, purge: purgeForm, purgeExpired: purgeExpiredForms } = trash;

/* ------------------------------------------------------------------ authoring */

export const listForms = defineService({
  name: "forms.list",
  summary: "Every form, with how many submissions each has taken.",
  kind: "query",
  permission: "scoped",
  input: z.object({
    /** The recovery view: trashed definitions only (C11.14). */
    trashedOnly: z.boolean().default(false),
  }),
  output: listed(
    row({
      id: uuid,
      slug: z.string(),
      name: z.string(),
      status: z.enum(["active", "closed"]),
      destination: z.enum(["contact", "none"]),
      fields: z.unknown(),
      intake: intakeSchema.nullable(),
      updatedAt: timestamp,
      submissions: z.coerce.number().int(),
    }),
  ),
  handler: async (input, ctx) => {
    const rows = await ctx.tx
      .select({
        id: forms.id,
        slug: forms.slug,
        name: forms.name,
        status: forms.status,
        destination: forms.destination,
        fields: forms.fields,
        intake: forms.intake,
        updatedAt: forms.updatedAt,
        submissions: count(formSubmissions.id),
      })
      .from(forms)
      .leftJoin(formSubmissions, eq(formSubmissions.formId, forms.id))
      .where(input.trashedOnly ? isNotNull(forms.trashedAt) : isNull(forms.trashedAt))
      .groupBy(forms.id)
      .orderBy(desc(forms.updatedAt));
    return rows;
  },
});

/**
 * The definition a public page renders from. Public, and thin by construction.
 *
 * It said "deliberately thin" while selecting the whole row, so it answered any
 * anonymous caller with `notify` — the addresses submissions are e-mailed to.
 * An owner who keeps their address off their site had it published by the API
 * anyway, and `contact` is the obvious slug to guess. Reported by a third party
 * building on Freeholder.
 *
 * So the projection is named, in both the schema and the query, rather than
 * being whatever the table happens to hold. `select()` plus a shared row schema
 * is what turned one added column into a disclosure, and a named projection is
 * what stops the next added column from doing it again.
 */
const publicFormRow = row({
  id: uuid,
  slug: z.string(),
  name: z.string(),
  fields: z.unknown(),
  submitLabel: z.string().nullable(),
  successMessage: z.string().nullable(),
  // Kept because a visitor may see it and it tells them nothing they could not
  // infer from the form itself; `notify` is the column that had to go.
  destination: z.enum(["contact", "none"]),
  status: z.enum(["active", "closed"]),
  createdAt: timestamp,
  updatedAt: timestamp,
});

export const getForm = defineService({
  name: "forms.get",
  summary: "One form's definition, for rendering it.",
  kind: "query",
  permission: "public",
  input: z.object({ slug }),
  output: publicFormRow.nullable(),
  handler: async (input, ctx) => {
    const [form] = await ctx.tx
      .select({
        id: forms.id,
        slug: forms.slug,
        name: forms.name,
        fields: forms.fields,
        submitLabel: forms.submitLabel,
        successMessage: forms.successMessage,
        destination: forms.destination,
        status: forms.status,
        createdAt: forms.createdAt,
        updatedAt: forms.updatedAt,
      })
      .from(forms)
      .where(and(eq(forms.slug, input.slug), isNull(forms.trashedAt)))
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
      .where(and(eq(forms.id, input.id), isNull(forms.trashedAt)))
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
    /** Mark it as an intake (C3.37): each accepted submission opens a project. */
    intake: intakeSchema.nullish(),
  }),
  output: formRow,
  handler: async (input, ctx) => {
    requireIntakeReady({ intake: input.intake ?? null, destination: input.destination });
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
    /** An intake's project title, or null to make it an ordinary form again. */
    intake: intakeSchema.nullish(),
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
      .where(and(eq(forms.id, id), isNull(forms.trashedAt)))
      .returning();
    if (!form) throw new ServiceError("not_found", "That form is gone.");
    // After the write, so the check sees the form as it now stands; a refusal
    // rolls the whole change back.
    requireIntakeReady(form);
    ctx.setSubject("form", form.id);
    ctx.queueEvent("forms.updated", { formId: form.id, slug: form.slug });
    return form;
  },
});

export const deleteForm = defineService({
  name: "forms.delete",
  summary: "Move a form to recoverable trash. Permanent removal uses forms.purge with its confirmation and retention guards.",
  kind: "mutation",
  permission: "scoped",
  writeClass: "destructive",
  input: z.object({ id: z.string().uuid() }),
  output: row({ id: uuid, slug: z.string() }),
  handler: async (input, ctx) => {
    const [form] = await ctx.tx.select({ id: forms.id, slug: forms.slug, trashedAt: forms.trashedAt }).from(forms).where(eq(forms.id, input.id)).for("update");
    if (!form) throw new ServiceError("not_found", "That form is gone.");
    // The outer legacy service authorizes this exact operation, including an
    // existing forms.delete-only key. Compose only the fixed reversible
    // primitive; its event and audit share this transaction. The outer audit
    // retains the original caller. Repeated deletion never renews trash age.
    if (!form.trashedAt) await ctx.callAsSystem(removeForm, { id: form.id });
    ctx.setSubject("form", form.id);
    return { id: form.id, slug: form.slug };
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

function formsDemoContribution(scenarioKey: string) {
  return scenarioKey === "seed.current-modules"
    ? { key: "forms.current-modules", version: 1 }
    : { key: "forms.demo-form", version: 1 };
}

function formsDemoOutcome(scenarioKey: string) {
  return scenarioKey === "seed.current-modules"
    ? "forms.current-modules.visible"
    : "forms.demo-form.visible";
}

export const loadDemoForms = defineService({
  name: "forms.loadDemoFixture",
  summary: "Load the forms contribution for a tracked demo run.",
  kind: "mutation",
  permission: "scoped",
  input: demoHandlerInputSchema,
  output: demoLoadResultSchema,
  handler: async (input, ctx) => {
    await requireDemoHandlerRun(ctx.tx, input, formsDemoContribution(input.scenarioKey), "load");
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
  summary: "Purge only tracked demo forms through shared retention-aware cleanup.",
  kind: "mutation",
  permission: "system",
  external: false,
  writeClass: "destructive",
  input: demoHandlerInputSchema,
  output: demoPurgeResultSchema,
  handler: async (input, ctx) => {
    await requireDemoHandlerRun(ctx.tx, input, formsDemoContribution(input.scenarioKey), "purge");
    const purged: Array<{ subjectType: string; subjectId: string }> = [];
    for (const record of input.records) {
      if (record.fixtureKey !== "enquiry-form" || record.subjectType !== "form") {
        throw new ServiceError("validation", "Unexpected forms demo provenance.");
      }
      const [existing] = await ctx.tx
        .select({ id: forms.id, trashedAt: forms.trashedAt })
        .from(forms)
        .where(eq(forms.id, record.subjectId))
        .limit(1);
      if (existing) {
        // Provenance was verified above by the approved demo workflow. The
        // same shared purge guard still protects customer evidence on a demo.
        if (!existing.trashedAt) await ctx.callAsSystem(removeForm, { id: existing.id });
        await ctx.callAsSystem(purgeForm, { id: existing.id, confirmation: "PURGE" });
      }
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
    await requireDemoHandlerRun(ctx.tx, input, formsDemoContribution(input.scenarioKey), "verify");
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
          key: formsDemoOutcome(input.scenarioKey),
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

const MB = 1024 * 1024;

/**
 * Turn each file field's posted asset id into a checked FileAnswer (C3.38).
 *
 * The id is only a claim. The asset has to be a form upload by this very
 * submitter — a signed-in customer's session; an anonymous visitor has no
 * upload to claim — finished and cleared, of a sniffed kind the field accepts,
 * within its size limit, and not attached to anything yet. The rows are
 * locked so two submissions cannot both claim one file; the unique index on
 * the link is the backstop.
 */
async function claimFileAnswers(
  ctx: ServiceContext,
  fields: FormField[],
  data: Record<string, unknown>,
): Promise<Array<{ fieldKey: string; assetId: string }>> {
  const posted = fields.filter(
    (field) => field.kind === "file" && typeof data[field.key] === "string",
  );
  if (posted.length === 0) return [];
  requireUploader(ctx, fields, data);
  const ids = posted.map((field) => data[field.key] as string);
  if (new Set(ids).size !== ids.length) {
    throw new ServiceError("validation", "Upload a separate file for each question.");
  }
  const rows = await ctx.tx
    .select()
    .from(assets)
    .where(inArray(assets.id, ids))
    .for("update");
  const taken = await ctx.tx
    .select({ assetId: formSubmissionFiles.assetId })
    .from(formSubmissionFiles)
    .where(inArray(formSubmissionFiles.assetId, ids));
  const uploader = actorString(ctx.actor);
  const claimed: Array<{ fieldKey: string; assetId: string }> = [];
  for (const field of posted) {
    const id = data[field.key] as string;
    const asset = rows.find((row) => row.id === id);
    const purpose = (asset?.provenance as { purpose?: string } | undefined)?.purpose;
    // Someone else's file and no file at all read the same: the id is not
    // evidence that a file exists, and must not become a way to probe for one.
    if (
      !asset ||
      purpose !== "form" ||
      (ctx.actor.kind === "user" && asset.uploadedBy !== uploader) ||
      asset.status === "trashed"
    ) {
      throw new ServiceError("validation", `Upload ${field.label} again; that file is not yours to attach.`);
    }
    if (taken.some((row) => row.assetId === id)) {
      throw new ServiceError("conflict", `That file is already attached to another submission. Upload ${field.label} again.`);
    }
    if (
      asset.status !== "ready" ||
      (asset.scanStatus !== "clean" && asset.scanStatus !== "not_configured")
    ) {
      throw new ServiceError("validation", `${field.label} has not finished processing or did not pass the file check.`);
    }
    const accept = acceptedKinds(field);
    if (asset.kind === "video" || !accept.includes(asset.kind)) {
      throw new ServiceError(
        "validation",
        `${field.label} must be ${accept.map(kindName).join(" or ")}; that file is ${kindName(asset.kind)}.`,
      );
    }
    const limit = fileFieldMaxBytes(field);
    if (asset.bytes > limit) {
      throw new ServiceError(
        "validation",
        `${field.label} must be ${Math.floor(limit / MB)} MB or smaller; that file is ${Math.ceil(asset.bytes / MB)} MB.`,
      );
    }
    const answer: FileAnswer = {
      assetId: asset.id,
      filename: asset.filename,
      bytes: asset.bytes,
      mime: asset.mime,
    };
    data[field.key] = answer;
    claimed.push({ fieldKey: field.key, assetId: asset.id });
  }
  return claimed;
}

/**
 * Only a signed-in person (or trusted platform composition) answers a file
 * question: an anonymous visitor has no upload of their own to attach. A form
 * whose file questions are all optional still takes an anonymous answer that
 * leaves them empty.
 */
function requireUploader(
  ctx: ServiceContext,
  fields: FormField[],
  values: Record<string, unknown>,
): void {
  if (ctx.actor.kind === "user" || ctx.actor.kind === "system") return;
  const needed = fields.some(
    (field) =>
      field.kind === "file" &&
      (field.required || (values[field.key] !== undefined && values[field.key] !== "")),
  );
  if (needed) {
    throw new ServiceError("permission", "Sign in to upload a file with this form.");
  }
}

function kindName(kind: string): string {
  if (kind === "doc") return "a document";
  if (kind === "audio") return "an audio file";
  if (kind === "image") return "an image";
  return "a video";
}

/**
 * The owner opens a file somebody sent with a form (C3.38).
 *
 * Staff-only by its grant, keyed by the attachment rather than the asset, so
 * the only files reachable here are ones a submission holds — and the caller
 * gets a storage key to stream from a no-store, attachment-only response, never
 * a public URL.
 */
export const openSubmissionFile = defineService({
  name: "forms.openSubmissionFile",
  summary: "Open a file attached to a form submission.",
  kind: "query",
  permission: "scoped",
  input: z.object({ id: z.string().uuid() }),
  output: row({
    storageKey: z.string(),
    filename: z.string(),
    mime: z.string(),
    bytes: z.number(),
  }).nullable(),
  handler: async (input, ctx) => {
    const [file] = await ctx.tx
      .select({
        storageKey: assets.storageKey,
        filename: assets.filename,
        mime: assets.mime,
        bytes: assets.bytes,
      })
      .from(formSubmissionFiles)
      .innerJoin(assets, eq(assets.id, formSubmissionFiles.assetId))
      .where(and(eq(formSubmissionFiles.id, input.id), eq(assets.status, "ready")))
      .limit(1);
    return file ?? null;
  },
});

/** The attachments of these submissions, for the admin to link. */
export const listSubmissionFiles = defineService({
  name: "forms.listSubmissionFiles",
  summary: "Files attached to form submissions.",
  kind: "query",
  permission: "scoped",
  input: z.object({
    submissionIds: z.array(z.string().uuid()).max(200),
    /** A project may show only attachments belonging to its own contact. */
    contactId: uuid.optional(),
  }),
  output: listed(
    row({
      id: uuid,
      submissionId: uuid,
      fieldKey: z.string(),
      assetId: uuid,
      filename: z.string(),
      mime: z.string(),
      bytes: z.number(),
    }),
  ),
  handler: (input, ctx) =>
    input.submissionIds.length === 0
      ? Promise.resolve([])
      : ctx.tx
          .select({
            id: formSubmissionFiles.id,
            submissionId: formSubmissionFiles.submissionId,
            fieldKey: formSubmissionFiles.fieldKey,
            assetId: formSubmissionFiles.assetId,
            filename: assets.filename,
            mime: assets.mime,
            bytes: assets.bytes,
          })
          .from(formSubmissionFiles)
          .innerJoin(formSubmissions, eq(formSubmissions.id, formSubmissionFiles.submissionId))
          .innerJoin(assets, eq(assets.id, formSubmissionFiles.assetId))
          .where(and(
            inArray(formSubmissionFiles.submissionId, input.submissionIds),
            input.contactId ? eq(formSubmissions.contactId, input.contactId) : undefined,
            eq(assets.status, "ready"),
          ))
          .orderBy(formSubmissionFiles.createdAt, formSubmissionFiles.id),
});

/**
 * The most one public submission may carry, all answers together, as UTF-8
 * JSON. Generous on purpose: a few long answers in Arabic or CJK script run
 * to several bytes a character, and an honest enquiry must never hit this.
 */
export const SUBMISSION_BYTES = 256 * 1024;

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
    /**
     * The site form's seal (C3.33, C3.34): the screening outcome, which can
     * only add a reason to quarantine and never clear one a trap raised, and
     * proof the submission came through a form that showed the provider
     * notice. An anonymous submission without one is held as unchecked while
     * screening is on, whichever path it took.
     */
    screening: z.string().max(300).optional(),
  }),
  output: z.object({
    ok: z.literal(true),
    submissionId: uuid,
    message: z.string(),
  }),
  handler: async (input, ctx) => {
    const [form] = await ctx.tx
      .select()
      .from(forms)
      .where(and(eq(forms.slug, input.slug), isNull(forms.trashedAt)))
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
    const screened = screeningReason(input.screening, input.slug, input.values, ctx.actor);
    if (screened) {
      verdict.reasons.push(screened);
      verdict.suspected = true;
    }

    // C3.38: a file question needs a signed-in submitter before anything else
    // is said about the answers — "sign in" is the one thing that helps.
    requireUploader(ctx, fields, input.values);
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
    const files = await claimFileAnswers(ctx, fields, data);
    // A ceiling on the whole submission, not just each field: a form may ask
    // for many long answers, and every submission is copied into the
    // conversation thread as well. The playground's shared disk gets a
    // tighter one (PLAYGROUND_SUBMISSION_BYTES).
    const bytes = Buffer.byteLength(JSON.stringify(data), "utf8");
    const ceiling = env().FREEHOLDER_PLAYGROUND === "1" && ctx.actor.kind !== "system"
      ? PLAYGROUND_SUBMISSION_BYTES
      : SUBMISSION_BYTES;
    if (bytes > ceiling) {
      throw new ServiceError("validation", "These answers are too long to send. Please shorten them and try again.");
    }
    // C11.10: malformed posts and other visitors cannot exhaust the whole form.
    // Without a trusted proxy, throttle the validated address (or identical
    // anonymous answers); perimeter flood control remains the host's concern.
    const identity = ctx.actor.kind === "user" ? `user:${ctx.actor.userId}`
      : (ctx.actor.request?.trustedIp ? clientNetwork(ctx.actor.request.trustedIp) : undefined) ?? emailFrom(fields, data)?.trim().toLowerCase()
        ?? JSON.stringify(Object.entries(data).sort(([a], [b]) => a.localeCompare(b)));
    if (ctx.actor.kind !== "system") {
      const verdict = await consumeAccepted(ctx.tx, `forms.submit:${form.id}:${createHash("sha256").update(identity).digest("hex")}`, {
        limit: 30, windowSeconds: 10 * 60,
      });
      if (!verdict.allowed) throw new ServiceError("rate_limited", "Too many submissions. Try again shortly.", verdict.retryAfterSeconds);
    }

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
    } else if (form.destination === "contact" && files.length && ctx.actor.kind === "user" && !verdict.suspected) {
      // A form that asks for a file but not an email still belongs to the
      // person who uploaded it: the signed-in customer's own contact, so the
      // file is in their export and their erasure (C3.38).
      const [own] = await ctx.tx
        .select({ id: contacts.id })
        .from(contacts)
        .where(eq(contacts.userId, ctx.actor.userId))
        .limit(1);
      contactId = own?.id ?? null;
    }

    const [submission] = await ctx.tx
      .insert(formSubmissions)
      .values({
        // Preserve the actual capture order inside composed transactions.
        createdAt: sql`clock_timestamp()`,
        formId: form.id,
        contactId,
        data,
        sourceUrl: input.sourceUrl,
        status: verdict.suspected ? "spam" : "received",
        spamReasons: verdict.reasons,
      })
      .returning();

    ctx.setSubject("form_submission", submission!.id);
    if (files.length) {
      await ctx.tx
        .insert(formSubmissionFiles)
        .values(
          files.map((file) => ({
            submissionId: submission!.id,
            fieldKey: file.fieldKey,
            assetId: file.assetId,
          })),
        )
        .catch((error: unknown) => {
          // Two submissions racing for one upload: the index decides, and the
          // loser is told plainly rather than sharing somebody's file.
          if (isUniqueViolation(error)) {
            throw new ServiceError("conflict", "That file is already attached to another submission. Upload it again.");
          }
          throw error;
        });
    }

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
        // A submission is an inbound message on the `form` channel (C7.08).
        // §4.14: a form submission, the email reply to it and a text about the
        // same job belong in one conversation — which only holds if the
        // submission is *in* the conversation rather than beside it. Elevated
        // because this path is anonymous by definition.
        await ctx.callAsSystem(getService("conversations.record"), {
          contactId,
          direction: "inbound",
          channel: "form",
          subject: form.name,
          sentBy: "contact",
          // Whatever they actually wrote, falling back to a readable summary of
          // the answers: a thread whose first message is "[object Object]" is
          // worse than no thread.
          body: messageFrom(fields, data) || summarise(fields, data),
        });
        // C3.37: an intake opens the work in the same transaction, so a
        // submission and its project commit together or not at all.
        await openIntakeProject(ctx, form, submission!.id, contactId, data);
      }
      ctx.queueEvent("forms.submitted", {
        formId: form.id,
        submissionId: submission!.id,
        contactId,
        // C3.34: only a submission sealed by a site form (which showed the
        // provider notice) may be copied to a lead sink.
        fromSiteForm: openScreening(input.screening, input.slug, input.values) !== null,
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

/** Everything they answered, when none of it was prose. */
function summarise(fields: FormField[], data: Record<string, unknown>): string {
  const lines = fields
    .map((field) => {
      const value = data[field.key];
      // Only what a form field can actually hold. Anything else would render as
      // "[object Object]", which is worse in a conversation than leaving it out.
      const written =
        typeof value === "string" || typeof value === "number" || typeof value === "boolean"
          ? String(value)
          : Array.isArray(value)
            ? value.filter((one) => typeof one === "string").join(", ")
            : isFileAnswer(value)
              ? value.filename
              : "";
      return written === "" ? null : `${field.label}: ${written}`;
    })
    .filter((line): line is string => line !== null);
  return lines.join("\n") || "(no answers)";
}

/** An intake's project title, with `{key}` filled from the answers. */
export function intakeTitle(
  template: string,
  form: { name: string; fields: FormField[] },
  data: Record<string, unknown>,
): string {
  const keys = new Set(form.fields.map((field) => field.key));
  const filled = template.replace(/\{([a-zA-Z0-9_]+)\}/g, (whole, key: string) => {
    if (key === "form") return form.name;
    if (!keys.has(key)) return whole;
    const value = data[key];
    return typeof value === "string" || typeof value === "number" ? String(value) : "";
  });
  // One line, at most a project title long. Answers can hold newlines.
  const title = filled.replace(/\s+/g, " ").trim().slice(0, 200).trim();
  return title || form.name.slice(0, 200);
}

/**
 * Open the project an intake submission asks for (C3.37), in the caller's
 * transaction. Elevated, because the sender is usually anonymous and opening
 * the work is a consequence of what they were allowed to do, not a
 * permission of theirs. Idempotent per submission: projects finds the one it
 * already opened. A form whose projects module has since been switched off
 * keeps the submission and opens nothing.
 */
async function openIntakeProject(
  ctx: ServiceContext,
  form: { id: string; name: string; slug: string; fields: unknown; intake: unknown },
  submissionId: string,
  contactId: string,
  data: Record<string, unknown>,
): Promise<void> {
  const intake = intakeSchema.safeParse(form.intake);
  if (!intake.success || !listServices().has(INTAKE_SERVICE)) return;
  const fields = form.fields as FormField[];
  await ctx.callAsSystem(getService(INTAKE_SERVICE), {
    submissionId,
    contactId,
    title: intakeTitle(intake.data.projectTitle, { name: form.name, fields }, data),
    summary: summarise(fields, data).slice(0, 5_000),
    label: form.name.slice(0, 200),
  });
}

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
      .limit(1)
      .for("update");
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

    // A rescued intake opens its project exactly as an unflagged one would
    // have; one already opened is found again rather than opened twice.
    if (rescuing && contactId && form) {
      await openIntakeProject(ctx, form, before.id, contactId, before.data as Record<string, unknown>);
    }

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
      // A file is named, never linked: the owner opens it in the admin.
      if (isFileAnswer(value)) return `${field.label}: ${value.filename} (attached)`;
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

import briefingContributors from "@/modules/forms/briefing";

export default [
  ...briefingContributors,
  listForms,
  getForm,
  getFormById,
  createForm,
  updateForm,
  deleteForm,
  removeForm,
  restoreForm,
  purgeForm,
  purgeExpiredForms,
  loadDemoForms,
  purgeDemoForms,
  verifyDemoForms,
  submitForm,
  listSubmissions,
  listSubmissionFiles,
  openSubmissionFile,
  reviewSubmission,
  submissionCounts,
];
