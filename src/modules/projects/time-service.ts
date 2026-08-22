// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Tracking hours, and billing them once (MASTER.md §4.13, C6.16).
//
// §4.13: a time entry is "the difference between an owner billing what they
// worked and billing what they remember."
//
// Three properties make that true rather than aspirational.
//
// **The rate is resolved at the entry and frozen.** Putting a rate up in March
// must not re-price February's work, and reading the rate at billing time
// would do exactly that — silently, and in the business's favour.
//
// **An hour is billed once.** `invoiceId` is set when an entry becomes a line
// and never cleared, the conversion refuses any entry that already has one,
// and the review list is a query rather than anybody's memory.
//
// **The timer cannot double-count.** One running entry per person, enforced by
// a partial unique index rather than by the screen — two would mean the same
// hour charged to two jobs, which is worse than losing it.
import { z } from "zod";
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { listed, row, timestamp, uuid } from "@/core/contract";
import { bookings } from "@/core/scheduling/schema";
import { registerContactReference } from "@/core/contacts/service";
import { registerContactPrivacySource } from "@/core/privacy/service";
import { isUniqueViolation } from "@/core/db";
import {
  defineService,
  getService,
  listServices,
  ServiceError,
  type ServiceContext,
} from "@/core/service";
import { projects } from "./schema";
import { RATE_SCOPES, timeEntries, timeRates } from "./time-schema";

const id = z.string().uuid();
const currency = z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/);

const entryRow = row({
  id: uuid,
  userId: uuid.nullable(),
  contactId: uuid.nullable(),
  projectId: uuid.nullable(),
  bookingId: uuid.nullable(),
  description: z.string(),
  startedAt: timestamp,
  endedAt: timestamp.nullable(),
  minutes: z.number().int(),
  billable: z.boolean(),
  rateMinor: z.number().int(),
  currency: z.string().nullable(),
  invoiceId: uuid.nullable(),
  invoicedAt: timestamp.nullable(),
});

/** Integer minutes as "1h 45m", which is how a person reads their own week. */
export function hoursAndMinutes(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `${rest}m`;
  return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`;
}

/** Minutes at an hourly rate, in integer minor units (§15.4). */
export function amountFor(minutes: number, rateMinor: number): number {
  if (minutes <= 0 || rateMinor <= 0) return 0;
  // Rounded once, at the end, from a single integer product. Dividing first
  // would put a float in the middle of a money calculation.
  return Math.round((minutes * rateMinor) / 60);
}

/**
 * What this hour costs: the project's rate, then the person's, then the
 * business's.
 *
 * Most specific wins. Three levels because the two real cases are a senior
 * charging more than a junior *and* a particular job being charged a
 * particular rate, and a business with both should not have to choose.
 */
export async function resolveRate(
  ctx: ServiceContext,
  input: { projectId?: string | null; userId?: string | null },
): Promise<{ rateMinor: number; currency: string | null }> {
  const rates = await ctx.tx.select().from(timeRates);
  const pick = (scope: string, scopeId: string | null) =>
    rates.find((rate) => rate.scope === scope && rate.scopeId === scopeId);
  const found =
    (input.projectId ? pick("project", input.projectId) : undefined) ??
    (input.userId ? pick("user", input.userId) : undefined) ??
    pick("business", null);
  // Nothing configured is not an error: plenty of work is unbillable, and a
  // zero rate is an entry the owner can price by hand.
  return { rateMinor: found?.rateMinor ?? 0, currency: found?.currency ?? null };
}

export const setTimeRate = defineService({
  name: "time.setRate",
  summary: "Say what an hour costs, for the business, a person or a job.",
  kind: "mutation",
  permission: "scoped",
  writeClass: "money",
  input: z.object({
    scope: z.enum(RATE_SCOPES),
    scopeId: id.nullish(),
    rateMinor: z.number().int().min(0),
    currency: currency.default("GBP"),
  }),
  output: row({
    id: uuid,
    scope: z.enum(RATE_SCOPES),
    scopeId: uuid.nullable(),
    rateMinor: z.number().int(),
    currency: z.string(),
  }),
  handler: async (input, ctx) => {
    if ((input.scope === "business") !== (input.scopeId == null)) {
      throw new ServiceError(
        "validation",
        input.scope === "business"
          ? "A business rate applies to everything, so it names nothing."
          : "Say which person or project this rate is for.",
      );
    }
    const values = {
      scope: input.scope,
      scopeId: input.scopeId ?? null,
      rateMinor: input.rateMinor,
      currency: input.currency,
      updatedAt: sql`now()`,
    };
    const [saved] = await ctx.tx
      .insert(timeRates)
      .values(values)
      .onConflictDoUpdate({ target: [timeRates.scope, timeRates.scopeId], set: values })
      .returning();
    ctx.setSubject("timeRate", saved!.id);
    return saved!;
  },
});

export const listTimeRates = defineService({
  name: "time.rates",
  summary: "What an hour costs, at every level it has been set.",
  kind: "query",
  permission: "scoped",
  input: z.object({}),
  output: listed(
    row({
      id: uuid,
      scope: z.enum(RATE_SCOPES),
      scopeId: uuid.nullable(),
      rateMinor: z.number().int(),
      currency: z.string(),
    }),
  ),
  handler: (_input, ctx) =>
    ctx.tx.select().from(timeRates).orderBy(asc(timeRates.scope)),
});

/** The contact a piece of work is for, whichever end it was attached to. */
async function contactFor(
  ctx: ServiceContext,
  input: { projectId?: string | null; bookingId?: string | null },
): Promise<string | null> {
  if (input.projectId) {
    const [project] = await ctx.tx
      .select({ contactId: projects.contactId })
      .from(projects)
      .where(eq(projects.id, input.projectId))
      .limit(1);
    if (project?.contactId) return project.contactId;
  }
  if (input.bookingId) {
    const [booking] = await ctx.tx
      .select({ contactId: bookings.contactId })
      .from(bookings)
      .where(eq(bookings.id, input.bookingId))
      .limit(1);
    if (booking?.contactId) return booking.contactId;
  }
  return null;
}

export const startTimer = defineService({
  name: "time.start",
  summary: "Start the clock on a piece of work.",
  kind: "mutation",
  permission: "scoped",
  agentCallable: false,
  writeClass: "write",
  input: z.object({
    description: z.string().trim().min(1).max(500),
    projectId: id.nullish(),
    bookingId: id.nullish(),
    billable: z.boolean().default(true),
  }),
  output: entryRow,
  handler: async (input, ctx) => {
    if (ctx.actor.kind !== "user") {
      throw new ServiceError("permission", "Sign in to track time.");
    }
    const rate = await resolveRate(ctx, {
      projectId: input.projectId,
      userId: ctx.actor.userId,
    });
    try {
      const [started] = await ctx.tx
        .insert(timeEntries)
        .values({
          userId: ctx.actor.userId,
          contactId: await contactFor(ctx, input),
          projectId: input.projectId ?? null,
          bookingId: input.bookingId ?? null,
          description: input.description,
          startedAt: new Date(),
          billable: input.billable,
          rateMinor: rate.rateMinor,
          currency: rate.currency,
        })
        .returning();
      ctx.setSubject("timeEntry", started!.id);
      return started!;
    } catch (error) {
      if (isUniqueViolation(error, "time_entries_one_timer_idx")) {
        // Two running timers would mean the same hour charged to two jobs,
        // which is worse than losing it.
        throw new ServiceError(
          "conflict",
          "You already have a timer running. Stop that one first.",
        );
      }
      throw error;
    }
  },
});

export const stopTimer = defineService({
  name: "time.stop",
  summary: "Stop the clock and record what it came to.",
  kind: "mutation",
  permission: "scoped",
  agentCallable: false,
  writeClass: "write",
  input: z.object({
    /** Round to the nearest, in minutes. An owner's billing habit, not a rule. */
    roundToMinutes: z.number().int().min(1).max(120).default(1),
  }),
  output: entryRow.nullable(),
  handler: async (input, ctx) => {
    if (ctx.actor.kind !== "user") {
      throw new ServiceError("permission", "Sign in to track time.");
    }
    const [running] = await ctx.tx
      .select()
      .from(timeEntries)
      .where(and(eq(timeEntries.userId, ctx.actor.userId), isNull(timeEntries.endedAt)))
      .limit(1);
    if (!running) return null;

    const endedAt = new Date();
    const elapsed = (endedAt.getTime() - running.startedAt.getTime()) / 60_000;
    // Rounded *up* to the owner's increment: a business that bills in
    // fifteens is saying a twenty-minute call costs thirty, and rounding down
    // would quietly give the work away.
    const minutes = Math.max(
      input.roundToMinutes,
      Math.ceil(elapsed / input.roundToMinutes) * input.roundToMinutes,
    );
    const [stopped] = await ctx.tx
      .update(timeEntries)
      .set({ endedAt, minutes, updatedAt: sql`now()` })
      .where(eq(timeEntries.id, running.id))
      .returning();
    ctx.setSubject("timeEntry", stopped!.id);
    return stopped!;
  },
});

export const logTime = defineService({
  name: "time.log",
  summary: "Record work that has already happened.",
  kind: "mutation",
  permission: "scoped",
  agentCallable: false,
  writeClass: "write",
  input: z.object({
    description: z.string().trim().min(1).max(500),
    minutes: z.number().int().min(1).max(24 * 60),
    startedAt: z.iso.datetime().optional(),
    projectId: id.nullish(),
    bookingId: id.nullish(),
    billable: z.boolean().default(true),
    /** Override the resolved rate for this entry alone. */
    rateMinor: z.number().int().min(0).optional(),
  }),
  output: entryRow,
  handler: async (input, ctx) => {
    if (ctx.actor.kind !== "user") {
      throw new ServiceError("permission", "Sign in to track time.");
    }
    const resolved = await resolveRate(ctx, {
      projectId: input.projectId,
      userId: ctx.actor.userId,
    });
    const startedAt = input.startedAt ? new Date(input.startedAt) : new Date();
    const [logged] = await ctx.tx
      .insert(timeEntries)
      .values({
        userId: ctx.actor.userId,
        contactId: await contactFor(ctx, input),
        projectId: input.projectId ?? null,
        bookingId: input.bookingId ?? null,
        description: input.description,
        startedAt,
        endedAt: new Date(startedAt.getTime() + input.minutes * 60_000),
        minutes: input.minutes,
        billable: input.billable,
        rateMinor: input.rateMinor ?? resolved.rateMinor,
        currency: resolved.currency,
      })
      .returning();
    ctx.setSubject("timeEntry", logged!.id);
    return logged!;
  },
});

export const updateTimeEntry = defineService({
  name: "time.update",
  summary: "Correct an entry before it is billed.",
  kind: "mutation",
  permission: "scoped",
  agentCallable: false,
  writeClass: "money",
  input: z.object({
    id,
    description: z.string().trim().min(1).max(500).optional(),
    minutes: z.number().int().min(0).max(24 * 60).optional(),
    billable: z.boolean().optional(),
    rateMinor: z.number().int().min(0).optional(),
  }),
  output: entryRow,
  handler: async (input, ctx) => {
    const [entry] = await ctx.tx
      .select()
      .from(timeEntries)
      .where(eq(timeEntries.id, input.id))
      .limit(1);
    if (!entry) throw new ServiceError("not_found", "That entry is not here.");
    if (entry.invoiceId) {
      // Editing an invoiced entry would change a line on an invoice the
      // customer may already have. The honest move is a credit note.
      throw new ServiceError(
        "conflict",
        "This has already been invoiced. Adjust it on the invoice instead.",
      );
    }
    const [updated] = await ctx.tx
      .update(timeEntries)
      .set({
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.minutes !== undefined ? { minutes: input.minutes } : {}),
        ...(input.billable !== undefined ? { billable: input.billable } : {}),
        ...(input.rateMinor !== undefined ? { rateMinor: input.rateMinor } : {}),
        updatedAt: sql`now()`,
      })
      .where(eq(timeEntries.id, input.id))
      .returning();
    ctx.setSubject("timeEntry", updated!.id);
    return updated!;
  },
});

export const removeTimeEntry = defineService({
  name: "time.remove",
  summary: "Delete an entry that should not have been recorded.",
  kind: "mutation",
  permission: "scoped",
  agentCallable: false,
  writeClass: "write",
  input: z.object({ id }),
  output: row({ id: uuid }),
  handler: async (input, ctx) => {
    const [removed] = await ctx.tx
      .delete(timeEntries)
      .where(and(eq(timeEntries.id, input.id), isNull(timeEntries.invoiceId)))
      .returning({ id: timeEntries.id });
    if (!removed) {
      throw new ServiceError(
        "conflict",
        "That entry is not here, or it has been invoiced and cannot be deleted.",
      );
    }
    return removed;
  },
});

export const listTimeEntries = defineService({
  name: "time.list",
  summary: "Hours worked, and what is still to bill.",
  kind: "query",
  permission: "scoped",
  input: z.object({
    projectId: id.optional(),
    contactId: id.optional(),
    /** The review list: billable work nobody has invoiced yet. */
    unbilledOnly: z.boolean().default(false),
    limit: z.number().int().min(1).max(500).default(200),
  }),
  output: listed(entryRow.extend({ amountMinor: z.number().int() })),
  handler: async (input, ctx) => {
    const rows = await ctx.tx
      .select()
      .from(timeEntries)
      .where(
        and(
          input.projectId ? eq(timeEntries.projectId, input.projectId) : undefined,
          input.contactId ? eq(timeEntries.contactId, input.contactId) : undefined,
          input.unbilledOnly
            ? and(eq(timeEntries.billable, true), isNull(timeEntries.invoiceId))
            : undefined,
        ),
      )
      .orderBy(desc(timeEntries.startedAt))
      .limit(input.limit);
    // Totalled per row rather than in SQL, so the arithmetic that reaches an
    // invoice and the arithmetic on screen are the same function.
    return rows.map((entry) => ({
      ...entry,
      amountMinor: entry.billable ? amountFor(entry.minutes, entry.rateMinor) : 0,
    }));
  },
});

export const invoiceTime = defineService({
  name: "time.invoice",
  summary: "Turn tracked hours into invoice lines, once.",
  kind: "mutation",
  permission: "scoped",
  agentCallable: false,
  writeClass: "money",
  input: z.object({
    entryIds: z.array(id).min(1).max(200),
    currency: currency.default("GBP"),
    /** Attach the invoice to this job as well, when there is one. */
    projectId: id.nullish(),
  }),
  output: row({
    invoiceId: uuid,
    lines: z.number().int(),
    totalMinor: z.number().int(),
  }),
  handler: async (input, ctx) => {
    if (!listServices().has("invoicing.createDraft")) {
      throw new ServiceError(
        "conflict",
        "Invoicing is switched off, so tracked time cannot be billed here.",
      );
    }
    const entries = await ctx.tx
      .select()
      .from(timeEntries)
      .where(inArray(timeEntries.id, input.entryIds))
      .orderBy(asc(timeEntries.startedAt));
    if (entries.length === 0) throw new ServiceError("not_found", "No such entries.");

    // Every refusal below is about billing an hour twice or billing one that
    // does not exist yet — checked before anything is written, so a bad list
    // produces a message rather than a partial invoice.
    const already = entries.filter((entry) => entry.invoiceId);
    if (already.length > 0) {
      throw new ServiceError(
        "conflict",
        `${already.length} of these have already been invoiced. Remove them and try again.`,
      );
    }
    const running = entries.filter((entry) => !entry.endedAt);
    if (running.length > 0) {
      throw new ServiceError("conflict", "Stop the timer before billing that time.");
    }
    const unbillable = entries.filter((entry) => !entry.billable);
    if (unbillable.length > 0) {
      throw new ServiceError(
        "conflict",
        `${unbillable.length} of these are marked unbillable. Mark them billable first if you meant to charge for them.`,
      );
    }
    const contactIds = new Set(entries.map((entry) => entry.contactId));
    const contactId = entries[0]!.contactId;
    if (contactIds.size !== 1 || contactId === null) {
      // One invoice is for one customer. Silently splitting the list, or
      // picking one of them, would both be worse than saying so.
      throw new ServiceError(
        "validation",
        "These hours are for different customers, or for none. Bill one customer at a time.",
      );
    }

    const draft = (await ctx.call(getService("invoicing.createDraft"), {
      contactId,
      currency: input.currency,
      sourceType: "manual",
      sourceId: input.projectId ?? undefined,
      // Stable for this exact set of entries, so a retried submit bills them
      // once. A different set is a different invoice.
      idempotencyKey: `time:${[...input.entryIds].sort().join(",")}`.slice(0, 240),
      lines: entries.map((entry) => ({
        sourceType: "time_entry",
        sourceId: entry.id,
        // The words the person wrote at the time, and the hours as recorded.
        // A summarised "consulting" line is what an invoice gets queried over.
        // Hours are formatted from integer minutes rather than a decimal: "1h
        // 45m" is what somebody checks against their own notes, and 1.75 is
        // what they have to convert first.
        description: `${entry.description} (${hoursAndMinutes(entry.minutes)})`,
        quantityMicros: 1_000_000,
        unitAmountMinor: amountFor(entry.minutes, entry.rateMinor),
      })),
      tax: {
        mode: "not_applicable" as const,
        reason: "Tracked time; tax applied when the invoice is issued.",
      },
    })) as { invoice: { id: string } };

    const invoicedAt = new Date();
    await ctx.tx
      .update(timeEntries)
      .set({ invoiceId: draft.invoice.id, invoicedAt, updatedAt: sql`now()` })
      .where(inArray(timeEntries.id, entries.map((entry) => entry.id)));

    if (input.projectId && listServices().has("projects.link")) {
      await ctx.call(getService("projects.link"), {
        projectId: input.projectId,
        kind: "invoice",
        targetId: draft.invoice.id,
        label: "Time",
      });
    }

    ctx.setSubject("invoice", draft.invoice.id);
    ctx.queueEvent("time.invoiced", {
      invoiceId: draft.invoice.id,
      contactId,
      entries: entries.length,
    });
    return {
      invoiceId: draft.invoice.id,
      lines: entries.length,
      totalMinor: entries.reduce(
        (total, entry) => total + amountFor(entry.minutes, entry.rateMinor),
        0,
      ),
    };
  },
});

/**
 * What a merge means for tracked time (CLAUDE.md's non-negotiable).
 *
 * Unconditional. Hours worked for somebody are hours worked for whoever their
 * surviving record is, and an entry pointing at a contact that no longer
 * exists is billable work the business cannot find.
 */
registerContactReference({
  table: "time_entries",
  repoint: (tx, duplicateId, survivingId) =>
    tx
      .update(timeEntries)
      .set({ contactId: survivingId })
      .where(eq(timeEntries.contactId, duplicateId)),
  captureForUndo: async (tx, duplicateId, survivingId) => ({
    state: await tx
      .select({ id: timeEntries.id, contactId: timeEntries.contactId })
      .from(timeEntries)
      .where(inArray(timeEntries.contactId, [duplicateId, survivingId])),
    undoable: true,
  }),
  restoreAfterUndo: async (tx, beforeState, _afterState, duplicateId) => {
    const moved = z
      .array(z.object({ id: z.string().uuid(), contactId: z.string().uuid().nullable() }))
      .parse(beforeState)
      .filter((entry) => entry.contactId === duplicateId);
    if (moved.length) {
      await tx
        .update(timeEntries)
        .set({ contactId: duplicateId })
        .where(inArray(timeEntries.id, moved.map((entry) => entry.id)));
    }
  },
});

/**
 * What tracked time means for the person's own data (§30).
 *
 * The hours survive and the person goes. What somebody worked and what it was
 * worth is the business's own record — its accounts, its capacity, its
 * profitability — and deleting it would take that with the customer's data.
 * The description goes, because it is the one field written *about* the work
 * they asked for.
 */
registerContactPrivacySource({
  scope: "contact.timeEntries",
  tables: ["time_entries"],
  exportData: (tx, contactId) =>
    tx
      .select()
      .from(timeEntries)
      .where(eq(timeEntries.contactId, contactId))
      .orderBy(asc(timeEntries.startedAt)),
  erase: async (tx, contactId) => {
    const rows = await tx
      .update(timeEntries)
      .set({ contactId: null, description: "Work", updatedAt: sql`now()` })
      .where(eq(timeEntries.contactId, contactId))
      .returning({ id: timeEntries.id });
    return { affected: rows.length };
  },
});

export default [
  setTimeRate,
  listTimeRates,
  startTimer,
  stopTimer,
  logTime,
  updateTimeEntry,
  removeTimeEntry,
  listTimeEntries,
  invoiceTime,
];
