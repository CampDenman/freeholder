// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// The work, not just the record (MASTER.md §4.14, C7.02).
//
// §4.14 opens with the reason this file exists: "A CRM that only stores
// contacts is an address book with extra steps. What makes one worth opening
// every morning is that it holds the *work*: what is owed, to whom, by when,
// and what happened last."
//
// Four rules are held here rather than in a screen.
//
// **One list.** A task is a task whether it hangs off an invoice, a project or
// nothing at all, so there is one table and one service, and they live in core
// so that no module has to depend on another module to have a to-do list. A
// platform with a project checklist over here and a follow-up list over there
// has two answers to "what am I meant to be doing today", which is one more
// than useful.
//
// **The subject is resolved, never trusted.** Creating a task against a
// subject looks it up, refuses if it is not there, and takes the contact from
// it. That is what makes a task about an *invoice* show on the customer's
// timeline without the timeline knowing what an invoice is.
//
// **Completion is the only thing that advances a recurrence.** A weekly chore
// produces its next occurrence when this one is ticked, never on a clock — so
// an instance that was off for a fortnight comes back to one bin night, not
// fourteen. Same rule as C6.17, same reason, and now the same arithmetic.
//
// **A reminder fires once.** `reminded_at` is stamped in the same statement
// that selects the task, so a sweep that runs twice, or two workers that run
// at once, cannot send the same nudge twice.
import { z } from "zod";
import { and, asc, desc, eq, inArray, isNotNull, isNull, lte, or, sql } from "drizzle-orm";
import { listed, row, timestamp, uuid } from "@/core/contract";
import { contacts } from "@/core/contacts/schema";
import { users } from "@/core/auth/schema";
import { db } from "@/core/db";
import { CADENCES, nextAfter } from "@/core/dates/cadence";
import { registerContactReference } from "@/core/contacts/service";
import { registerContactPrivacySource } from "@/core/privacy/service";
import { briefingContribution } from "@/core/briefing/registry";
import {
  defineService,
  getService,
  ServiceError,
  type Actor,
  type Tx,
} from "@/core/service";
import {
  TASK_PRIORITIES,
  TASK_STATUSES,
  TASK_SUBJECTS,
  tasks,
} from "./schema";

// Re-exported so screens and server actions can render the choices without
// importing a schema file: outside core, the service layer is the only door
// (§15.5), and that applies to a table's vocabulary as much as its rows.
export { TASK_PRIORITIES, TASK_STATUSES, TASK_SUBJECTS } from "./schema";
export { CADENCES } from "@/core/dates/cadence";

const id = z.string().uuid();

type TaskSubject = (typeof TASK_SUBJECTS)[number];

function requirePerson(actor: Actor): void {
  // System passes, as everywhere else in this module: an accepted quote
  // raising "prepare the deposit invoice" is elevation from a caller that has
  // already established authority (C6.09, C6.13).
  if (actor.kind !== "user" && actor.kind !== "system") {
    throw new ServiceError("permission", "Sign in to manage tasks.");
  }
}

/**
 * Where each subject lives, and where a person goes to look at it.
 *
 * A literal map over a closed list rather than an import of every module: the
 * CRM should not have to depend on invoicing to hold a task about an invoice,
 * and a module that is switched off should make its tasks unresolvable rather
 * than make the whole table unreadable. The table names are constants in this
 * file and the keys come from `TASK_SUBJECTS`, so nothing user-supplied ever
 * reaches the query.
 */
const SUBJECTS: Record<TaskSubject, { table: string; href: (id: string) => string }> = {
  contact: { table: "contacts", href: (id) => `/admin/contacts/${id}` },
  deal: { table: "deals", href: () => "/admin/pipeline" },
  quote: { table: "quotes", href: (id) => `/admin/quotes/${id}` },
  invoice: { table: "invoices", href: (id) => `/admin/invoices/${id}` },
  booking: { table: "bookings", href: (id) => `/admin/appointments/${id}` },
  project: { table: "projects", href: (id) => `/admin/projects/${id}` },
  contract: { table: "contract_documents", href: (id) => `/admin/agreements/${id}` },
  order: { table: "orders", href: (id) => `/admin/orders/${id}` },
};

/**
 * The contact a subject is about, or null.
 *
 * `contacts` answers with itself; everything else carries a `contact_id`. A
 * missing table means the module is switched off, and a task against a subject
 * nobody can load is refused rather than stored — a to-do pointing at nothing
 * is a row that can never be rendered and never be closed with confidence.
 */
async function subjectContact(
  tx: Tx,
  subjectType: TaskSubject,
  subjectId: string,
): Promise<string | null> {
  const { table } = SUBJECTS[subjectType];
  const column = subjectType === "contact" ? "id" : "contact_id";
  try {
    const rows = (await tx.execute(
      sql`select ${sql.raw(column)} as contact_id from ${sql.raw(table)} where id = ${subjectId} limit 1`,
    )) as unknown as Array<{ contact_id: string | null }>;
    if (rows.length === 0) throw new ServiceError("not_found", "That is not here to attach to.");
    return rows[0]!.contact_id ?? null;
  } catch (error) {
    if (error instanceof ServiceError) throw error;
    // The module that owns this subject is not installed. Say so plainly
    // rather than storing a task nothing can open.
    throw new ServiceError("validation", "That part of the system is switched off.");
  }
}

const taskRow = row({
  id: uuid,
  subjectType: z.enum(TASK_SUBJECTS).nullable(),
  subjectId: uuid.nullable(),
  contactId: uuid.nullable(),
  title: z.string(),
  details: z.string().nullable(),
  dueAt: timestamp.nullable(),
  remindAt: timestamp.nullable(),
  remindedAt: timestamp.nullable(),
  assigneeUserId: uuid.nullable(),
  priority: z.enum(TASK_PRIORITIES),
  status: z.enum(TASK_STATUSES),
  position: z.number().int(),
  cadence: z.enum(CADENCES).nullable(),
  intervalCount: z.number().int(),
  recurredFromId: uuid.nullable(),
  completedAt: timestamp.nullable(),
  completedBy: uuid.nullable(),
});

const subjectInput = z
  .object({
    subjectType: z.enum(TASK_SUBJECTS).nullish(),
    subjectId: id.nullish(),
  })
  .refine(
    (value) => Boolean(value.subjectType) === Boolean(value.subjectId),
    "Say what the task is about, or nothing at all.",
  );

export const createTask = defineService({
  name: "tasks.create",
  summary: "Add something that has to happen, about anything or nothing.",
  kind: "mutation",
  permission: "scoped",
  writeClass: "write",
  input: subjectInput.and(
    z.object({
      title: z.string().trim().min(1).max(300),
      details: z.string().trim().max(4_000).nullish(),
      dueAt: z.iso.datetime().nullish(),
      remindAt: z.iso.datetime().nullish(),
      assigneeUserId: id.nullish(),
      priority: z.enum(TASK_PRIORITIES).default("normal"),
      cadence: z.enum(CADENCES).nullish(),
      intervalCount: z.number().int().min(1).max(52).default(1),
    }),
  ),
  output: taskRow,
  handler: async (input, ctx) => {
    requirePerson(ctx.actor);
    const subjectType = input.subjectType ?? null;
    const subjectId = input.subjectId ?? null;
    const contactId =
      subjectType && subjectId ? await subjectContact(ctx.tx, subjectType, subjectId) : null;

    const dueAt = input.dueAt ? new Date(input.dueAt) : null;
    if (input.cadence && !dueAt) {
      // The recurrence has nothing to advance from, and a repeating task with
      // no date would silently never repeat.
      throw new ServiceError("validation", "A repeating task needs a date to repeat from.");
    }

    // Appended to whatever the subject already has, so a list somebody
    // ordered stays ordered.
    const [last] = subjectId
      ? await ctx.tx
          .select({ position: tasks.position })
          .from(tasks)
          .where(and(eq(tasks.subjectType, subjectType!), eq(tasks.subjectId, subjectId)))
          .orderBy(desc(tasks.position))
          .limit(1)
      : [];

    const [created] = await ctx.tx
      .insert(tasks)
      .values({
        subjectType,
        subjectId,
        contactId,
        title: input.title,
        details: input.details ?? null,
        dueAt,
        remindAt: input.remindAt ? new Date(input.remindAt) : null,
        assigneeUserId: input.assigneeUserId ?? null,
        priority: input.priority,
        position: (last?.position ?? -1) + 1,
        cadence: input.cadence ?? null,
        intervalCount: input.intervalCount,
        createdBy: ctx.actor.kind === "user" ? ctx.actor.userId : null,
      })
      .returning();
    ctx.setSubject("task", created!.id);
    ctx.queueEvent("task.created", { id: created!.id, contactId });
    return created!;
  },
});

export const updateTask = defineService({
  name: "tasks.update",
  summary: "Change a task: what it says, when it is owed, who has it.",
  kind: "mutation",
  permission: "scoped",
  writeClass: "write",
  input: z.object({
    id,
    title: z.string().trim().min(1).max(300).optional(),
    details: z.string().trim().max(4_000).nullish(),
    dueAt: z.iso.datetime().nullish(),
    remindAt: z.iso.datetime().nullish(),
    assigneeUserId: id.nullish(),
    priority: z.enum(TASK_PRIORITIES).optional(),
    position: z.number().int().min(0).max(10_000).optional(),
    cadence: z.enum(CADENCES).nullish(),
    intervalCount: z.number().int().min(1).max(52).optional(),
  }),
  output: taskRow,
  handler: async (input, ctx) => {
    requirePerson(ctx.actor);
    const [existing] = await ctx.tx
      .select()
      .from(tasks)
      .where(eq(tasks.id, input.id))
      .limit(1);
    if (!existing) throw new ServiceError("not_found", "That task is not here.");

    const dueAt =
      input.dueAt === undefined ? existing.dueAt : input.dueAt ? new Date(input.dueAt) : null;
    const cadence = input.cadence === undefined ? existing.cadence : (input.cadence ?? null);
    if (cadence && !dueAt) {
      throw new ServiceError("validation", "A repeating task needs a date to repeat from.");
    }

    const [updated] = await ctx.tx
      .update(tasks)
      .set({
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.details !== undefined ? { details: input.details ?? null } : {}),
        ...(input.dueAt !== undefined ? { dueAt } : {}),
        ...(input.remindAt !== undefined
          ? {
              remindAt: input.remindAt ? new Date(input.remindAt) : null,
              // A moved reminder is a new reminder. Without this, changing the
              // date on something already nudged would silently never nudge
              // again.
              remindedAt: null,
            }
          : {}),
        ...(input.assigneeUserId !== undefined
          ? { assigneeUserId: input.assigneeUserId ?? null }
          : {}),
        ...(input.priority !== undefined ? { priority: input.priority } : {}),
        ...(input.position !== undefined ? { position: input.position } : {}),
        ...(input.cadence !== undefined ? { cadence } : {}),
        ...(input.intervalCount !== undefined ? { intervalCount: input.intervalCount } : {}),
        updatedAt: sql`now()`,
      })
      .where(eq(tasks.id, input.id))
      .returning();
    ctx.setSubject("task", updated!.id);
    return updated!;
  },
});

/**
 * Move a task along, and produce the next occurrence when it is finished.
 *
 * The recurrence advances from the *due date*, not from now: a bin that goes
 * out every Tuesday goes out next Tuesday whether it was taken out on time or
 * on Thursday. `nextAfter` then skips whatever is already past, so a chore
 * ticked off three weeks late comes back once rather than three times.
 */
export const setTaskStatus = defineService({
  name: "tasks.setStatus",
  summary: "Tick a task off, park it, or put it back.",
  kind: "mutation",
  permission: "scoped",
  writeClass: "write",
  input: z.object({
    id,
    status: z.enum(TASK_STATUSES),
  }),
  output: row({ task: taskRow, next: taskRow.nullable() }),
  handler: async (input, ctx) => {
    requirePerson(ctx.actor);
    const [existing] = await ctx.tx
      .select()
      .from(tasks)
      .where(eq(tasks.id, input.id))
      .limit(1);
    if (!existing) throw new ServiceError("not_found", "That task is not here.");

    const finishing = input.status === "done";
    const [updated] = await ctx.tx
      .update(tasks)
      .set({
        status: input.status,
        // Stamped on the way in and cleared on the way out, so "done at" is
        // the moment it was actually ticked rather than the first time it ever
        // was.
        completedAt: finishing ? new Date() : null,
        completedBy:
          finishing && ctx.actor.kind === "user" ? ctx.actor.userId : null,
        updatedAt: sql`now()`,
      })
      .where(eq(tasks.id, input.id))
      .returning();

    let next: typeof updated | null = null;
    // Only completion recurs. A cancelled chore is a chore somebody decided
    // not to do, and handing them the same one again next week would be the
    // opposite of what they said.
    if (finishing && existing.cadence && existing.dueAt) {
      const dueAt = nextAfter(existing.dueAt, new Date(), existing.cadence, existing.intervalCount);
      // The reminder keeps its distance from the due date rather than its
      // absolute time, so "the day before" stays the day before.
      const offset =
        existing.remindAt && existing.dueAt
          ? existing.dueAt.getTime() - existing.remindAt.getTime()
          : null;
      [next] = await ctx.tx
        .insert(tasks)
        .values({
          subjectType: existing.subjectType,
          subjectId: existing.subjectId,
          contactId: existing.contactId,
          title: existing.title,
          details: existing.details,
          dueAt,
          remindAt: offset === null ? null : new Date(dueAt.getTime() - offset),
          assigneeUserId: existing.assigneeUserId,
          priority: existing.priority,
          position: existing.position,
          cadence: existing.cadence,
          intervalCount: existing.intervalCount,
          recurredFromId: existing.id,
          createdBy: existing.createdBy,
        })
        .returning();
    }

    ctx.setSubject("task", updated!.id);
    if (finishing) {
      ctx.queueEvent("task.completed", { id: updated!.id, nextId: next?.id ?? null });
    }
    return { task: updated!, next: next ?? null };
  },
});

export const removeTask = defineService({
  name: "tasks.remove",
  summary: "Take a task off the list for good.",
  kind: "mutation",
  permission: "scoped",
  writeClass: "destructive",
  input: z.object({ id }),
  output: row({ id: uuid }),
  handler: async (input, ctx) => {
    requirePerson(ctx.actor);
    const [removed] = await ctx.tx
      .delete(tasks)
      .where(eq(tasks.id, input.id))
      .returning({ id: tasks.id });
    if (!removed) throw new ServiceError("not_found", "That task is not here.");
    ctx.setSubject("task", removed.id);
    return removed;
  },
});

export const listTasks = defineService({
  name: "tasks.list",
  summary: "The work list: what is open, for whom, about what, by when.",
  kind: "query",
  permission: "scoped",
  input: z.object({
    status: z.enum(TASK_STATUSES).optional(),
    /** Everything not finished, which is what a work list actually means. */
    openOnly: z.boolean().default(false),
    assigneeUserId: id.optional(),
    unassigned: z.boolean().default(false),
    subjectType: z.enum(TASK_SUBJECTS).optional(),
    subjectId: id.optional(),
    contactId: id.optional(),
    /** Only what is already late, for the top of the list. */
    overdue: z.boolean().default(false),
    /** Only what is due on or before this moment, for "today". */
    dueBefore: z.iso.datetime().optional(),
    limit: z.number().int().min(1).max(200).default(100),
  }),
  output: listed(
    taskRow.extend({
      contactName: z.string().nullable(),
      assigneeEmail: z.string().nullable(),
      href: z.string().nullable(),
    }),
  ),
  handler: async (input, ctx) => {
    const where = [
      ...(input.status ? [eq(tasks.status, input.status)] : []),
      ...(input.openOnly ? [inArray(tasks.status, ["open", "doing", "blocked"])] : []),
      ...(input.assigneeUserId ? [eq(tasks.assigneeUserId, input.assigneeUserId)] : []),
      ...(input.unassigned ? [isNull(tasks.assigneeUserId)] : []),
      ...(input.subjectType ? [eq(tasks.subjectType, input.subjectType)] : []),
      ...(input.subjectId ? [eq(tasks.subjectId, input.subjectId)] : []),
      ...(input.contactId ? [eq(tasks.contactId, input.contactId)] : []),
      ...(input.overdue ? [isNotNull(tasks.dueAt), lte(tasks.dueAt, sql`now()`)] : []),
      ...(input.dueBefore ? [lte(tasks.dueAt, new Date(input.dueBefore))] : []),
    ];
    const rows = await ctx.tx
      .select({ task: tasks, contactName: contacts.name, assigneeEmail: users.email })
      .from(tasks)
      .leftJoin(contacts, eq(contacts.id, tasks.contactId))
      .leftJoin(users, eq(users.id, tasks.assigneeUserId))
      .where(where.length ? and(...where) : undefined)
      // Dated work first and soonest first; undated last, because a list that
      // buries Friday's deadline under "sometime" is not a work list. Postgres
      // sorts nulls last on ASC by default, which is exactly this.
      .orderBy(asc(tasks.dueAt), desc(tasks.priority), asc(tasks.position))
      .limit(input.limit);

    return rows.map(({ task, contactName, assigneeEmail }) => ({
      ...task,
      contactName,
      assigneeEmail,
      href:
        task.subjectType && task.subjectId
          ? SUBJECTS[task.subjectType].href(task.subjectId)
          : null,
    }));
  },
});

/**
 * What is on somebody's plate this morning (§42, C7.02).
 *
 * Only what is late or due today, and only theirs or nobody's. A briefing
 * section that lists everything open is a section people learn to skim, which
 * §42 says is worse than no section at all.
 */
export const briefingTasks = defineService({
  name: "briefing.tasks",
  summary: "Tasks that are due today or already late.",
  kind: "query",
  permission: "public",
  mcpExclude: true,
  agentCallable: false,
  input: z.object({
    userId: z.uuid(),
    onDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    timezone: z.string().min(1).max(80),
  }),
  output: briefingContribution,
  handler: async (input, ctx) => {
    // End of the business's day, in the business's timezone, so "today" means
    // the same thing to everyone (§4.9).
    const { zonedInstant } = await import("@/core/i18n/zoned");
    const [year, month, day] = input.onDate.split("-").map(Number);
    const endOfDay = zonedInstant(input.timezone, {
      year: year!,
      month: month!,
      day: day!,
      hour: 23,
      minute: 59,
    });
    const rows = await ctx.tx
      .select({ task: tasks, contactName: contacts.name })
      .from(tasks)
      .leftJoin(contacts, eq(contacts.id, tasks.contactId))
      .where(
        and(
          inArray(tasks.status, ["open", "doing", "blocked"]),
          isNotNull(tasks.dueAt),
          lte(tasks.dueAt, endOfDay),
          // Theirs, or nobody's: an unclaimed task is everybody's problem, and
          // a task assigned to a colleague is not this person's morning.
          or(eq(tasks.assigneeUserId, input.userId), isNull(tasks.assigneeUserId)),
        ),
      )
      .orderBy(asc(tasks.dueAt))
      .limit(15);
    if (rows.length === 0) return null;

    const late = rows.filter((r) => r.task.dueAt! < new Date()).length;
    return {
      title: "Your tasks",
      // Late work needs the person; work due later today is just today.
      severity: late > 0 ? ("attention" as const) : ("today" as const),
      items: rows.map(({ task, contactName }) => ({
        label: task.title,
        href: "/admin/tasks",
        detail: [
          task.dueAt! < new Date() ? "Late" : "Today",
          contactName,
          task.priority === "urgent" ? "Urgent" : null,
        ]
          .filter(Boolean)
          .join(" · "),
      })),
    };
  },
});

/**
 * Send the reminders that have come due (C7.02).
 *
 * The claim is stamped in the `update … returning` that finds the work, so two
 * workers racing each other cannot both take the same task, and a sweep that
 * runs twice sends nothing twice. Unassigned tasks are skipped rather than
 * broadcast: there is nobody to tell, and the briefing already carries them.
 */
export async function sendTaskReminders(): Promise<{ sent: number; skipped: number }> {
  const claimed = await db()
    .update(tasks)
    .set({ remindedAt: new Date() })
    .where(
      and(
        inArray(tasks.status, ["open", "doing", "blocked"]),
        isNotNull(tasks.remindAt),
        lte(tasks.remindAt, sql`now()`),
        isNull(tasks.remindedAt),
      ),
    )
    .returning({
      id: tasks.id,
      title: tasks.title,
      dueAt: tasks.dueAt,
      priority: tasks.priority,
      assigneeUserId: tasks.assigneeUserId,
    });

  let sent = 0;
  let skipped = 0;
  for (const task of claimed) {
    if (!task.assigneeUserId) {
      skipped += 1;
      continue;
    }
    await getService("notifications.create").call(
      {
        recipient: { kind: "user", id: task.assigneeUserId },
        topic: "task.reminder",
        priority: task.priority === "urgent" ? "warning" : "information",
        title: task.title,
        body: task.dueAt
          ? `Due ${task.dueAt.toISOString().slice(0, 10)}.`
          : "You asked to be reminded about this.",
        href: "/admin/tasks",
        idempotencyKey: `task-reminder:${task.id}`,
      },
      { kind: "system" },
    );
    sent += 1;
  }
  return { sent, skipped };
}

/**
 * Merge keeps every task and repoints it (§4.1).
 *
 * A task is work the business owes somebody. Dropping the duplicate's tasks
 * would quietly delete commitments at the exact moment two records became
 * one — which is the failure the merge list exists to prevent.
 */
registerContactReference({
  table: "tasks",
  repoint: (tx, duplicateId, survivingId) =>
    tx.update(tasks).set({ contactId: survivingId }).where(eq(tasks.contactId, duplicateId)),
  captureForUndo: async (tx, duplicateId, survivingId) => ({
    state: await tx
      .select({ id: tasks.id, contactId: tasks.contactId })
      .from(tasks)
      .where(inArray(tasks.contactId, [duplicateId, survivingId])),
    undoable: true,
  }),
  restoreAfterUndo: async (tx, beforeState, _afterState, duplicateId) => {
    const moved = z
      .array(z.object({ id: z.string().uuid(), contactId: z.string().uuid().nullable() }))
      .parse(beforeState)
      .filter((task) => task.contactId === duplicateId);
    if (moved.length) {
      await tx
        .update(tasks)
        .set({ contactId: duplicateId })
        .where(inArray(tasks.id, moved.map((task) => task.id)));
    }
  },
});

/**
 * What a task means for the person's own data (§30).
 *
 * The commitment stays and the person goes. "Chase the deposit" is the
 * business's own note to itself about work it had to do, and erasing the row
 * would take a record of what the business did with the record of who it was
 * about. The title and details go, because those are what somebody wrote about
 * them, and the link is cut.
 */
registerContactPrivacySource({
  scope: "contact.tasks",
  tables: ["tasks"],
  exportData: async (tx, contactId) =>
    tx.select().from(tasks).where(eq(tasks.contactId, contactId)).orderBy(asc(tasks.createdAt)),
  erase: async (tx, contactId) => {
    const rows = await tx
      .update(tasks)
      .set({ title: "A task", details: null, contactId: null, updatedAt: sql`now()` })
      .where(eq(tasks.contactId, contactId))
      .returning({ id: tasks.id });
    return { affected: rows.length };
  },
});

export default [createTask, updateTask, setTaskStatus, removeTask, listTasks, briefingTasks];
