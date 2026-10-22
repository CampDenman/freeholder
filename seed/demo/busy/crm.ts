// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// The studio's people: organisations, contacts, notes, tasks, look-alike
// duplicates and the first line of every contact's timeline (C1.38 busy demo).
import { contacts, mergeCandidates, organizations, timelineEvents } from "@/core/contacts/schema";
import { notes } from "@/core/notes/schema";
import { tasks } from "@/core/tasks/schema";
import { DAY, ORGANISATIONS, type AreaSeeder } from "./world";

const NOTE_BODIES = [
  "Prefers email over phone — works night shifts at the hospital.",
  "Asked about the linen album; send the sample spreads before the consult.",
  "Mother of the bride is the real decision-maker. Copy her on the timeline.",
  "Allergic to the boatyard dog. Meet at the beach, not the studio.",
  "Came in through the wedding fair. Loved the fog prints.",
  "Wants a winter session for the whole family, including two grandparents.",
  "Referred by a past couple. Mention the referral credit.",
  "Ordered a 24 × 36 of Strait in Fog for the office lobby.",
  "Rescheduled once for a ferry cancellation — no fee, obviously.",
  "Interested in the golden-hour workshop next spring.",
];

const TASKS = [
  { title: "Send the wedding questionnaire", priority: "normal" },
  { title: "Follow up on the unsigned agreement", priority: "high" },
  { title: "Book a venue walk-through", priority: "normal" },
  { title: "Deliver the preview gallery", priority: "high" },
  { title: "Order the album proofs", priority: "normal" },
  { title: "Chase the overdue balance", priority: "urgent" },
  { title: "Ask for a review after delivery", priority: "low" },
  { title: "Confirm the ferry booking for the mainland wedding", priority: "normal" },
] as const;

export const seedCrm: AreaSeeder = async (tx, w) => {
  const { r } = w;
  const staff = w.staffUserId;
  const author = w.ownerUserId ?? staff;

  const orgRows = await tx
    .insert(organizations)
    .values(
      ORGANISATIONS.map((org, index) => ({
        name: org.name,
        domain: org.domain,
        createdAt: w.daysAgo(170 - index * 20),
      })),
    )
    .returning({ id: organizations.id });

  // First contact at a believable time of day, not all at the seed's minute.
  const firstSeen = new Map(
    w.people.map((person) => [
      person.key,
      new Date(w.daysAgo(person.firstSeenDaysAgo).getTime() - r.int(0, 11 * 60) * 60_000),
    ]),
  );
  const rows = await tx
    .insert(contacts)
    .values(
      w.people.map((person) => ({
        name: person.name,
        email: person.email,
        phone: person.phone,
        orgId: person.org === null ? null : orgRows[person.org]!.id,
        source: person.source,
        tags: person.tags,
        lifecycleStage: person.lifecycle,
        preferredLocale: person.locale,
        timezone: person.region === "QC" ? "America/Toronto" : "America/Vancouver",
        country: "CA",
        customFields: { city: person.city },
        createdAt: firstSeen.get(person.key)!,
        updatedAt: w.daysAgo(Math.max(0, person.firstSeenDaysAgo - 3)),
      })),
    )
    .returning({ id: contacts.id, email: contacts.email });
  const byEmail = new Map(rows.map((row) => [row.email, row.id]));
  for (const person of w.people) w.contactIds.set(person.key, byEmail.get(person.email)!);

  // Where every timeline starts: the moment the studio first heard of them.
  const timeline = w.people.map((person) => ({
    contactId: w.contactIds.get(person.key)!,
    actor: person.source === "manual" || person.source === "import" ? `user:${author}` : "system",
    eventType: "contact.created",
    subjectType: "contact",
    subjectId: w.contactIds.get(person.key)!,
    payload: { source: person.source },
    occurredAt: firstSeen.get(person.key)!,
  }));

  // Notes on about a third of people, a few pinned, written after they arrived.
  const noteRows = w.people
    .filter(() => r.chance(0.33))
    .map((person) => {
      const id = w.contactIds.get(person.key)!;
      const writtenDaysAgo = r.int(0, person.firstSeenDaysAgo);
      const pinned = r.chance(0.12);
      const at = w.daysAgo(writtenDaysAgo);
      return {
        subjectType: "contact" as const,
        subjectId: id,
        contactId: id,
        authorUserId: r.chance(0.6) ? author : staff,
        body: r.pick(NOTE_BODIES),
        visibility: "team" as const,
        pinned,
        pinnedAt: pinned ? at : null,
        createdAt: at,
        updatedAt: at,
      };
    });
  const insertedNotes = noteRows.length
    ? await tx.insert(notes).values(noteRows).returning({ id: notes.id, contactId: notes.contactId, createdAt: notes.createdAt })
    : [];
  for (const note of insertedNotes) {
    timeline.push({
      contactId: note.contactId!,
      actor: `user:${author}`,
      eventType: "note.written",
      subjectType: "contact",
      subjectId: note.contactId!,
      payload: { noteId: note.id, visibility: "team" } as never,
      occurredAt: note.createdAt,
    });
  }

  // Tasks: a working list with some overdue, some due soon, most done.
  const taskRows = w.people
    .filter((person) => person.lifecycle !== "lead" && r.chance(0.3))
    .map((person) => {
      const id = w.contactIds.get(person.key)!;
      const template = r.pick(TASKS);
      const createdDaysAgo = r.int(0, Math.min(person.firstSeenDaysAgo, 120));
      const dueAt = new Date(w.now.getTime() + (r.int(-20, 21) - 0.5) * DAY);
      const status =
        dueAt < w.now
          ? r.pick(["done", "done", "done", "open", "cancelled"] as const)
          : r.pick(["open", "open", "doing", "done"] as const);
      const createdAt = w.daysAgo(createdDaysAgo);
      const done = status === "done";
      const completedAt = done
        ? new Date(Math.min(w.now.getTime(), Math.max(createdAt.getTime(), dueAt.getTime() - DAY)))
        : null;
      return {
        subjectType: "contact" as const,
        subjectId: id,
        contactId: id,
        title: template.title,
        dueAt: dueAt < createdAt ? new Date(createdAt.getTime() + 2 * DAY) : dueAt,
        assigneeUserId: r.chance(0.5) ? staff : author,
        priority: template.priority,
        status,
        completedAt,
        completedBy: done ? staff : null,
        createdBy: author,
        createdAt,
        updatedAt: completedAt ?? createdAt,
      };
    });
  if (taskRows.length) await tx.insert(tasks).values(taskRows);

  // Three look-alikes for the duplicates screen: the same person enquiring
  // from a work address. Distinct emails, as the spine requires; the match
  // is on name (and phone, where they gave one), which is what the scanner
  // scores.
  const twins = w.people.filter((person) => person.phone).slice(0, 3);
  const twinRows = await tx
    .insert(contacts)
    .values(
      twins.map((person) => ({
        name: person.name,
        email: person.email.replace("@example.com", ".work@example.com"),
        phone: person.phone,
        source: "contact",
        lifecycleStage: "lead" as const,
        preferredLocale: person.locale,
        country: "CA",
        createdAt: w.daysAgo(r.int(1, 10)),
      })),
    )
    .returning({ id: contacts.id, name: contacts.name, email: contacts.email, createdAt: contacts.createdAt });
  await tx.insert(mergeCandidates).values(
    twins.map((person, index) => ({
      contactAId: w.contactIds.get(person.key)!,
      contactBId: twinRows[index]!.id,
      contactAName: person.name,
      contactAEmail: person.email,
      contactBName: twinRows[index]!.name,
      contactBEmail: twinRows[index]!.email,
      score: 110,
      reasons: [
        { code: "same_phone", points: 60, value: person.phone!.replace(/\D/g, "").slice(-4) },
        { code: "same_name", points: 45 },
        { code: "same_country", points: 5 },
      ],
      detectedAt: twinRows[index]!.createdAt,
    })),
  );
  for (const twin of twinRows) {
    timeline.push({
      contactId: twin.id,
      actor: "system",
      eventType: "contact.created",
      subjectType: "contact",
      subjectId: twin.id,
      payload: { source: "contact" },
      occurredAt: twin.createdAt,
    });
  }

  for (let i = 0; i < timeline.length; i += 1000) {
    await tx.insert(timelineEvents).values(timeline.slice(i, i + 1000));
  }

  return {
    organizations: orgRows.length,
    contacts: rows.length,
    lookAlikes: twinRows.length,
    notes: insertedNotes.length,
    tasks: taskRows.length,
    timeline: timeline.length,
  };
};
