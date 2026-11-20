// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// What a merge means for this module's tables.
//
// Core cannot import a module's schema (§11), so the two `contact_id` columns
// this module adds declare their own repoint here, and `merge-completeness`
// fails the build if they do not. Neither table has a uniqueness constraint
// involving the contact, so a merge is an unconditional repoint: two people
// turning out to be one person means one person who tracks both lists and was
// warned about both charges.
//
// The write surface lives here: a member adds a charge, edits it, and stops
// being warned about it. All three resolve the contact from the session and
// never from the request, so there is no shape of input that reaches somebody
// else's register. The room it is shown in is `./portal`.
import { and, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { listed, row, timestamp, uuid as uuidSchema } from "@/core/contract";
import { defineService, ServiceError } from "@/core/service";
import { registerContactReference } from "@/core/contacts/service";
import { registerContactPrivacySource } from "@/core/privacy/service";
import { contactForActor } from "@/core/portal/service";
import { nextRenewalAfter } from "./cycle";
import {
  RENEWAL_CYCLES,
  TRACKED_STATUSES,
  renewalAlerts,
  trackedSubscriptions,
} from "./schema";

registerContactReference({
  table: "tracked_subscriptions",
  repoint: (tx, duplicateId, survivingId) =>
    tx
      .update(trackedSubscriptions)
      .set({ contactId: survivingId })
      .where(eq(trackedSubscriptions.contactId, duplicateId)),
  captureForUndo: async (tx, duplicateId, survivingId) => ({
    state: await tx
      .select({ id: trackedSubscriptions.id, contactId: trackedSubscriptions.contactId })
      .from(trackedSubscriptions)
      .where(inArray(trackedSubscriptions.contactId, [duplicateId, survivingId])),
    undoable: true,
  }),
  restoreAfterUndo: async (tx, before, after, duplicateId) => {
    const moved = z
      .array(z.object({ id: z.string(), contactId: z.string().uuid().nullable() }))
      .parse(before)
      .filter((row) => row.contactId === duplicateId);
    void after;
    if (moved.length) {
      await tx
        .update(trackedSubscriptions)
        .set({ contactId: duplicateId })
        .where(inArray(trackedSubscriptions.id, moved.map((row) => row.id)));
    }
  },
});

registerContactReference({
  table: "renewal_alerts",
  repoint: (tx, duplicateId, survivingId) =>
    tx
      .update(renewalAlerts)
      .set({ contactId: survivingId })
      .where(eq(renewalAlerts.contactId, duplicateId)),
  captureForUndo: async (tx, duplicateId, survivingId) => ({
    state: await tx
      .select({ id: renewalAlerts.id, contactId: renewalAlerts.contactId })
      .from(renewalAlerts)
      .where(inArray(renewalAlerts.contactId, [duplicateId, survivingId])),
    undoable: true,
  }),
  restoreAfterUndo: async (tx, before, after, duplicateId) => {
    const moved = z
      .array(z.object({ id: z.string(), contactId: z.string().uuid().nullable() }))
      .parse(before)
      .filter((row) => row.contactId === duplicateId);
    void after;
    if (moved.length) {
      await tx
        .update(renewalAlerts)
        .set({ contactId: duplicateId })
        .where(inArray(renewalAlerts.id, moved.map((row) => row.id)));
    }
  },
});

/**
 * Export and erasure for the two tables.
 *
 * Erasure here **deletes**, where `reviews` anonymises — and the contrast is
 * the point. A public rating survives its reviewer because the business's
 * rating is not the reviewer's personal data to withdraw. Nothing in this
 * module is like that. A list of what someone pays for, when, and how much is
 * personal data end to end; there is no aggregate anyone else is entitled to
 * and nothing left worth keeping once the person is gone. Anonymising a
 * subscription register would leave a de-identified record of one household's
 * spending, which is both useless to us and exactly the kind of residue
 * erasure is supposed to remove.
 *
 * (A "top tracked services" aggregate over a small register is not an
 * aggregate at all: at a handful of rows with a count of one each it is an
 * itemised list of one person's subscriptions. That is the failure this
 * decision avoids repeating at the storage layer.)
 */
registerContactPrivacySource({
  scope: "contact.renewalAlerts",
  tables: ["tracked_subscriptions", "renewal_alerts"],
  exportData: async (tx, contactId) => ({
    trackedSubscriptions: await tx
      .select()
      .from(trackedSubscriptions)
      .where(eq(trackedSubscriptions.contactId, contactId)),
    alerts: await tx
      .select()
      .from(renewalAlerts)
      .where(eq(renewalAlerts.contactId, contactId)),
  }),
  erase: async (tx, contactId) => {
    // Alerts first: they reference the subscriptions, and being explicit here
    // means the order does not depend on a cascade staying as it is today.
    const alerts = await tx
      .delete(renewalAlerts)
      .where(eq(renewalAlerts.contactId, contactId))
      .returning({ id: renewalAlerts.id });
    const tracked = await tx
      .delete(trackedSubscriptions)
      .where(eq(trackedSubscriptions.contactId, contactId))
      .returning({ id: trackedSubscriptions.id });
    return { affected: alerts.length + tracked.length };
  },
});


/* ----------------------------------------------------- the write surface */

const trackedRow = row({
  id: uuidSchema,
  contactId: uuidSchema,
  name: z.string(),
  costMinor: z.number(),
  currency: z.string(),
  cycle: z.enum(RENEWAL_CYCLES),
  customIntervalDays: z.number().nullable(),
  firstChargeAt: timestamp,
  nextRenewalAt: timestamp,
  alertDays: z.number(),
  notes: z.string().nullable(),
  status: z.enum(TRACKED_STATUSES),
});

/**
 * What a person may say about a charge.
 *
 * `alertDays` allows 0 — "tell me on the day" is a real preference, and the
 * look-ahead treats it as any other lead time. The ceiling is 90 rather than
 * unbounded because a year of warning is not a warning.
 */
const trackedInput = {
  name: z.string().trim().min(1).max(120),
  costMinor: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  currency: z
    .string()
    .trim()
    .length(3)
    .transform((code) => code.toUpperCase()),
  cycle: z.enum(RENEWAL_CYCLES).default("monthly"),
  customIntervalDays: z.number().int().min(1).max(3650).nullable().default(null),
  firstChargeAt: z.coerce.date(),
  alertDays: z.number().int().min(0).max(90).default(3),
  notes: z.string().trim().max(2000).nullable().default(null),
};

/**
 * A custom cycle with no interval is the one combination the column types
 * cannot refuse, so it is refused here — the schema says as much beside
 * `custom_interval_days`. Left unchecked it would store a row the look-ahead
 * silently treats as 30-day, which is a wrong alert rather than a missing one.
 */
function requireInterval(input: {
  cycle: (typeof RENEWAL_CYCLES)[number];
  customIntervalDays: number | null;
}): void {
  if (input.cycle === "custom" && !input.customIntervalDays) {
    throw new ServiceError(
      "validation",
      "A custom cycle needs the number of days between charges.",
    );
  }
}

export const listTrackedSubscriptions = defineService({
  name: "renewalAlerts.list",
  summary: "Tracked charges, soonest renewal first.",
  kind: "query",
  permission: "scoped",
  // C8.11: the person this asks about may ask it themselves. The field must be
  // present and their own — an absent filter means everybody, and that is
  // refused rather than ignored.
  selfService: { contactField: "contactId" },
  input: z.object({
    contactId: uuidSchema.optional(),
    status: z.enum(TRACKED_STATUSES).optional(),
    limit: z.number().int().min(1).max(200).default(50),
  }),
  output: listed(trackedRow),
  handler: async (input, ctx) => {
    const filters = [
      input.contactId ? eq(trackedSubscriptions.contactId, input.contactId) : undefined,
      input.status ? eq(trackedSubscriptions.status, input.status) : undefined,
    ].filter((f) => f !== undefined);
    return ctx.tx
      .select()
      .from(trackedSubscriptions)
      .where(filters.length ? and(...filters) : undefined)
      .orderBy(trackedSubscriptions.nextRenewalAt)
      .limit(input.limit);
  },
});

export const getTrackedSubscription = defineService({
  name: "renewalAlerts.get",
  summary: "One tracked charge, with the alerts already sent for it.",
  kind: "query",
  permission: "scoped",
  selfService: { contactField: "contactId" },
  input: z.object({ id: uuidSchema, contactId: uuidSchema.optional() }),
  output: row({
    subscription: trackedRow,
    alerts: listed(row({ id: uuidSchema, renewalAt: timestamp, daysAhead: z.number() })),
  }),
  handler: async (input, ctx) => {
    const scope = [
      eq(trackedSubscriptions.id, input.id),
      input.contactId ? eq(trackedSubscriptions.contactId, input.contactId) : undefined,
    ].filter((f) => f !== undefined);
    const [subscription] = await ctx.tx
      .select()
      .from(trackedSubscriptions)
      .where(and(...scope))
      .limit(1);
    if (!subscription) throw new ServiceError("not_found", "There is no such tracked charge.");
    const alerts = await ctx.tx
      .select({
        id: renewalAlerts.id,
        renewalAt: renewalAlerts.renewalAt,
        daysAhead: renewalAlerts.daysAhead,
      })
      .from(renewalAlerts)
      .where(eq(renewalAlerts.subscriptionId, subscription.id))
      .orderBy(desc(renewalAlerts.renewalAt));
    return { subscription, alerts };
  },
});

export const trackMySubscription = defineService({
  name: "renewalAlerts.trackMine",
  writeClass: "write",
  summary: "Start warning the signed-in member about a charge.",
  kind: "mutation",
  permission: "authenticated",
  // `notes` is the member's own prose about their own spending and has no
  // business in an audit input. Identity and action still come from the
  // authorized mutation itself.
  auditInputFields: ["name", "cycle", "alertDays"],
  input: z.object(trackedInput),
  output: trackedRow,
  handler: async (input, ctx) => {
    requireInterval(input);
    const me = await contactForActor(ctx);
    const [created] = await ctx.tx
      .insert(trackedSubscriptions)
      .values({
        contactId: me.id,
        name: input.name,
        costMinor: input.costMinor,
        currency: input.currency,
        cycle: input.cycle,
        customIntervalDays: input.customIntervalDays,
        firstChargeAt: input.firstChargeAt,
        // Computed, never taken from the form: the next renewal is a function
        // of the anchor and the cycle, and a client that could set it directly
        // could ask to be warned about a date the charge will not land on.
        nextRenewalAt: nextRenewalAfter(
          input.firstChargeAt,
          input.cycle,
          input.customIntervalDays,
          new Date(),
        ),
        alertDays: input.alertDays,
        notes: input.notes,
      })
      .returning();
    return created!;
  },
});

export const updateMyTrackedSubscription = defineService({
  name: "renewalAlerts.updateMine",
  writeClass: "write",
  summary: "Correct a charge the signed-in member tracks.",
  kind: "mutation",
  permission: "authenticated",
  auditInputFields: ["name", "cycle", "alertDays"],
  input: z.object({ id: uuidSchema, ...trackedInput }),
  output: trackedRow,
  handler: async (input, ctx) => {
    requireInterval(input);
    const me = await contactForActor(ctx);
    const [updated] = await ctx.tx
      .update(trackedSubscriptions)
      .set({
        name: input.name,
        costMinor: input.costMinor,
        currency: input.currency,
        cycle: input.cycle,
        customIntervalDays: input.customIntervalDays,
        firstChargeAt: input.firstChargeAt,
        nextRenewalAt: nextRenewalAfter(
          input.firstChargeAt,
          input.cycle,
          input.customIntervalDays,
          new Date(),
        ),
        alertDays: input.alertDays,
        notes: input.notes,
      })
      // The contact is part of the predicate rather than checked after the
      // read, so there is no window in which somebody else's row is loaded.
      .where(
        and(
          eq(trackedSubscriptions.id, input.id),
          eq(trackedSubscriptions.contactId, me.id),
        ),
      )
      .returning();
    if (!updated) throw new ServiceError("not_found", "There is no such tracked charge.");
    return updated;
  },
});

export const untrackMySubscription = defineService({
  name: "renewalAlerts.untrackMine",
  writeClass: "write",
  summary: "Stop warning the signed-in member about a charge.",
  kind: "mutation",
  permission: "authenticated",
  input: z.object({ id: uuidSchema }),
  output: row({ id: uuidSchema, status: z.enum(TRACKED_STATUSES) }),
  handler: async (input, ctx) => {
    const me = await contactForActor(ctx);
    const [archived] = await ctx.tx
      .update(trackedSubscriptions)
      .set({ status: "archived" })
      .where(
        and(
          eq(trackedSubscriptions.id, input.id),
          eq(trackedSubscriptions.contactId, me.id),
        ),
      )
      .returning({ id: trackedSubscriptions.id, status: trackedSubscriptions.status });
    if (!archived) throw new ServiceError("not_found", "There is no such tracked charge.");
    return archived;
  },
});

export { RENEWAL_CYCLES } from "./schema";

export default [
  listTrackedSubscriptions,
  getTrackedSubscription,
  trackMySubscription,
  updateMyTrackedSubscription,
  untrackMySubscription,
];

// The room this module shows in the member's portal. Imported for its
// registration side effect, exactly as `modules/subscriptions` does.
import "./portal";
