// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C3.31: human carrier evidence stays distinct from observed HTTP outcomes.
import { and, eq, gt, isNull } from "drizzle-orm";
import { z } from "zod";
import { timestamp } from "@/core/contract";
import { defineService, hasModuleAccess, ServiceError, type Actor } from "@/core/service";
import { admitCarrierWrites } from "./carrier-operations";
import { mailProviderGrants } from "./schema";

function requirePerson(actor: Actor) {
  if (actor.kind !== "user" || actor.keyScopes || !hasModuleAccess(actor, "mail", "manage")) throw new ServiceError("permission", "Sign in as a person with mail management access to verify original carrier evidence.");
  return actor;
}
const operation = z.object({ id: z.uuid(), kind: z.enum(["send", "consent", "withdraw"]), state: z.enum(["running", "confirmed", "refused", "unknown"]), httpStatus: z.number().optional(), providerCode: z.string().optional() });
export const listCarrierGrantRecovery = defineService({
  name: "mail.listCarrierGrantRecovery", summary: "Review original carrier grants and individual HTTP outcomes without exposing private keyed receipts.",
  kind: "query", permission: "scoped", agentCallable: false, stepUp: true,
  input: z.object({ afterId: z.uuid().optional(), limit: z.number().int().min(1).max(100).default(25) }),
  output: z.object({ rows: z.array(z.object({ id: z.uuid(), email: z.string(), originalBaseUrl: z.string().nullable(), originalResourceKnown: z.boolean(), detached: z.boolean(), revision: z.number().int(), updatedAt: timestamp, withdrawalError: z.string().nullable(), operations: z.array(operation) })), nextCursor: z.uuid().nullable() }),
  handler: async (input, ctx) => {
    requirePerson(ctx.actor);
    const rows = await ctx.tx.select().from(mailProviderGrants).where(and(isNull(mailProviderGrants.withdrawnAt), input.afterId ? gt(mailProviderGrants.id, input.afterId) : undefined)).orderBy(mailProviderGrants.id).limit(input.limit + 1);
    const page = rows.slice(0, input.limit);
    return { rows: page.map(row => ({ id: row.id, email: row.email, originalBaseUrl: row.resourceBaseUrl, originalResourceKnown: Boolean(row.resourceDigest && row.resourceBaseUrl), detached: !row.consentRecordId, revision: row.revision, updatedAt: row.updatedAt, withdrawalError: row.withdrawalError, operations: row.carrierOperations.map(({ id, kind, state, httpStatus, providerCode }) => ({ id, kind, state, httpStatus, providerCode })) })), nextCursor: rows.length > input.limit ? page.at(-1)!.id : null };
  },
});

export const confirmCarrierWithdrawal = defineService({
  name: "mail.confirmCarrierWithdrawal", summary: "Record a person's verified original-carrier final withdrawal and stopped-caller proof; never retry provider I/O.",
  kind: "mutation", permission: "scoped", agentCallable: false, stepUp: true,
  input: z.object({ id: z.uuid(), expectedRevision: z.number().int().min(0), expectedEmail: z.email(), originalResourceEvidence: z.string().trim().min(20).max(4_000), finalProviderEvidence: z.string().trim().min(20).max(4_000), stoppedCallerEvidence: z.string().trim().min(20).max(4_000), providerOperationRef: z.string().trim().min(8).max(2_000), confirmation: z.literal("ORIGINAL CARRIER WITHDRAWAL VERIFIED") }),
  output: z.object({ id: z.uuid(), source: z.literal("human_provider_confirmation") }),
  auditInputFields: ["id"],
  handler: async (input, ctx) => {
    const actor = requirePerson(ctx.actor), receipts = await admitCarrierWrites(ctx.tx);
    const [grant] = await ctx.tx.select().from(mailProviderGrants).where(eq(mailProviderGrants.id, input.id)).for("update");
    if (!grant || grant.email !== input.expectedEmail || grant.revision !== input.expectedRevision) throw new ServiceError("conflict", "The original carrier grant changed. Review its current evidence again.");
    if (!grant.withdrawnAt) await ctx.tx.update(mailProviderGrants).set({ withdrawnAt: new Date(), withdrawalError: null, reviewDigest: receipts.digest("dispatch-resolution", JSON.stringify({ ...input, operations: grant.carrierOperations, actor: actor.userId })), reviewedAt: new Date(), reviewedBy: actor.userId, updatedAt: new Date() }).where(eq(mailProviderGrants.id, grant.id));
    // Missing legacy provenance remains missing. Human evidence is not an
    // invented account binding and never rewrites an observed HTTP journal.
    ctx.setSubject("mail_provider_grant", grant.id);
    return { id: grant.id, source: "human_provider_confirmation" as const };
  },
});
export default [listCarrierGrantRecovery, confirmCarrierWithdrawal];
