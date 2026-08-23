// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Notes, and what they are evidence of (C7.03, MASTER.md §4.14).
//
// A note is often the only record of what somebody agreed on a phone call, and
// every claim below follows from that:
//
//   1. **An edit keeps what it said before.** A record that can be silently
//      rewritten is not evidence.
//   2. **Private is enforced in the query**, not on a screen — so it holds for
//      the API, an export and every surface nobody has built yet.
//   3. **A mention is recorded, not parsed.** The body stays what a person
//      typed, and the mention survives the text being edited around it.
//   4. **A note reaches the customer's timeline** whatever it was attached to,
//      which is the whole promise of a spine made visible.
//   5. **Erasure deletes it, unlike a task.** A task is the business's record
//      of work it had to do; a note is what somebody wrote about a person.
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { users } from "@/core/auth/schema";
import { notes, noteRevisions } from "@/core/notes/schema";
import { timelineEvents } from "@/core/contacts/schema";
import { db } from "@/core/db";
import { ready } from "@/core/runtime";
import { getService } from "@/core/service";
import {
  editNote,
  listNotes,
  noteHistory,
  pinNote,
  removeNote,
  writeNote,
} from "@/core/notes/service";
import { closeDb, failure, hasDatabase, OWNER, STAFF, truncateSpine } from "../helpers/spine";

describe.runIf(hasDatabase)("notes", { timeout: 90_000 }, () => {
  beforeEach(async () => {
    await ready();
    await truncateSpine();
    await db()
      .insert(users)
      .values([
        { id: OWNER.userId, email: "owner@example.test", role: "owner" },
        { id: STAFF.userId, email: "staff@example.test", role: "staff" },
      ])
      .onConflictDoNothing();
  }, 60_000);

  afterAll(async () => {
    await truncateSpine();
    await closeDb();
  });

  async function contactId(): Promise<string> {
    const resolved = (await getService("contacts.resolve").call(
      { email: "rae@example.test", name: "Rae Lane", source: "test" },
      { kind: "system" },
    )) as { contact: { id: string } };
    return resolved.contact.id;
  }

  async function noteOn(person: string, overrides: Record<string, unknown> = {}) {
    return writeNote.call(
      {
        subjectType: "contact",
        subjectId: person,
        body: "Prefers the morning.",
        ...overrides,
      },
      OWNER,
    );
  }

  it("refuses a note about something that is not there", async () => {
    const refused = await failure(
      writeNote.call(
        {
          subjectType: "contact",
          subjectId: "00000000-0000-4000-8000-0000000000ff",
          body: "About whom?",
        },
        OWNER,
      ),
    );
    expect(refused.message).toContain("not here");
  });

  it("takes the contact from whatever it is attached to", async () => {
    const person = await contactId();
    const written = await noteOn(person);
    expect(written).toMatchObject({
      contactId: person,
      authorUserId: OWNER.userId,
      visibility: "team",
      pinned: false,
      editCount: 0,
    });
  });

  // The promise of a spine, made visible: a note reaches the person's timeline.
  it("puts a note on the customer's timeline", async () => {
    const person = await contactId();
    await noteOn(person);
    const [event] = await db()
      .select()
      .from(timelineEvents)
      .where(eq(timelineEvents.eventType, "note.written"));
    expect(event).toMatchObject({ contactId: person, subjectType: "contact" });
  });

  it("keeps a private note off the timeline everybody reads", async () => {
    const person = await contactId();
    await noteOn(person, { visibility: "private", body: "Difficult call." });
    const events = await db()
      .select()
      .from(timelineEvents)
      .where(eq(timelineEvents.eventType, "note.written"));
    expect(events).toHaveLength(0);
  });

  it("hides a private note from everybody but its author", async () => {
    const person = await contactId();
    await noteOn(person, { visibility: "private", body: "Only for me." });
    await noteOn(person, { body: "Everybody can read this." });

    expect((await listNotes.call({ contactId: person }, OWNER)).map((n) => n.body)).toContain(
      "Only for me.",
    );
    // Filtered in the query, so it cannot leak through a different surface.
    const colleague = await listNotes.call({ contactId: person }, STAFF);
    expect(colleague.map((note) => note.body)).toEqual(["Everybody can read this."]);
  });

  it("refuses to let a colleague rewrite a private note", async () => {
    const person = await contactId();
    const mine = await noteOn(person, { visibility: "private", body: "Mine." });
    const refused = await failure(editNote.call({ id: mine.id, body: "Theirs." }, STAFF));
    // Not found rather than forbidden: confirming it exists is itself a leak.
    expect(refused.message).toContain("not here");
  });

  // The claim the whole design rests on.
  it("keeps what a note said before it was changed", async () => {
    const person = await contactId();
    const written = await noteOn(person, { body: "Agreed £400." });
    const changed = await editNote.call({ id: written.id, body: "Agreed £450." }, OWNER);
    expect(changed).toMatchObject({ body: "Agreed £450.", editCount: 1 });
    expect(changed.editedAt).toBeTruthy();

    const history = await noteHistory.call({ id: written.id }, OWNER);
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({
      body: "Agreed £400.",
      editedBy: OWNER.userId,
      editedByEmail: "owner@example.test",
    });
  });

  it("does not file a revision when nothing actually changed", async () => {
    const person = await contactId();
    const written = await noteOn(person, { body: "Same words." });
    await editNote.call({ id: written.id, body: "Same words." }, OWNER);
    expect(await db().select().from(noteRevisions)).toHaveLength(0);
    const [after] = await db().select().from(notes).where(eq(notes.id, written.id));
    expect(after!.editCount).toBe(0);
  });

  it("keeps a private note's history as private as the note", async () => {
    const person = await contactId();
    const mine = await noteOn(person, { visibility: "private", body: "First." });
    await editNote.call({ id: mine.id, body: "Second." }, OWNER);
    const refused = await failure(noteHistory.call({ id: mine.id }, STAFF));
    expect(refused.message).toContain("not here");
  });

  it("records a mention rather than reading it out of the words", async () => {
    const person = await contactId();
    const written = await noteOn(person, {
      body: "Sam should call them back.",
      mentions: [STAFF.userId],
    });
    expect(written.mentions).toEqual([STAFF.userId]);
    // The body is exactly what was typed; nothing rewrote it.
    expect(written.body).toBe("Sam should call them back.");

    // And the mention survives the text being edited around it.
    const edited = await editNote.call({ id: written.id, body: "Ring them back." }, OWNER);
    expect(edited.mentions).toEqual([STAFF.userId]);
  });

  it("drops a mention of somebody who is not there", async () => {
    const person = await contactId();
    const written = await noteOn(person, {
      body: "Ask them.",
      mentions: ["00000000-0000-4000-8000-0000000000fe"],
    });
    // A notification nobody receives and a name nothing renders: refused at the
    // door rather than stored.
    expect(written.mentions).toEqual([]);
  });

  it("refuses to mention somebody in a note they cannot read", async () => {
    const person = await contactId();
    const refused = await failure(
      noteOn(person, { visibility: "private", body: "Hey", mentions: [STAFF.userId] }),
    );
    expect(refused.message).toContain("private");
  });

  it("tells the person who was mentioned", async () => {
    const person = await contactId();
    await noteOn(person, { body: "Sam, please chase.", mentions: [STAFF.userId] });
    const unread = (await getService("notifications.unreadCount").call({}, STAFF)) as number;
    expect(unread).toBeGreaterThan(0);
  });

  it("does not tell everybody again when a typo is fixed", async () => {
    const person = await contactId();
    const written = await noteOn(person, { body: "Sam, chse.", mentions: [STAFF.userId] });
    const before = (await getService("notifications.unreadCount").call({}, STAFF)) as number;
    await editNote.call({ id: written.id, body: "Sam, chase." }, OWNER);
    const after = (await getService("notifications.unreadCount").call({}, STAFF)) as number;
    // Re-telling everybody on every edit is how a mention stops meaning
    // anything.
    expect(after).toBe(before);
  });

  it("keeps a pinned note at the top whatever the dates say", async () => {
    const person = await contactId();
    const first = await noteOn(person, { body: "The allergy." });
    await noteOn(person, { body: "Written later." });
    await pinNote.call({ id: first.id, pinned: true }, OWNER);

    const listed = await listNotes.call({ contactId: person }, OWNER);
    expect(listed.map((note) => note.body)).toEqual(["The allergy.", "Written later."]);
    expect(listed[0]!.pinnedAt).toBeTruthy();

    // Unpinning clears the stamp, so "pinned since" is never a date from the
    // last time it briefly was.
    const unpinned = await pinNote.call({ id: first.id, pinned: false }, OWNER);
    expect(unpinned.pinnedAt).toBeNull();
  });

  it("finds everything about a person, whatever it was attached to", async () => {
    const person = await contactId();
    await noteOn(person, { body: "About them." });
    const listed = await listNotes.call({ contactId: person }, OWNER);
    expect(listed[0]).toMatchObject({
      contactName: "Rae Lane",
      href: `/admin/contacts/${person}`,
      authorEmail: "owner@example.test",
    });
  });

  it("finds what asked for one person's attention", async () => {
    const person = await contactId();
    await noteOn(person, { body: "Sam's job.", mentions: [STAFF.userId] });
    await noteOn(person, { body: "Nobody's job." });
    const mine = await listNotes.call({ mentioning: STAFF.userId }, OWNER);
    expect(mine.map((note) => note.body)).toEqual(["Sam's job."]);
  });

  it("takes the history with the note when it is deleted", async () => {
    const person = await contactId();
    const written = await noteOn(person, { body: "First." });
    await editNote.call({ id: written.id, body: "Second." }, OWNER);
    await removeNote.call({ id: written.id }, OWNER);
    expect(await db().select().from(notes)).toHaveLength(0);
    // Keeping a history of a note that no longer exists is keeping the thing
    // somebody asked to be rid of.
    expect(await db().select().from(noteRevisions)).toHaveLength(0);
  });

  it("deletes notes when somebody is forgotten, unlike tasks", async () => {
    const person = await contactId();
    const written = await noteOn(person, { body: "What they told us." });
    await editNote.call({ id: written.id, body: "What they told us, corrected." }, OWNER);

    const { contactPrivacySources } = await import("@/core/privacy/service");
    const source = contactPrivacySources().find((one) => one.scope === "contact.notes");
    expect(source).toBeTruthy();
    await db().transaction((tx) => source!.erase(tx, person, { requestId: "t" }));

    expect(await db().select().from(notes)).toHaveLength(0);
    // A history that survived the erasure would make the whole exercise
    // theatre.
    expect(await db().select().from(noteRevisions)).toHaveLength(0);
  });

  it("keeps both people's notes when two records become one", async () => {
    const survivor = await contactId();
    const duplicate = (
      (await getService("contacts.resolve").call(
        { email: "rae.lane@example.test", name: "Rae L", source: "test" },
        { kind: "system" },
      )) as { contact: { id: string } }
    ).contact.id;
    await noteOn(survivor, { body: "Survivor's." });
    await writeNote.call(
      { subjectType: "contact", subjectId: duplicate, body: "Duplicate's." },
      OWNER,
    );
    await getService("contacts.merge").call(
      { survivingId: survivor, duplicateId: duplicate },
      OWNER,
    );
    const kept = await listNotes.call({ contactId: survivor }, OWNER);
    expect(kept.map((note) => note.body).sort()).toEqual(["Duplicate's.", "Survivor's."]);
  });
});
