// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Entitlements and the grants that actually let somebody in
// (MASTER.md §4.15, C9.14).
import { and, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { listed, okResult, row, timestamp, uuid as uuidSchema } from "@/core/contract";
import { contacts } from "@/core/contacts/schema";
import { registerContactReference } from "@/core/contacts/service";
import { registerContactPrivacySource } from "@/core/privacy/service";
import { defineService, ServiceError, type Tx } from "@/core/service";
import {
  contactHasAccess,
  ensureEntitlement,
  ensureGrant,
  issuePassBalance,
  issueUnlockRecord,
  spendPassPunch,
  syncSubscriptionAccess as syncSubscriptionAccessTx,
  syncTierAccess as syncTierAccessTx,
} from "./access";
import {
  ENTITLEMENT_PERIODS,
  GRANTOR_TYPES,
  contentUnlocks,
  entitlementGrants,
  entitlements,
  passBalances,
  type Resource,
} from "./schema";

const resourceSchema = z.object({
  kind: z.string().trim().min(1).max(40),
  selector: z.string().trim().min(1).max(200).optional(),
});

const entitlementRow = row({
  id: uuidSchema,
  grantorType: z.enum(GRANTOR_TYPES),
  grantorId: uuidSchema,
  name: z.string(),
  resource: resourceSchema,
  quantity: z.number().int().nullable(),
  period: z.enum(ENTITLEMENT_PERIODS),
  priority: z.number().int(),
  status: z.enum(["active", "archived"]),
  createdAt: timestamp,
  updatedAt: timestamp,
});

const grantRow = row({
  id: uuidSchema,
  contactId: uuidSchema,
  entitlementId: uuidSchema,
  sourceSubscriptionId: uuidSchema.nullable(),
  sourcePassBalanceId: uuidSchema.nullable(),
  sourceUnlockId: uuidSchema.nullable(),
  startsAt: timestamp,
  endsAt: timestamp.nullable(),
  used: z.number().int(),
  status: z.enum(["active", "paused", "expired", "revoked"]),
  createdAt: timestamp,
  updatedAt: timestamp,
});

async function actorContactId(ctx: { actor: { kind: string; userId?: string }; tx: Tx }) {
  if (ctx.actor.kind !== "user" || !ctx.actor.userId) return null;
  const [found] = await ctx.tx
    .select({ id: contacts.id })
    .from(contacts)
    .where(eq(contacts.userId, ctx.actor.userId))
    .limit(1);
  return found?.id ?? null;
}

export const saveEntitlement = defineService({
  name: "entitlements.save",
  writeClass: "write",
  summary: "Say what a plan, pass, tier or manual decision grants.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({
    id: uuidSchema.optional(),
    grantorType: z.enum(GRANTOR_TYPES),
    grantorId: uuidSchema,
    name: z.string().trim().min(1).max(200),
    resource: resourceSchema,
    quantity: z.number().int().min(1).max(100000).nullish(),
    period: z.enum(ENTITLEMENT_PERIODS).default("total"),
    priority: z.number().int().min(0).max(1000).default(0),
    status: z.enum(["active", "archived"]).default("active"),
  }),
  output: entitlementRow,
  handler: async (input, ctx) => {
    const resource: Resource = input.resource.selector
      ? { kind: input.resource.kind, selector: input.resource.selector }
      : { kind: input.resource.kind };
    if (input.id) {
      const [updated] = await ctx.tx
        .update(entitlements)
        .set({
          name: input.name,
          resource,
          quantity: input.quantity ?? null,
          period: input.period,
          priority: input.priority,
          status: input.status,
        })
        .where(eq(entitlements.id, input.id))
        .returning();
      if (!updated) throw new ServiceError("not_found", "There is no such entitlement.");
      ctx.setSubject("entitlement", updated.id);
      return updated;
    }
    const created = await ensureEntitlement(ctx.tx, {
      grantorType: input.grantorType,
      grantorId: input.grantorId,
      name: input.name,
      resource,
      quantity: input.quantity ?? null,
      period: input.period,
      priority: input.priority,
    });
    if (input.status === "archived") {
      await ctx.tx
        .update(entitlements)
        .set({ status: "archived" })
        .where(eq(entitlements.id, created.id));
    }
    const [row] = await ctx.tx.select().from(entitlements).where(eq(entitlements.id, created.id));
    ctx.setSubject("entitlement", created.id);
    return row!;
  },
});

export const listEntitlements = defineService({
  name: "entitlements.list",
  summary: "The catalogue of what can be granted.",
  kind: "query",
  permission: "scoped",
  input: z.object({
    grantorType: z.enum(GRANTOR_TYPES).optional(),
    grantorId: uuidSchema.optional(),
    limit: z.number().int().min(1).max(200).default(100),
  }),
  output: listed(entitlementRow),
  handler: (input, ctx) =>
    ctx.tx
      .select()
      .from(entitlements)
      .where(
        and(
          input.grantorType ? eq(entitlements.grantorType, input.grantorType) : undefined,
          input.grantorId ? eq(entitlements.grantorId, input.grantorId) : undefined,
        ),
      )
      .orderBy(desc(entitlements.createdAt))
      .limit(input.limit),
});

export const grantAccess = defineService({
  name: "entitlements.grant",
  writeClass: "write",
  summary: "Give a contact a grant, by hand.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({
    contactId: uuidSchema,
    entitlementId: uuidSchema.optional(),
    grantorType: z.enum(GRANTOR_TYPES).optional(),
    grantorId: uuidSchema.optional(),
    name: z.string().trim().min(1).max(200).optional(),
    resource: resourceSchema.optional(),
    startsAt: z.coerce.date().optional(),
    endsAt: z.coerce.date().nullish(),
  }),
  output: grantRow,
  handler: async (input, ctx) => {
    const [person] = await ctx.tx
      .select({ id: contacts.id })
      .from(contacts)
      .where(eq(contacts.id, input.contactId));
    if (!person) throw new ServiceError("not_found", "There is no such contact.");

    let entitlementId = input.entitlementId;
    if (!entitlementId) {
      if (!input.resource || !input.name) {
        throw new ServiceError("validation", "Say what this grant is for.");
      }
      const created = await ensureEntitlement(ctx.tx, {
        grantorType: input.grantorType ?? "manual",
        grantorId: input.grantorId ?? person.id,
        name: input.name,
        resource: input.resource,
      });
      entitlementId = created.id;
    }
    const grant = await ensureGrant(ctx.tx, {
      contactId: input.contactId,
      entitlementId,
      startsAt: input.startsAt ?? new Date(),
      endsAt: input.endsAt ?? null,
      status: "active",
    });
    const [row] = await ctx.tx
      .select()
      .from(entitlementGrants)
      .where(eq(entitlementGrants.id, grant.id));
    ctx.setSubject("entitlement_grant", grant.id);
    await ctx.emitTimeline({
      contactId: input.contactId,
      eventType: "entitlement.granted",
      subjectType: "entitlement_grant",
      subjectId: grant.id,
      payload: { entitlementId },
    });
    return row!;
  },
});

export const revokeGrant = defineService({
  name: "entitlements.revoke",
  writeClass: "destructive",
  summary: "Take a grant away.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({ id: uuidSchema }),
  output: okResult,
  handler: async (input, ctx) => {
    const [grant] = await ctx.tx
      .select()
      .from(entitlementGrants)
      .where(eq(entitlementGrants.id, input.id));
    if (!grant) throw new ServiceError("not_found", "There is no such grant.");
    await ctx.tx
      .update(entitlementGrants)
      .set({ status: "revoked", endsAt: new Date() })
      .where(eq(entitlementGrants.id, input.id));
    ctx.setSubject("entitlement_grant", input.id);
    await ctx.emitTimeline({
      contactId: grant.contactId,
      eventType: "entitlement.revoked",
      subjectType: "entitlement_grant",
      subjectId: input.id,
    });
    return { ok: true as const };
  },
});

export const listGrants = defineService({
  name: "entitlements.listGrants",
  summary: "Who holds what, newest first.",
  kind: "query",
  permission: "scoped",
  selfService: { contactField: "contactId" },
  input: z.object({
    contactId: uuidSchema.optional(),
    status: z.enum(["active", "paused", "expired", "revoked"]).optional(),
    limit: z.number().int().min(1).max(200).default(100),
  }),
  output: listed(grantRow),
  handler: (input, ctx) =>
    ctx.tx
      .select()
      .from(entitlementGrants)
      .where(
        and(
          input.contactId ? eq(entitlementGrants.contactId, input.contactId) : undefined,
          input.status ? eq(entitlementGrants.status, input.status) : undefined,
        ),
      )
      .orderBy(desc(entitlementGrants.createdAt))
      .limit(input.limit),
});

export const hasAccess = defineService({
  name: "entitlements.hasAccess",
  summary: "May this person use this resource right now.",
  kind: "query",
  permission: "public",
  input: z.object({
    resource: resourceSchema,
    /** Staff may ask about somebody else; everyone else is themselves. */
    contactId: uuidSchema.optional(),
  }),
  output: row({ allowed: z.boolean(), contactId: uuidSchema.nullable() }),
  handler: async (input, ctx) => {
    let contactId = input.contactId ?? (await actorContactId(ctx));
    if (input.contactId) {
      const staff =
        ctx.actor.kind === "user" &&
        "grants" in ctx.actor &&
        ctx.actor.grants.some(
          (grant) =>
            (grant.module === "*" || grant.module === "entitlements") &&
            grant.access === "manage",
        );
      if (!staff) {
        const mine = await actorContactId(ctx);
        if (mine !== input.contactId) {
          throw new ServiceError("permission", "You can only ask about your own access.");
        }
      }
    }
    const allowed = await contactHasAccess(ctx.tx, contactId, input.resource);
    return { allowed, contactId };
  },
});

export const syncSubscriptionAccess = defineService({
  name: "entitlements.syncSubscription",
  writeClass: "write",
  summary: "Move a subscription's grants with its period.",
  kind: "mutation",
  permission: "system",
  input: z.object({
    subscriptionId: uuidSchema,
    contactId: uuidSchema,
    planId: uuidSchema,
    planName: z.string().min(1).max(200),
    startsAt: z.coerce.date(),
    endsAt: z.coerce.date(),
    status: z.enum(["active", "paused", "expired", "revoked"]),
  }),
  output: okResult,
  handler: async (input, ctx) => {
    await syncSubscriptionAccessTx(ctx.tx, input);
    return { ok: true as const };
  },
});

export const syncTierAccess = defineService({
  name: "entitlements.syncTier",
  writeClass: "write",
  summary: "Move a contact's tier grants when their standing changes.",
  kind: "mutation",
  permission: "system",
  input: z.object({
    contactId: uuidSchema,
    fromTierId: uuidSchema.nullable(),
    toTierId: uuidSchema.nullable(),
    endsAt: z.coerce.date().nullish(),
  }),
  output: okResult,
  handler: async (input, ctx) => {
    await syncTierAccessTx(ctx.tx, input);
    return { ok: true as const };
  },
});

export const issuePass = defineService({
  name: "entitlements.issuePass",
  writeClass: "write",
  summary: "Issue prepaid pass punches from a paid order.",
  kind: "mutation",
  permission: "system",
  input: z.object({
    contactId: uuidSchema,
    productId: uuidSchema,
    productName: z.string().min(1).max(200),
    quantity: z.number().int().min(1).max(10000),
    sourceOrderId: uuidSchema.optional(),
    expiresAt: z.coerce.date().nullish(),
  }),
  output: row({ passBalanceId: uuidSchema, grantId: uuidSchema }),
  handler: async (input, ctx) => {
    const issued = await issuePassBalance(ctx.tx, input);
    ctx.setSubject("pass_balance", issued.passBalanceId);
    await ctx.emitTimeline({
      contactId: input.contactId,
      eventType: "entitlement.passIssued",
      subjectType: "pass_balance",
      subjectId: issued.passBalanceId,
      payload: { productId: input.productId, quantity: input.quantity },
    });
    return issued;
  },
});

export const spendPass = defineService({
  name: "entitlements.spendPass",
  writeClass: "write",
  summary: "Use one punch on a pass.",
  kind: "mutation",
  permission: "scoped",
  selfService: { contactField: "contactId" },
  input: z.object({
    passBalanceId: uuidSchema,
    contactId: uuidSchema,
  }),
  output: row({ remaining: z.number().int() }),
  handler: async (input, ctx) => {
    try {
      return await spendPassPunch(ctx.tx, input);
    } catch (error) {
      if (error instanceof Error && error.message === "not_found") {
        throw new ServiceError("not_found", "There is no such pass.");
      }
      if (error instanceof Error && error.message === "exhausted") {
        throw new ServiceError("conflict", "That pass has no punches left.");
      }
      throw error;
    }
  },
});

export const issueUnlock = defineService({
  name: "entitlements.issueUnlock",
  writeClass: "write",
  summary: "Unlock a resource from a paid invoice.",
  kind: "mutation",
  permission: "system",
  input: z.object({
    contactId: uuidSchema,
    invoiceId: uuidSchema,
    name: z.string().min(1).max(200),
    resource: resourceSchema,
  }),
  output: row({ unlockId: uuidSchema, grantId: uuidSchema }),
  handler: async (input, ctx) => {
    const issued = await issueUnlockRecord(ctx.tx, input);
    ctx.setSubject("content_unlock", issued.unlockId);
    await ctx.emitTimeline({
      contactId: input.contactId,
      eventType: "entitlement.unlocked",
      subjectType: "content_unlock",
      subjectId: issued.unlockId,
      payload: { invoiceId: input.invoiceId },
    });
    return issued;
  },
});

registerContactReference({
  table: "entitlement_grants",
  repoint: async (tx, duplicateId, survivingId) => {
    const survivor = await tx
      .select({
        entitlementId: entitlementGrants.entitlementId,
        sourceSubscriptionId: entitlementGrants.sourceSubscriptionId,
        sourcePassBalanceId: entitlementGrants.sourcePassBalanceId,
        sourceUnlockId: entitlementGrants.sourceUnlockId,
      })
      .from(entitlementGrants)
      .where(
        and(
          eq(entitlementGrants.contactId, survivingId),
          inArray(entitlementGrants.status, ["active", "paused"]),
        ),
      );
    const taken = new Set(
      survivor.map(
        (row) =>
          `${row.entitlementId}:${row.sourceSubscriptionId ?? ""}:${row.sourcePassBalanceId ?? ""}:${row.sourceUnlockId ?? ""}`,
      ),
    );
    const duplicate = await tx
      .select()
      .from(entitlementGrants)
      .where(eq(entitlementGrants.contactId, duplicateId));
    for (const row of duplicate) {
      const key = `${row.entitlementId}:${row.sourceSubscriptionId ?? ""}:${row.sourcePassBalanceId ?? ""}:${row.sourceUnlockId ?? ""}`;
      if (taken.has(key) && (row.status === "active" || row.status === "paused")) {
        await tx
          .update(entitlementGrants)
          .set({ status: "revoked", endsAt: new Date() })
          .where(eq(entitlementGrants.id, row.id));
        continue;
      }
      await tx
        .update(entitlementGrants)
        .set({ contactId: survivingId })
        .where(eq(entitlementGrants.id, row.id));
    }
  },
  captureForUndo: async (tx, duplicateId) => {
    const moved = await tx
      .select({ id: entitlementGrants.id })
      .from(entitlementGrants)
      .where(eq(entitlementGrants.contactId, duplicateId));
    return { state: moved.map((row) => row.id), undoable: true };
  },
  restoreAfterUndo: async (tx, before, _after, duplicateId) => {
    const ids = (Array.isArray(before) ? before : []).filter(
      (each): each is string => typeof each === "string",
    );
    if (!ids.length) return;
    await tx
      .update(entitlementGrants)
      .set({ contactId: duplicateId })
      .where(inArray(entitlementGrants.id, ids));
  },
});

registerContactReference({
  table: "pass_balances",
  repoint: (tx, duplicateId, survivingId) =>
    tx.update(passBalances).set({ contactId: survivingId }).where(eq(passBalances.contactId, duplicateId)),
  captureForUndo: async (tx, duplicateId) => {
    const moved = await tx
      .select({ id: passBalances.id })
      .from(passBalances)
      .where(eq(passBalances.contactId, duplicateId));
    return { state: moved.map((row) => row.id), undoable: true };
  },
  restoreAfterUndo: async (tx, before, _after, duplicateId) => {
    const ids = (Array.isArray(before) ? before : []).filter(
      (each): each is string => typeof each === "string",
    );
    if (!ids.length) return;
    await tx
      .update(passBalances)
      .set({ contactId: duplicateId })
      .where(inArray(passBalances.id, ids));
  },
});

registerContactReference({
  table: "content_unlocks",
  repoint: (tx, duplicateId, survivingId) =>
    tx
      .update(contentUnlocks)
      .set({ contactId: survivingId })
      .where(eq(contentUnlocks.contactId, duplicateId)),
  captureForUndo: async (tx, duplicateId) => {
    const moved = await tx
      .select({ id: contentUnlocks.id })
      .from(contentUnlocks)
      .where(eq(contentUnlocks.contactId, duplicateId));
    return { state: moved.map((row) => row.id), undoable: true };
  },
  restoreAfterUndo: async (tx, before, _after, duplicateId) => {
    const ids = (Array.isArray(before) ? before : []).filter(
      (each): each is string => typeof each === "string",
    );
    if (!ids.length) return;
    await tx
      .update(contentUnlocks)
      .set({ contactId: duplicateId })
      .where(inArray(contentUnlocks.id, ids));
  },
});

registerContactPrivacySource({
  scope: "entitlements.grants",
  tables: ["entitlement_grants", "pass_balances", "content_unlocks"],
  exportData: async (tx, contactId) => ({
    grants: await tx
      .select()
      .from(entitlementGrants)
      .where(eq(entitlementGrants.contactId, contactId)),
    passes: await tx.select().from(passBalances).where(eq(passBalances.contactId, contactId)),
    unlocks: await tx
      .select()
      .from(contentUnlocks)
      .where(eq(contentUnlocks.contactId, contactId)),
  }),
  erase: async (tx, contactId) => {
    const grants = await tx
      .update(entitlementGrants)
      .set({ status: "revoked", endsAt: new Date() })
      .where(
        and(
          eq(entitlementGrants.contactId, contactId),
          inArray(entitlementGrants.status, ["active", "paused"]),
        ),
      )
      .returning({ id: entitlementGrants.id });
    const passes = await tx
      .update(passBalances)
      .set({ status: "revoked" })
      .where(and(eq(passBalances.contactId, contactId), eq(passBalances.status, "active")))
      .returning({ id: passBalances.id });
    return { affected: grants.length + passes.length };
  },
});

export default [
  saveEntitlement,
  listEntitlements,
  grantAccess,
  revokeGrant,
  listGrants,
  hasAccess,
  syncSubscriptionAccess,
  syncTierAccess,
  issuePass,
  spendPass,
  issueUnlock,
];
