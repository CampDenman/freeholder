// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Notes, and what they are evidence of (MASTER.md §4.14, C7.03).
//
// A note is usually the only record of what somebody agreed on a phone call.
// That single observation decides almost everything below.
//
// **An edit keeps what it said before.** A record that can be silently
// rewritten is not evidence, so every change files the old body as a revision
// and stamps who changed it. Nothing here can overwrite a body without leaving
// the previous one behind.
//
// **A private note is private from the read side, not the write side.** The
// filter is in the query rather than in a screen, so a private note cannot leak
// through the API, an export, an agent, or the next surface somebody builds.
//
// **A mention is a fact the service records, not a parse of the body.** The
// body stays exactly what a person typed; who was meant is a separate column.
// So renaming somebody never rewrites a note, and a mention survives the text
// being edited around it.
//
// **Notes project onto the contact timeline.** §4.14's promise is that a
// business can see what happened with a person in one place; a note nobody can
// find from the customer is a note that may as well not exist. `team` and
// `shared` notes emit a timeline event; `private` ones deliberately do not,
// because a timeline everybody reads is not where a private note belongs.
import { z } from "zod";
import { and, arrayContains, desc, eq, inArray, sql } from "drizzle-orm";
import { listed, row, timestamp, uuid } from "@/core/contract";
import { contacts } from "@/core/contacts/schema";
import { users } from "@/core/auth/schema";
import { subjectContact, subjectHref, SUBJECT_KINDS } from "@/core/subjects";
import { registerContactReference } from "@/core/contacts/service";
import { registerContactPrivacySource } from "@/core/privacy/service";
import {
  defineService,
  getService,
  ServiceError,
  type Actor,
  type ServiceContext,
  type Tx,
} from "@/core/service";
import { NOTE_VISIBILITIES, noteRevisions, notes } from "./schema";

// Re-exported so screens and server actions can render the choices without
// importing a schema file: outside core, the service layer is the only door.
export { NOTE_SUBJECTS, NOTE_VISIBILITIES } from "./schema";
export type { SubjectKind as NoteSubject } from "@/core/subjects";

const id = z.string().uuid();

function requirePerson(actor: Actor): void {
  // System passes, as everywhere else: a quote being accepted can leave a note
  // saying so, and that is elevation from a caller with established authority.
  if (actor.kind !== "user" && actor.kind !== "system") {
    throw new ServiceError("permission", "Sign in to write notes.");
  }
}

/** The author, when there is one. A system note has none, and says so. */
function authorOf(actor: Actor): string | null {
  return actor.kind === "user" ? actor.userId : null;
}

const noteRow = row({
  id: uuid,
  subjectType: z.enum(SUBJECT_KINDS),
  subjectId: uuid,
  contactId: uuid.nullable(),
  authorUserId: uuid.nullable(),
  body: z.string(),
  visibility: z.enum(NOTE_VISIBILITIES),
  pinned: z.boolean(),
  pinnedAt: timestamp.nullable(),
  mentions: z.array(uuid),
  editCount: z.number().int(),
  editedAt: timestamp.nullable(),
  createdAt: timestamp,
});

/**
 * What this actor is allowed to see.
 *
 * A private note is its author's alone. The system actor reads everything,
 * because the machinery that exports a contact's data or assembles a briefing
 * is acting for the business rather than for a person — and an export that
 * quietly omitted rows would be a worse answer than one that includes them.
 */
function visible(actor: Actor) {
  if (actor.kind === "system") return undefined;
  const self = actor.kind === "user" ? actor.userId : null;
  return self
    ? sql`(${notes.visibility} <> 'private' or ${notes.authorUserId} = ${self})`
    : sql`${notes.visibility} = 'shared'`;
}

export const writeNote = defineService({
  name: "notes.write",
  summary: "Write something down against a customer, a job or a document.",
  kind: "mutation",
  permission: "scoped",
  writeClass: "write",
  input: z.object({
    subjectType: z.enum(SUBJECT_KINDS),
    subjectId: id,
    body: z.string().trim().min(1).max(20_000),
    visibility: z.enum(NOTE_VISIBILITIES).default("team"),
    pinned: z.boolean().default(false),
    mentions: z.array(id).max(20).default([]),
  }),
  output: noteRow,
  handler: async (input, ctx) => {
    requirePerson(ctx.actor);
    // Resolved, not trusted: this is what makes a note about an *invoice* reach
    // the customer's timeline without the timeline knowing what an invoice is.
    const contactId = await subjectContact(ctx.tx, input.subjectType, input.subjectId);
    const mentions = await realUsers(ctx.tx, input.mentions);
    if (input.visibility === "private" && mentions.length > 0) {
      // Mentioning somebody in a note they cannot read is a promise the system
      // cannot keep, and the failure is silent — they simply never hear.
      throw new ServiceError(
        "validation",
        "A private note is only yours, so nobody else can be mentioned in it.",
      );
    }

    const [created] = await ctx.tx
      .insert(notes)
      .values({
        subjectType: input.subjectType,
        subjectId: input.subjectId,
        contactId,
        authorUserId: authorOf(ctx.actor),
        body: input.body,
        visibility: input.visibility,
        pinned: input.pinned,
        pinnedAt: input.pinned ? new Date() : null,
        mentions,
      })
      .returning();

    if (contactId && input.visibility !== "private") {
      await ctx.emitTimeline({
        contactId,
        eventType: "note.written",
        subjectType: input.subjectType,
        subjectId: input.subjectId,
        payload: { noteId: created!.id, visibility: input.visibility },
      });
    }
    await tellTheMentioned(ctx, created!.id, mentions, input.body);
    ctx.setSubject("note", created!.id);
    ctx.queueEvent("note.written", { id: created!.id, contactId });
    return created!;
  },
});

export const editNote = defineService({
  name: "notes.edit",
  summary: "Change what a note says, keeping what it said before.",
  kind: "mutation",
  permission: "scoped",
  writeClass: "write",
  input: z.object({
    id,
    body: z.string().trim().min(1).max(20_000).optional(),
    visibility: z.enum(NOTE_VISIBILITIES).optional(),
    mentions: z.array(id).max(20).optional(),
  }),
  output: noteRow,
  handler: async (input, ctx) => {
    requirePerson(ctx.actor);
    const [existing] = await ctx.tx.select().from(notes).where(eq(notes.id, input.id)).limit(1);
    if (!existing) throw new ServiceError("not_found", "That note is not here.");
    // A private note is its author's, and that includes editing it: a colleague
    // who cannot read it must not be able to rewrite it either.
    if (
      existing.visibility === "private" &&
      ctx.actor.kind === "user" &&
      existing.authorUserId !== ctx.actor.userId
    ) {
      throw new ServiceError("not_found", "That note is not here.");
    }

    const changingBody = input.body !== undefined && input.body !== existing.body;
    if (changingBody) {
      // The *previous* body is filed, so the note itself stays current and the
      // history reads backwards from it.
      await ctx.tx.insert(noteRevisions).values({
        noteId: existing.id,
        body: existing.body,
        editedBy: authorOf(ctx.actor),
      });
    }

    const mentions =
      input.mentions === undefined ? existing.mentions : await realUsers(ctx.tx, input.mentions);
    const visibility = input.visibility ?? existing.visibility;
    if (visibility === "private" && mentions.length > 0) {
      throw new ServiceError(
        "validation",
        "A private note is only yours, so nobody else can be mentioned in it.",
      );
    }

    const [updated] = await ctx.tx
      .update(notes)
      .set({
        ...(input.body !== undefined ? { body: input.body } : {}),
        ...(input.visibility !== undefined ? { visibility } : {}),
        ...(input.mentions !== undefined ? { mentions } : {}),
        ...(changingBody
          ? { editCount: existing.editCount + 1, editedAt: new Date() }
          : {}),
        updatedAt: sql`now()`,
      })
      .where(eq(notes.id, input.id))
      .returning();

    // Only the newly mentioned hear about it. Re-telling everybody on every
    // typo fix is how a mention stops meaning anything.
    const fresh = mentions.filter((user) => !existing.mentions.includes(user));
    await tellTheMentioned(ctx, updated!.id, fresh, updated!.body);
    ctx.setSubject("note", updated!.id);
    return updated!;
  },
});

export const pinNote = defineService({
  name: "notes.pin",
  summary: "Keep a note at the top, or stop keeping it there.",
  kind: "mutation",
  permission: "scoped",
  writeClass: "write",
  input: z.object({ id, pinned: z.boolean() }),
  output: noteRow,
  handler: async (input, ctx) => {
    requirePerson(ctx.actor);
    const [updated] = await ctx.tx
      .update(notes)
      .set({
        pinned: input.pinned,
        // Stamped on the way in and cleared on the way out, so "pinned since"
        // is when it was actually pinned rather than the first time it ever was.
        pinnedAt: input.pinned ? new Date() : null,
        updatedAt: sql`now()`,
      })
      .where(eq(notes.id, input.id))
      .returning();
    if (!updated) throw new ServiceError("not_found", "That note is not here.");
    ctx.setSubject("note", updated.id);
    return updated;
  },
});

export const removeNote = defineService({
  name: "notes.remove",
  summary: "Delete a note and everything it used to say.",
  kind: "mutation",
  permission: "scoped",
  writeClass: "destructive",
  input: z.object({ id }),
  output: row({ id: uuid }),
  handler: async (input, ctx) => {
    requirePerson(ctx.actor);
    const [existing] = await ctx.tx.select().from(notes).where(eq(notes.id, input.id)).limit(1);
    if (!existing) throw new ServiceError("not_found", "That note is not here.");
    if (
      existing.visibility === "private" &&
      ctx.actor.kind === "user" &&
      existing.authorUserId !== ctx.actor.userId
    ) {
      throw new ServiceError("not_found", "That note is not here.");
    }
    // The revisions go with it. Keeping a history of a note that no longer
    // exists is keeping the thing somebody asked to be rid of.
    await ctx.tx.delete(notes).where(eq(notes.id, input.id));
    ctx.setSubject("note", input.id);
    return { id: input.id };
  },
});

export const listNotes = defineService({
  name: "notes.list",
  summary: "What has been written down about something, pinned first.",
  kind: "query",
  permission: "scoped",
  input: z.object({
    subjectType: z.enum(SUBJECT_KINDS).optional(),
    subjectId: id.optional(),
    /** Everything about a person, whatever it was attached to. */
    contactId: id.optional(),
    /** Only what asked for this person's attention. */
    mentioning: id.optional(),
    pinnedOnly: z.boolean().default(false),
    limit: z.number().int().min(1).max(200).default(50),
  }),
  output: listed(
    noteRow.extend({
      authorEmail: z.string().nullable(),
      contactName: z.string().nullable(),
      href: z.string(),
    }),
  ),
  handler: async (input, ctx) => {
    const where = [
      visible(ctx.actor),
      ...(input.subjectType ? [eq(notes.subjectType, input.subjectType)] : []),
      ...(input.subjectId ? [eq(notes.subjectId, input.subjectId)] : []),
      ...(input.contactId ? [eq(notes.contactId, input.contactId)] : []),
      ...(input.mentioning ? [arrayContains(notes.mentions, [input.mentioning])] : []),
      ...(input.pinnedOnly ? [eq(notes.pinned, true)] : []),
    ].filter(Boolean);

    const rows = await ctx.tx
      .select({ note: notes, authorEmail: users.email, contactName: contacts.name })
      .from(notes)
      .leftJoin(users, eq(users.id, notes.authorUserId))
      .leftJoin(contacts, eq(contacts.id, notes.contactId))
      .where(where.length ? and(...where) : undefined)
      // Pinned first, then newest. The pin exists precisely to survive the
      // ordering everything else obeys.
      .orderBy(desc(notes.pinned), desc(notes.createdAt))
      .limit(input.limit);

    return rows.map(({ note, authorEmail, contactName }) => ({
      ...note,
      authorEmail,
      contactName,
      href: subjectHref(note.subjectType, note.subjectId),
    }));
  },
});

export const noteHistory = defineService({
  name: "notes.history",
  summary: "What a note said before, newest change first.",
  kind: "query",
  permission: "scoped",
  input: z.object({ id }),
  output: listed(
    row({
      id: uuid,
      body: z.string(),
      editedBy: uuid.nullable(),
      editedByEmail: z.string().nullable(),
      editedAt: timestamp,
    }),
  ),
  handler: async (input, ctx) => {
    const [note] = await ctx.tx
      .select({ id: notes.id, visibility: notes.visibility, authorUserId: notes.authorUserId })
      .from(notes)
      .where(eq(notes.id, input.id))
      .limit(1);
    if (!note) throw new ServiceError("not_found", "That note is not here.");
    // The history obeys the same visibility as the note. A private note whose
    // past anybody could read would be private in name only.
    if (
      note.visibility === "private" &&
      ctx.actor.kind === "user" &&
      note.authorUserId !== ctx.actor.userId
    ) {
      throw new ServiceError("not_found", "That note is not here.");
    }
    const rows = await ctx.tx
      .select({
        id: noteRevisions.id,
        body: noteRevisions.body,
        editedBy: noteRevisions.editedBy,
        editedByEmail: users.email,
        editedAt: noteRevisions.editedAt,
      })
      .from(noteRevisions)
      .leftJoin(users, eq(users.id, noteRevisions.editedBy))
      .where(eq(noteRevisions.noteId, input.id))
      .orderBy(desc(noteRevisions.editedAt))
      .limit(100);
    return rows;
  },
});

/**
 * Keep only the ids that are real accounts.
 *
 * A mention of somebody who has left is a notification nobody receives and a
 * name nothing can render, so it is dropped at the door rather than stored.
 */
async function realUsers(tx: Tx, candidates: string[]): Promise<string[]> {
  if (candidates.length === 0) return [];
  const found = await tx
    .select({ id: users.id })
    .from(users)
    .where(inArray(users.id, candidates));
  return found.map((user) => user.id);
}

/**
 * Tell the people who were mentioned, once each.
 *
 * Through `notifications.create` rather than mail directly, so it respects the
 * per-topic immediate/digest/off preference an owner already set (§4.14's
 * notification rules) instead of inventing a second way to be interrupted.
 */
async function tellTheMentioned(
  ctx: ServiceContext,
  noteId: string,
  mentions: string[],
  body: string,
): Promise<void> {
  for (const userId of mentions) {
    // Never tell somebody they mentioned themselves.
    if (ctx.actor.kind === "user" && ctx.actor.userId === userId) continue;
    await ctx.callAsSystem(getService("notifications.create"), {
      recipient: { kind: "user", id: userId },
      topic: "note.mention",
      title: "You were mentioned in a note",
      body: body.length > 200 ? `${body.slice(0, 197)}…` : body,
      href: "/admin/contacts",
      idempotencyKey: `note-mention:${noteId}:${userId}`,
    });
  }
}

/**
 * Merge keeps every note and repoints it (§4.1).
 *
 * A note is the business's memory of a person. Losing the duplicate's notes at
 * the exact moment two records became one would delete the thing the merge was
 * meant to consolidate.
 */
registerContactReference({
  table: "notes",
  repoint: (tx, duplicateId, survivingId) =>
    tx.update(notes).set({ contactId: survivingId }).where(eq(notes.contactId, duplicateId)),
  captureForUndo: async (tx, duplicateId, survivingId) => ({
    state: await tx
      .select({ id: notes.id, contactId: notes.contactId })
      .from(notes)
      .where(inArray(notes.contactId, [duplicateId, survivingId])),
    undoable: true,
  }),
  restoreAfterUndo: async (tx, beforeState, _afterState, duplicateId) => {
    const moved = z
      .array(z.object({ id: z.string().uuid(), contactId: z.string().uuid().nullable() }))
      .parse(beforeState)
      .filter((note) => note.contactId === duplicateId);
    if (moved.length) {
      await tx
        .update(notes)
        .set({ contactId: duplicateId })
        .where(inArray(notes.id, moved.map((note) => note.id)));
    }
  },
});

/**
 * What a note means for the person's own data (§30).
 *
 * Unlike a task, a note **goes**. A task is the business's record of work it
 * had to do; a note is what somebody wrote *about a person*, which is the
 * plainest possible case of their personal data. Erasure deletes the body and
 * every revision of it, because a history that survives the erasure would make
 * the whole exercise theatre.
 */
registerContactPrivacySource({
  scope: "contact.notes",
  tables: ["notes", "note_revisions"],
  exportData: async (tx, contactId) =>
    tx.select().from(notes).where(eq(notes.contactId, contactId)).orderBy(desc(notes.createdAt)),
  erase: async (tx, contactId) => {
    // The revisions cascade with the note, which is the point: what it used to
    // say is as much about the person as what it says.
    const removed = await tx
      .delete(notes)
      .where(eq(notes.contactId, contactId))
      .returning({ id: notes.id });
    return { affected: removed.length };
  },
});

export default [writeNote, editNote, pinNote, removeNote, listNotes, noteHistory];
