// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C11.14: recovery preserves identity, privacy, history and contact ownership.
import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/core/db";
import { users } from "@/core/auth/schema";
import { createContact, mergeContacts, undoContactMerge } from "@/core/contacts/service";
import { notes, noteRevisions } from "@/core/notes/schema";
import { tasks } from "@/core/tasks/schema";
import { writeNote, editNote, pinNote, removeNote, restoreNote, purgeNote, purgeExpiredNotes, listNotes } from "@/core/notes/service";
import { createTask, removeTask, restoreTask, purgeTask, purgeExpiredTasks, listTasks, sendTaskReminders, setTaskStatus, briefingTasks } from "@/core/tasks/service";
import { createDataRequest, addRetentionException, removeRetentionException, verifyDataRequest, fulfillDataRequest } from "@/core/privacy/service";
import { querySearch } from "@/core/search/service";
import { stopJobs } from "@/core/jobs";
import { OWNER, STAFF, ANONYMOUS, hasDatabase, truncateSpine, closeDb } from "../helpers/spine";

async function records(visibility: "team" | "private" = "team") {
  const contact = await createContact.call({ name: "Recovery customer", email: `recovery-${randomUUID()}@example.test` }, OWNER);
  const note = await writeNote.call({ subjectType: "contact", subjectId: contact.id, body: "Recoverable original", visibility }, OWNER);
  await editNote.call({ id: note.id, body: "Recoverable edited" }, OWNER);
  const task = await createTask.call({ subjectType: "contact", subjectId: contact.id, title: "Recoverable task", details: "Private task detail",
    dueAt: new Date(Date.now() - 60_000).toISOString(), remindAt: new Date(Date.now() - 120_000).toISOString(), assigneeUserId: OWNER.userId }, OWNER);
  return { contact, note, task };
}

describe.runIf(hasDatabase)("note and task trash", () => {
  beforeEach(async () => {
    await truncateSpine();
    await db().insert(users).values([
      { id: OWNER.userId, email: "owner@example.test", role: "owner" },
      { id: STAFF.userId, email: "staff@example.test", role: "staff" },
    ]);
  });
  afterAll(async () => { await stopJobs(); await closeDb(); });

  it("hides trashed work from ordinary reads, search, reminders and briefing until restored", async () => {
    const { note, task } = await records();
    await removeNote.call({ id: note.id }, OWNER);
    await removeTask.call({ id: task.id }, OWNER);
    expect(await listNotes.call({}, OWNER)).toEqual([]);
    expect(await listTasks.call({}, OWNER)).toEqual([]);
    expect(await querySearch.call({ q: "Recoverable" }, OWNER)).toEqual([]);
    expect(await sendTaskReminders()).toEqual({ sent: 0, skipped: 0 });
    const briefing = await briefingTasks.call({ userId: OWNER.userId, onDate: new Date().toISOString().slice(0, 10), timezone: "UTC" }, { kind: "system" });
    expect(JSON.stringify(briefing)).not.toContain("Recoverable task");
    await expect(editNote.call({ id: note.id, body: "Changed trash" }, OWNER)).rejects.toMatchObject({ code: "not_found" });
    await expect(pinNote.call({ id: note.id, pinned: true }, OWNER)).rejects.toMatchObject({ code: "not_found" });
    await expect(setTaskStatus.call({ id: task.id, status: "done" }, OWNER)).rejects.toMatchObject({ code: "not_found" });
    expect((await listNotes.call({ trashedOnly: true }, OWNER))[0]?.id).toBe(note.id);
    expect((await listTasks.call({ trashedOnly: true }, OWNER))[0]?.id).toBe(task.id);
    expect((await restoreNote.call({ id: note.id }, OWNER)).id).toBe(note.id);
    expect((await restoreTask.call({ id: task.id }, OWNER)).id).toBe(task.id);
    expect(await db().select().from(noteRevisions)).toHaveLength(1);
    expect((await querySearch.call({ q: "Recoverable" }, OWNER)).map(hit => hit.kind).sort()).toEqual(["note", "task"]);
  });

  it("keeps private trash private and requires explicit, authorized permanent deletion", async () => {
    const { note, task } = await records("private");
    await expect(purgeTask.call({ id: task.id, confirmation: "PURGE" }, OWNER)).rejects.toMatchObject({ code: "conflict" });
    await removeNote.call({ id: note.id }, OWNER);
    expect(await listNotes.call({ trashedOnly: true }, STAFF)).toEqual([]);
    await expect(restoreNote.call({ id: note.id }, STAFF)).rejects.toMatchObject({ code: "not_found" });
    await expect(purgeNote.call({ id: note.id, confirmation: "PURGE" }, STAFF)).rejects.toMatchObject({ code: "conflict" });
    await expect(restoreNote.call({ id: note.id }, ANONYMOUS)).rejects.toMatchObject({ code: "permission" });
    await purgeNote.call({ id: note.id, confirmation: "PURGE" }, OWNER);
    expect(await db().select().from(noteRevisions)).toHaveLength(0);
    await expect(restoreNote.call({ id: note.id }, OWNER)).rejects.toMatchObject({ code: "not_found" });
  });

  it("keeps held trash until its hold is released, including the scheduled purge path", async () => {
    const { contact, note, task } = await records();
    const request = await createDataRequest.call({ contactId: contact.id, request: { kind: "erasure" } }, OWNER);
    const holds = [];
    for (const scope of ["contact.notes", "contact.tasks"]) holds.push(await addRetentionException.call({ dataRequestId: request.id, scope,
      reason: "legal_claim", legalBasis: "Documented active dispute" }, OWNER));
    await removeNote.call({ id: note.id }, OWNER);
    await removeTask.call({ id: task.id }, OWNER);
    const expired = new Date(Date.now() - 31 * 86_400_000);
    await db().update(notes).set({ trashedAt: expired }).where(eq(notes.id, note.id));
    await db().update(tasks).set({ trashedAt: expired }).where(eq(tasks.id, task.id));
    await expect(purgeNote.call({ id: note.id, confirmation: "PURGE" }, OWNER)).rejects.toMatchObject({ code: "conflict" });
    await expect(purgeTask.call({ id: task.id, confirmation: "PURGE" }, OWNER)).rejects.toMatchObject({ code: "conflict" });
    expect(await purgeExpiredNotes.call({}, { kind: "system" })).toEqual({ purged: 0 });
    expect(await purgeExpiredTasks.call({}, { kind: "system" })).toEqual({ purged: 0 });
    for (const hold of holds) await removeRetentionException.call({ id: hold.id }, OWNER);
    expect(await purgeExpiredNotes.call({}, { kind: "system" })).toEqual({ purged: 1 });
    expect(await purgeExpiredTasks.call({}, { kind: "system" })).toEqual({ purged: 1 });
  });

  it("does not resurrect personal data erased while its records were in trash", async () => {
    const { contact, note, task } = await records();
    await removeNote.call({ id: note.id }, OWNER);
    await removeTask.call({ id: task.id }, OWNER);
    const request = await createDataRequest.call({ contactId: contact.id, request: { kind: "erasure" } }, OWNER);
    await verifyDataRequest.call({ id: request.id, method: "Verified requester" }, OWNER);
    await fulfillDataRequest.call({ id: request.id, confirmation: "ERASE" }, OWNER);
    await expect(restoreNote.call({ id: note.id }, OWNER)).rejects.toMatchObject({ code: "not_found" });
    expect(await restoreTask.call({ id: task.id }, OWNER)).toMatchObject({ title: "A task", details: null, contactId: null });
    expect(await db().select().from(noteRevisions)).toHaveLength(0);
  });

  it("restores onto the surviving contact after a merge, including the subject link", async () => {
    const { contact, note, task } = await records();
    const survivor = await createContact.call({ name: "Surviving customer", email: "surviving-recovery@example.test" }, OWNER);
    await removeNote.call({ id: note.id }, OWNER);
    await removeTask.call({ id: task.id }, OWNER);
    await mergeContacts.call({ survivingId: survivor.id, duplicateId: contact.id }, OWNER);
    expect(await restoreNote.call({ id: note.id }, OWNER)).toMatchObject({ contactId: survivor.id, subjectId: survivor.id });
    expect(await restoreTask.call({ id: task.id }, OWNER)).toMatchObject({ contactId: survivor.id, subjectId: survivor.id });
    expect((await listNotes.call({ subjectType: "contact", subjectId: survivor.id }, OWNER))[0]?.id).toBe(note.id);
  });

  it("restores contact-subject pointers when a merge of trashed work is undone", async () => {
    const { contact, note, task } = await records();
    const survivor = await createContact.call({ name: "Undo survivor" }, OWNER);
    await removeNote.call({ id: note.id }, OWNER);
    await removeTask.call({ id: task.id }, OWNER);
    const merged = await mergeContacts.call({ survivingId: survivor.id, duplicateId: contact.id }, OWNER);
    await undoContactMerge.call({ operationId: merged.mergeOperationId }, OWNER);
    expect(await restoreNote.call({ id: note.id }, OWNER)).toMatchObject({ contactId: contact.id, subjectId: contact.id });
    expect(await restoreTask.call({ id: task.id }, OWNER)).toMatchObject({ contactId: contact.id, subjectId: contact.id });
  });

  it("requires manage access to restore and recent identity verification to purge", async () => {
    const { note, task } = await records();
    await removeNote.call({ id: note.id }, OWNER);
    await removeTask.call({ id: task.id }, OWNER);
    const reader = { ...STAFF, grants: [{ module: "notes", access: "view" as const }, { module: "tasks", access: "view" as const }] };
    for (const [restore, record] of [[restoreNote, note], [restoreTask, task]] as const) {
      await expect(restore.call({ id: record.id }, reader)).rejects.toMatchObject({ code: "permission" });
    }
    const unverified = { ...OWNER, security: { twoFactorRequired: true, twoFactorEnrolled: true, twoFactorVerified: true, stepUpValid: false } };
    await expect(purgeNote.call({ id: note.id, confirmation: "PURGE" }, unverified)).rejects.toMatchObject({ code: "step_up_required" });
    await expect(purgeTask.call({ id: task.id, confirmation: "PURGE" }, unverified)).rejects.toMatchObject({ code: "step_up_required" });
    expect(await listNotes.call({ trashedOnly: true }, OWNER)).toHaveLength(1);
    expect(await listTasks.call({ trashedOnly: true }, OWNER)).toHaveLength(1);
  });

  it("paginates trash without repeated rows and purges at most 500 records per sweep", async () => {
    const contact = await createContact.call({ name: "Batch recovery", email: "batch-recovery@example.test" }, OWNER);
    await db().insert(notes).values(Array.from({ length: 502 }, (_, index) => ({
      subjectType: "contact" as const, subjectId: contact.id, contactId: contact.id, authorUserId: OWNER.userId,
      body: `Trash batch ${index}`, trashedAt: new Date(Date.now() - 31 * 86_400_000),
    })));
    const first = await listNotes.call({ trashedOnly: true, limit: 50, offset: 0 }, OWNER);
    const second = await listNotes.call({ trashedOnly: true, limit: 50, offset: 50 }, OWNER);
    expect(new Set([...first, ...second].map(note => note.id)).size).toBe(100);
    expect(await purgeExpiredNotes.call({}, { kind: "system" })).toEqual({ purged: 500 });
    expect(await purgeExpiredNotes.call({}, { kind: "system" })).toEqual({ purged: 2 });
    expect(await purgeExpiredNotes.call({}, { kind: "system" })).toEqual({ purged: 0 });
  });
});
