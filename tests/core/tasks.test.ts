// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// The one work list (C7.02, MASTER.md §4.14).
//
// §4.14: "Tasks are attachable to anything — a contact, a deal, an invoice, a
// booking, a project — because 'chase the deposit' is about the invoice and
// 'confirm the venue' is about the booking, and a task list that only knows
// contacts forces both into the wrong shape."
//
// Four claims, and every test below is one of them:
//
//   1. **A task attaches to anything, or to nothing**, and the subject is
//      resolved rather than trusted — which is what puts a task about an
//      *invoice* on the customer's timeline.
//   2. **There is one list.** C6.15's project checklist writes into this table
//      through the same service, so "what am I meant to be doing today" has
//      one answer.
//   3. **A recurrence advances on completion, never on a clock**, so a
//      fortnight away leaves one chore waiting rather than fourteen.
//   4. **A reminder fires once**, claimed in the statement that finds it.
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { users } from "@/core/auth/schema";
import { tasks } from "@/core/tasks/schema";
import { db } from "@/core/db";
import { ready } from "@/core/runtime";
import { getService } from "@/core/service";
import { advance, nextAfter } from "@/core/dates/cadence";
import {
  createTask,
  listTasks,
  removeTask,
  sendTaskReminders,
  setTaskStatus,
  updateTask,
} from "@/core/tasks/service";
import { closeDb, failure, hasDatabase, OWNER, truncateSpine } from "../helpers/spine";

describe("when a chore comes round again", () => {
  it("counts days and weeks as spans and months as calendar dates", () => {
    const from = new Date("2026-03-15T09:00:00.000Z");
    expect(advance(from, "daily", 3).toISOString()).toBe("2026-03-18T09:00:00.000Z");
    expect(advance(from, "weekly", 2).toISOString()).toBe("2026-03-29T09:00:00.000Z");
    expect(advance(from, "monthly", 1).toISOString()).toBe("2026-04-15T09:00:00.000Z");
  });

  // The rule the whole recurrence design rests on: a fortnight away leaves one
  // bin night, not fourteen.
  it("resumes after a gap rather than replaying it", () => {
    const due = new Date("2026-01-06T09:00:00.000Z");
    const now = new Date("2026-02-17T09:00:00.000Z");
    expect(nextAfter(due, now, "weekly", 1).toISOString()).toBe("2026-02-24T09:00:00.000Z");
  });
});

describe.runIf(hasDatabase)("tasks", { timeout: 90_000 }, () => {
  beforeEach(async () => {
    await ready();
    await truncateSpine();
    await db()
      .insert(users)
      .values({ id: OWNER.userId, email: "owner@example.test", role: "owner" })
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

  it("takes a task about nothing at all", async () => {
    // "Ring the accountant" is a real task, and forcing it to hang off a
    // contact record would invent a relationship that does not exist.
    const created = await createTask.call({ title: "Ring the accountant" }, OWNER);
    expect(created).toMatchObject({
      subjectType: null,
      subjectId: null,
      contactId: null,
      status: "open",
      priority: "normal",
    });
  });

  it("refuses half a subject", async () => {
    const refused = await failure(
      createTask.call(
        { title: "About what?", subjectType: "invoice", subjectId: null },
        OWNER,
      ),
    );
    expect(refused.message).toContain("about");
  });

  it("refuses a subject that is not there", async () => {
    const refused = await failure(
      createTask.call(
        {
          title: "Chase the deposit",
          subjectType: "contact",
          subjectId: "00000000-0000-4000-8000-0000000000ff",
        },
        OWNER,
      ),
    );
    expect(refused.message).toContain("not here");
  });

  // The reason `contact_id` is denormalised: a task about somebody's *invoice*
  // is still a thing that happened with that person.
  it("takes the contact from whatever the task is about", async () => {
    const person = await contactId();
    const created = await createTask.call(
      { title: "Say hello", subjectType: "contact", subjectId: person },
      OWNER,
    );
    expect(created.contactId).toBe(person);

    const [listedTask] = await listTasks.call({ contactId: person }, OWNER);
    expect(listedTask).toMatchObject({ contactName: "Rae Lane" });
    // And the list says where to go and look at it.
    expect(listedTask!.href).toBe(`/admin/contacts/${person}`);
  });

  it("refuses a repeating task with no date to repeat from", async () => {
    const refused = await failure(
      createTask.call({ title: "Empty the bins", cadence: "weekly" }, OWNER),
    );
    expect(refused.message).toContain("date");
  });

  it("makes the next one when this one is ticked off", async () => {
    const created = await createTask.call(
      {
        title: "Empty the bins",
        dueAt: "2026-03-03T09:00:00.000Z",
        remindAt: "2026-03-02T09:00:00.000Z",
        cadence: "weekly",
      },
      OWNER,
    );
    const { task, next } = await setTaskStatus.call({ id: created.id, status: "done" }, OWNER);
    expect(task.status).toBe("done");
    expect(task.completedAt).toBeTruthy();
    expect(next).toBeTruthy();
    // Next after *now*, not one step from a date years in the past.
    expect(new Date(next!.dueAt!).getTime()).toBeGreaterThan(Date.now());
    // And the reminder keeps its distance rather than its absolute time.
    const gap = new Date(next!.dueAt!).getTime() - new Date(next!.remindAt!).getTime();
    expect(gap).toBe(86_400_000);
    expect(next!.recurredFromId).toBe(created.id);
  });

  // Cancelling is not completing. Handing somebody the same chore again next
  // week is the opposite of what they said.
  it("does not bring back a chore that was dropped", async () => {
    const created = await createTask.call(
      { title: "Empty the bins", dueAt: "2026-03-03T09:00:00.000Z", cadence: "weekly" },
      OWNER,
    );
    const { next } = await setTaskStatus.call({ id: created.id, status: "cancelled" }, OWNER);
    expect(next).toBeNull();
    expect(await db().select().from(tasks)).toHaveLength(1);
  });

  it("makes only one next occurrence however late it was ticked", async () => {
    const created = await createTask.call(
      { title: "Water the plants", dueAt: "2026-01-05T09:00:00.000Z", cadence: "weekly" },
      OWNER,
    );
    await setTaskStatus.call({ id: created.id, status: "done" }, OWNER);
    expect(await db().select().from(tasks)).toHaveLength(2);
  });

  it("clears the done stamp when a task is put back", async () => {
    const created = await createTask.call({ title: "Call back" }, OWNER);
    await setTaskStatus.call({ id: created.id, status: "done" }, OWNER);
    const { task } = await setTaskStatus.call({ id: created.id, status: "open" }, OWNER);
    // Not permanently stamped with the day it was briefly finished.
    expect(task.completedAt).toBeNull();
    expect(task.completedBy).toBeNull();
  });

  it("puts late work first and undated work last", async () => {
    await createTask.call({ title: "Sometime" }, OWNER);
    await createTask.call({ title: "Next year", dueAt: "2027-01-01T09:00:00.000Z" }, OWNER);
    await createTask.call({ title: "Overdue", dueAt: "2020-01-01T09:00:00.000Z" }, OWNER);
    const rows = await listTasks.call({ openOnly: true }, OWNER);
    expect(rows.map((task) => task.title)).toEqual(["Overdue", "Next year", "Sometime"]);
  });

  it("leaves finished work out of the work list", async () => {
    const created = await createTask.call({ title: "Done thing" }, OWNER);
    await setTaskStatus.call({ id: created.id, status: "done" }, OWNER);
    expect(await listTasks.call({ openOnly: true }, OWNER)).toHaveLength(0);
    // Blocked is not finished: it is the one an owner most needs to see.
    const blocked = await createTask.call({ title: "Waiting on the surveyor" }, OWNER);
    await setTaskStatus.call({ id: blocked.id, status: "blocked" }, OWNER);
    expect(await listTasks.call({ openOnly: true }, OWNER)).toHaveLength(1);
  });

  it("finds what nobody has picked up", async () => {
    await createTask.call({ title: "Unclaimed" }, OWNER);
    await createTask.call({ title: "Claimed", assigneeUserId: OWNER.userId }, OWNER);
    const nobody = await listTasks.call({ unassigned: true }, OWNER);
    expect(nobody.map((task) => task.title)).toEqual(["Unclaimed"]);
  });

  // A moved reminder is a new reminder. Without this, changing the date on
  // something already nudged would silently never nudge again.
  it("nudges again when the reminder is moved", async () => {
    const created = await createTask.call(
      { title: "Chase it", remindAt: "2020-01-01T09:00:00.000Z" },
      OWNER,
    );
    await db().update(tasks).set({ remindedAt: new Date() }).where(eq(tasks.id, created.id));
    const moved = await updateTask.call(
      { id: created.id, remindAt: "2021-01-01T09:00:00.000Z" },
      OWNER,
    );
    expect(moved.remindedAt).toBeNull();
  });

  it("sends a reminder once and then not again", async () => {
    await createTask.call(
      {
        title: "Chase the deposit",
        remindAt: "2020-01-01T09:00:00.000Z",
        assigneeUserId: OWNER.userId,
      },
      OWNER,
    );
    expect(await sendTaskReminders()).toMatchObject({ sent: 1, skipped: 0 });
    // The claim is stamped in the statement that found it, so a second sweep —
    // or a second worker — finds nothing.
    expect(await sendTaskReminders()).toMatchObject({ sent: 0, skipped: 0 });
  });

  it("has nobody to tell about an unassigned task", async () => {
    await createTask.call(
      { title: "Somebody should", remindAt: "2020-01-01T09:00:00.000Z" },
      OWNER,
    );
    // Skipped rather than broadcast: the briefing already carries it.
    expect(await sendTaskReminders()).toMatchObject({ sent: 0, skipped: 1 });
  });

  it("says what is late or due today, and nothing else", async () => {
    await createTask.call({ title: "Late", dueAt: "2020-01-01T09:00:00.000Z" }, OWNER);
    await createTask.call({ title: "Next year", dueAt: "2027-06-01T09:00:00.000Z" }, OWNER);
    const section = (await getService("briefing.tasks").call(
      { userId: OWNER.userId, onDate: "2026-08-19", timezone: "Europe/London" },
      { kind: "system" },
    )) as { title: string; severity: string; items: { label: string }[] } | null;
    expect(section).toBeTruthy();
    expect(section!.severity).toBe("attention");
    expect(section!.items.map((item) => item.label)).toEqual(["Late"]);
  });

  it("says nothing on a morning with nothing due", async () => {
    await createTask.call({ title: "Sometime" }, OWNER);
    const section = await getService("briefing.tasks").call(
      { userId: OWNER.userId, onDate: "2026-08-19", timezone: "Europe/London" },
      { kind: "system" },
    );
    // An empty section is worse than no section: it teaches people to skim.
    expect(section).toBeNull();
  });

  it("keeps the commitment and forgets the person when somebody is erased", async () => {
    const person = await contactId();
    await createTask.call(
      { title: "Send Rae the proofs", subjectType: "contact", subjectId: person },
      OWNER,
    );
    const { contactPrivacySources } = await import("@/core/privacy/service");
    const source = contactPrivacySources().find((one) => one.scope === "contact.tasks");
    expect(source).toBeTruthy();
    await db().transaction((tx) => source!.erase(tx, person, { requestId: "t" }));

    const [after] = await db().select().from(tasks);
    // The row survives — it is the business's record of work it had to do —
    // and everything anybody wrote about the person goes.
    expect(after).toMatchObject({ title: "A task", details: null, contactId: null });
  });

  it("keeps both people's tasks when two records become one", async () => {
    const survivor = await contactId();
    const duplicate = (
      (await getService("contacts.resolve").call(
        { email: "rae.lane@example.test", name: "Rae L", source: "test" },
        { kind: "system" },
      )) as { contact: { id: string } }
    ).contact.id;
    await createTask.call(
      { title: "Survivor's", subjectType: "contact", subjectId: survivor },
      OWNER,
    );
    await createTask.call(
      { title: "Duplicate's", subjectType: "contact", subjectId: duplicate },
      OWNER,
    );
    await getService("contacts.merge").call(
      { survivingId: survivor, duplicateId: duplicate },
      OWNER,
    );
    const kept = await listTasks.call({ contactId: survivor }, OWNER);
    // Dropping the duplicate's tasks would delete commitments at the exact
    // moment two records became one.
    expect(kept.map((task) => task.title).sort()).toEqual(["Duplicate's", "Survivor's"]);
  });

  it("removes a task for good when asked", async () => {
    const created = await createTask.call({ title: "Never mind" }, OWNER);
    await removeTask.call({ id: created.id }, OWNER);
    expect(await db().select().from(tasks)).toHaveLength(0);
  });

  // The C6.15 half: a project's checklist is the same list, not a second one.
  it("writes a project checklist into the one work list", async () => {
    const { addTask, createProject, setTaskStatus: setProjectTask } = await import(
      "@/modules/projects/service"
    );
    const project = await createProject.call(
      { title: "Henderson kitchen", contactId: await contactId() },
      OWNER,
    );
    const added = await addTask.call(
      { projectId: project.id, title: "Confirm the worktop", dueOn: "2026-09-01" },
      OWNER,
    );
    expect(added).toMatchObject({ projectId: project.id, dueOn: "2026-09-01" });

    // And it is on the platform's one list, with the project's customer on it.
    const [onTheList] = await listTasks.call({ subjectType: "project" }, OWNER);
    expect(onTheList).toMatchObject({
      title: "Confirm the worktop",
      subjectId: project.id,
      contactName: "Rae Lane",
      href: `/admin/projects/${project.id}`,
    });

    await setProjectTask.call({ id: added.id, status: "done" }, OWNER);
    expect(await listTasks.call({ openOnly: true }, OWNER)).toHaveLength(0);
  });
});
