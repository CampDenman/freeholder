// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Service intake and delivery (MASTER.md §43 C3.37), on real PostgreSQL.
//
// The journey a working one-offer business needs: a customer sends the offer
// request, a project opens for them, the owner starts and delivers it, and the
// customer sees New → In progress → Delivered in My Account and downloads the
// file through their own session — while nobody else can.
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { ready } from "@/core/runtime";
import { db } from "@/core/db";
import { users } from "@/core/auth/schema";
import { contacts } from "@/core/contacts/schema";
import { assets } from "@/core/media/schema";
import { notifications } from "@/core/notifications/schema";
import { auditLog } from "@/core/events/schema";
import { resolveContact } from "@/core/contacts/service";
import { translator } from "@/core/i18n";
import type { Actor } from "@/core/service";
import { myRecords } from "@/core/portal/service";
import { myRecord } from "@/core/portal/record-service";
import {
  createForm,
  HONEYPOT_FIELD,
  STAMP_FIELD,
  intakeTitle,
  reviewSubmission,
  submitForm,
  updateForm,
} from "@/modules/forms/service";
import {
  createProject,
  deliverProject,
  getProject,
  listProjects,
  openFromIntake,
  updateProject,
} from "@/modules/projects/service";
import { listDocuments, myDocumentDownload } from "@/modules/documents/service";
import { issueStamp } from "@/modules/forms/antispam";
import { installLaunch, launchSpecSchema } from "@/modules/seed/launch";
import { ANONYMOUS, CUSTOMER, closeDb, failure, hasDatabase, OWNER, truncateSpine } from "../helpers/spine";

const OTHER: Extract<Actor, { kind: "user" }> = {
  kind: "user",
  userId: "00000000-0000-4000-8000-000000000004",
  role: "customer",
  grants: [],
};

const FIELDS = [
  { key: "name", label: "Your name", kind: "text" as const, required: true },
  { key: "email", label: "Email", kind: "email" as const, required: true },
  { key: "company", label: "Business or website", kind: "text" as const },
  { key: "message", label: "What do you need?", kind: "multiline" as const, required: true },
];

/** Answers as a person's browser sends them: with the form's timestamp. */
const human = (values: Record<string, unknown>) => ({
  ...values,
  [STAMP_FIELD]: issueStamp(new Date(Date.now() - 30_000)),
});

const ANSWERS = {
  name: "Rae Morgan",
  email: "rae@example.test",
  company: "Morgan Bakery",
  message: "An audit of our booking page.",
};

async function intakeForm(slug = "audit-request") {
  return createForm.call(
    { slug, name: "Audit request", fields: FIELDS, intake: { projectTitle: "Website audit for {name}" } },
    OWNER,
  );
}

/** Link a user row to the contact so the portal knows who is looking. */
async function signIn(actor: Extract<Actor, { kind: "user" }>, email: string) {
  const { contact } = await resolveContact.call({ email, name: email.split("@")[0]! }, OWNER);
  await db().insert(users).values({ id: actor.userId, email, role: "customer" });
  await db().update(contacts).set({ userId: actor.userId }).where(eq(contacts.id, contact.id));
  return contact;
}

async function readyFile(filename = "audit.pdf") {
  const [asset] = await db()
    .insert(assets)
    .values({
      kind: "doc",
      storageKey: `test/${randomUUID()}.pdf`,
      filename,
      mime: "application/pdf",
      legacyBytes: 10,
      bytes: 10,
      status: "ready",
    })
    .returning();
  return asset!;
}

const en = translator("en");

describe("an intake's project title", () => {
  const form = { name: "Audit request", fields: FIELDS.map((field) => ({ required: false, ...field })) };
  it("fills named answers, keeps unknown names and stays one line", () => {
    expect(intakeTitle("Audit for {name} ({company})", form, ANSWERS)).toBe("Audit for Rae Morgan (Morgan Bakery)");
    expect(intakeTitle("{form}: {nobody}", form, ANSWERS)).toBe("Audit request: {nobody}");
    expect(intakeTitle("{message}", form, { message: "two\nlines" })).toBe("two lines");
    expect(intakeTitle("{company}", form, {})).toBe("Audit request");
  });
});

describe.runIf(hasDatabase)("service intake and delivery", { timeout: 120_000 }, () => {
  beforeAll(async () => {
    await ready();
  }, 60_000);
  beforeEach(async () => {
    await truncateSpine();
  });
  afterAll(async () => {
    await closeDb();
  });

  it("opens exactly one New project for the person who sent an intake", async () => {
    await intakeForm();
    const sent = await submitForm.call({ slug: "audit-request", values: human(ANSWERS) }, ANONYMOUS);
    const [contact] = await db().select().from(contacts).where(eq(contacts.email, ANSWERS.email));
    const opened = await listProjects.call({ contactId: contact!.id }, OWNER);
    expect(opened).toHaveLength(1);
    expect(opened[0]).toMatchObject({ title: "Website audit for Rae Morgan", status: "enquiry" });
    expect(opened[0]!.summary).toContain("Business or website: Morgan Bakery");
    const project = await getProject.call({ id: opened[0]!.id }, OWNER);
    expect(project!.links).toEqual([
      expect.objectContaining({ kind: "form_submission", targetId: sent.submissionId, label: "Audit request" }),
    ]);

    // Idempotent per submission: the same submission finds its project again.
    const again = await openFromIntake.call(
      { submissionId: sent.submissionId, contactId: contact!.id, title: "Anything" },
      { kind: "system" },
    );
    expect(again).toEqual({ projectId: opened[0]!.id, opened: false });

    // A second request is a second piece of work, at its own address.
    await submitForm.call({ slug: "audit-request", values: human(ANSWERS) }, ANONYMOUS);
    const both = await listProjects.call({ contactId: contact!.id }, OWNER);
    expect(both).toHaveLength(2);
    expect(new Set(both.map((row) => row.slug)).size).toBe(2);
  });

  it("opens nothing for an ordinary form or for suspected spam, and once for a rescued one", async () => {
    await createForm.call({ slug: "contact", name: "Enquiry", fields: FIELDS }, OWNER);
    await submitForm.call({ slug: "contact", values: human(ANSWERS) }, ANONYMOUS);
    expect(await listProjects.call({}, OWNER)).toHaveLength(0);

    await intakeForm();
    const spam = await submitForm.call(
      { slug: "audit-request", values: { ...human(ANSWERS), [HONEYPOT_FIELD]: "filled" } },
      ANONYMOUS,
    );
    expect(await listProjects.call({}, OWNER)).toHaveLength(0);

    await reviewSubmission.call({ id: spam.submissionId, status: "received" }, OWNER);
    expect(await listProjects.call({}, OWNER)).toHaveLength(1);
    await reviewSubmission.call({ id: spam.submissionId, status: "spam" }, OWNER);
    await reviewSubmission.call({ id: spam.submissionId, status: "received" }, OWNER);
    expect(await listProjects.call({}, OWNER)).toHaveLength(1);
  });

  it("refuses an intake that could not open anything", async () => {
    const refused = await failure(
      createForm.call(
        { slug: "survey", name: "Survey", fields: FIELDS, destination: "none", intake: { projectTitle: "Survey" } },
        OWNER,
      ),
    );
    expect(refused.code).toBe("validation");
    const form = await intakeForm();
    expect((await failure(updateForm.call({ id: form.id, destination: "none" }, OWNER))).code).toBe("validation");
    const cleared = await updateForm.call({ id: form.id, intake: null }, OWNER);
    expect(cleared.intake).toBeNull();
  });

  it("shows the customer New, In progress and Delivered, and only they can download the file", async () => {
    const contact = await signIn(CUSTOMER, ANSWERS.email);
    await signIn(OTHER, "sam@example.test");
    await intakeForm();
    await submitForm.call({ slug: "audit-request", values: human(ANSWERS) }, ANONYMOUS);
    const [project] = await listProjects.call({ contactId: contact.id }, OWNER);

    const label = async () => {
      const [room] = await myRecords.call({ section: "projects" }, CUSTOMER);
      const record = room!.records.find((row) => row.id === project!.id)!;
      return en(record.statusKey!);
    };
    expect(await label()).toBe("New");
    await updateProject.call({ id: project!.id, status: "active" }, OWNER);
    expect(await label()).toBe("In progress");

    const file = await readyFile();
    const delivered = await deliverProject.call(
      { projectId: project!.id, assetId: file.id, note: "Your audit is attached.", contactId: contact.id },
      OWNER,
    );
    expect(delivered.replayed).toBe(false);
    expect(delivered.project).toMatchObject({ status: "complete", deliveryNote: "Your audit is attached." });
    expect(delivered.project.completedAt).toBeInstanceOf(Date);
    expect(await label()).toBe("Delivered");

    const detail = await myRecord.call({ section: "projects", id: project!.id }, CUSTOMER);
    expect(detail.statusKey).toBe("portal.project.status.complete");
    expect(detail.fields).toContainEqual({ labelKey: "portal.project.deliveryNote", value: "Your audit is attached." });
    expect(detail.links).toEqual([
      { labelKey: "portal.project.download", href: `/portal/files/${delivered.documentId}`, params: { title: "audit.pdf" } },
    ]);

    expect((await myDocumentDownload.call({ id: delivered.documentId! }, CUSTOMER))?.filename).toBe("audit.pdf");
    expect(await myDocumentDownload.call({ id: delivered.documentId! }, OTHER)).toBeNull();
    expect((await failure(myRecord.call({ section: "projects", id: project!.id }, OTHER))).code).toBe("not_found");

    const told = await db()
      .select()
      .from(notifications)
      .where(and(eq(notifications.recipientContactId, contact.id), eq(notifications.topic, "projects.delivered")));
    expect(told).toHaveLength(1);
    expect(told[0]!.href).toBe(`/portal/records/projects/${project!.id}`);

    const audited = await db().select().from(auditLog).where(eq(auditLog.action, "projects.deliver"));
    expect(audited).toEqual([expect.objectContaining({ actor: `user:${OWNER.userId}`, subjectId: project!.id })]);
  });

  it("repeats a delivery without a second document or a second notice", async () => {
    const contact = await signIn(CUSTOMER, ANSWERS.email);
    const project = await createProject.call({ title: "Logo refresh", contactId: contact.id }, OWNER);
    const file = await readyFile("logo.zip");
    const first = await deliverProject.call({ projectId: project.id, assetId: file.id }, OWNER);
    const again = await deliverProject.call({ projectId: project.id, assetId: file.id }, OWNER);
    expect(again).toMatchObject({ replayed: true, documentId: first.documentId });
    const documents = await listDocuments.call({ subjectType: "project", subjectId: project.id }, OWNER);
    expect(documents).toHaveLength(1);
    const told = await db().select().from(notifications).where(eq(notifications.recipientContactId, contact.id));
    expect(told).toHaveLength(1);

    // A second file is a second deliverable, and the customer hears about it.
    const second = await deliverProject.call({ projectId: project.id, assetId: (await readyFile("logo-dark.zip")).id }, OWNER);
    expect(second.replayed).toBe(false);
    expect(second.documentId).not.toBe(first.documentId);
    expect(await db().select().from(notifications).where(eq(notifications.recipientContactId, contact.id))).toHaveLength(2);

    // A note on its own completes and tells them too.
    const noteOnly = await createProject.call({ title: "Advice call", contactId: contact.id }, OWNER);
    const noted = await deliverProject.call({ projectId: noteOnly.id, note: "Summary of our call." }, OWNER);
    expect(noted).toMatchObject({ documentId: null, replayed: false });
    expect(noted.project.status).toBe("complete");
  });

  it("refuses a project with no customer, a changed customer, and anyone but staff", async () => {
    const contact = await signIn(CUSTOMER, ANSWERS.email);
    const other = await signIn(OTHER, "sam@example.test");
    const file = await readyFile();
    const internal = await createProject.call({ title: "Our own site" }, OWNER);
    expect((await failure(deliverProject.call({ projectId: internal.id, assetId: file.id }, OWNER))).code).toBe("conflict");

    const project = await createProject.call({ title: "Audit", contactId: contact.id }, OWNER);
    const mismatch = await failure(
      deliverProject.call({ projectId: project.id, assetId: file.id, contactId: other.id }, OWNER),
    );
    expect(mismatch.code).toBe("conflict");
    expect((await failure(deliverProject.call({ projectId: project.id }, OWNER))).code).toBe("validation");

    for (const actor of [CUSTOMER, ANONYMOUS, { kind: "agent", keyName: "helper", scopes: ["documents.*"] } as Actor]) {
      expect((await failure(deliverProject.call({ projectId: project.id, assetId: file.id }, actor))).code).toBe("permission");
    }
    // The internal phase is never a door of its own.
    expect(
      (await failure(openFromIntake.call({ submissionId: randomUUID(), contactId: contact.id, title: "x" }, OWNER))).code,
    ).toBe("permission");

    // Nothing above left a trace: no document, still open.
    expect(await listDocuments.call({ contactId: contact.id }, OWNER)).toHaveLength(0);
    expect((await getProject.call({ id: project.id }, OWNER))!.status).toBe("enquiry");

    // The same capability over MCP/API: an agent holding the scope may deliver.
    const agent: Actor = { kind: "agent", keyName: "delivery-agent", scopes: ["projects.deliver"] };
    const done = await deliverProject.call({ projectId: project.id, assetId: file.id }, agent);
    expect(done.project.status).toBe("complete");
  });

  it("makes the launch template's offer request an intake, and a version 1 spec still installs", async () => {
    const example = JSON.parse(readFileSync(join(__dirname, "../../seed/launch/example.json"), "utf8")) as unknown;
    const spec = launchSpecSchema.parse(example);
    expect(spec.version).toBe(1);
    const result = await installLaunch.call(spec, { kind: "system" });
    expect(result.intakeForms).toEqual(["offer-request"]);
    await submitForm.call(
      { slug: "offer-request", values: human({ name: "Sam Rivera", email: "sam@example.com", message: "Weekly team meeting." }) },
      ANONYMOUS,
    );
    const [opened] = await listProjects.call({}, OWNER);
    expect(opened).toMatchObject({ title: `${spec.offer.name} for Sam Rivera`, status: "enquiry" });
    // The other forms stay ordinary enquiries.
    await submitForm.call(
      { slug: "contact", values: human({ name: "Sam Rivera", email: "sam@example.com", message: "Hello." }) },
      ANONYMOUS,
    );
    expect(await listProjects.call({}, OWNER)).toHaveLength(1);
  });
});
