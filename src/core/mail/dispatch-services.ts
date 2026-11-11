// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C3.31/C11.08: human-confirmed final outcomes do not invent old machine facts.
import { and, eq, gt, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { timestamp } from "@/core/contract";
import { lockContactIdentityForRead } from "@/core/contacts/identity-lock";
import { enqueueJob } from "@/core/jobs";
import { defineService, hasModuleAccess, ServiceError, type Actor } from "@/core/service";
import { mailDeliveries, mailDispatches, mailDispatchRequests, mailLegacyResolutions, mailOutbox, mailRecordSubjects } from "./schema";
import { mailReceipts } from "./receipts";
import { lockMailHolds, removeSettledMailBody } from "./dispatch-state";
import { dispatchRouteSchema, publicOriginalMailRoute, readOriginalMailRoute } from "./dispatch-route";

const outcome = z.enum(["submitted", "not_submitted"]);
const state = z.enum(["running", "unknown", "submitted", "not_submitted"]);
function requirePerson(actor: Actor) {
  if (actor.kind !== "user" || actor.keyScopes || !hasModuleAccess(actor, "mail", "manage")) throw new ServiceError("permission", "Sign in as a person with mail management access to verify original provider and stopped-caller evidence.");
  return actor;
}
const evidence = z.object({
  deliveryId: z.uuid(), dispatchId: z.uuid().optional(), outcome,
  expectedAttempts: z.number().int().min(0), expectedRecipient: z.email(),
  expectedProviderRef: z.string().max(2_000).nullable(),
  originalRouteEvidence: z.string().trim().min(20).max(4_000),
  finalProviderEvidence: z.string().trim().min(20).max(4_000),
  stoppedCallerEvidence: z.string().trim().min(20).max(4_000),
  providerOperationRef: z.string().trim().min(8).max(2_000),
  confirmation: z.literal("ORIGINAL PROVIDER OUTCOME VERIFIED"),
});
export const reconcileMailDispatch = defineService({
  name: "mail.reconcileDispatch", summary: "Record a freshly verified person's exact original-provider final outcome and stopped-caller proof.",
  kind: "mutation", permission: "scoped", agentCallable: false, stepUp: true,
  input: evidence, output: z.object({ deliveryId: z.uuid(), outcome, source: z.enum(["human_provider_confirmation", "adapter"]), legacy: z.boolean() }),
  auditInputFields: ["deliveryId", "dispatchId", "outcome"],
  handler: async (input, ctx) => {
    const actor = requirePerson(ctx.actor);
    await lockContactIdentityForRead(ctx.tx);
    const held = await lockMailHolds(ctx.tx), receipts = await mailReceipts(ctx.tx);
    const [delivery] = await ctx.tx.select().from(mailDeliveries).where(eq(mailDeliveries.id, input.deliveryId)).for("update");
    if (!delivery || delivery.redactedAt) throw new ServiceError("not_found", "The original mail evidence is no longer available for this review.");
    if (delivery.attempts !== input.expectedAttempts || delivery.recipient !== input.expectedRecipient || delivery.providerRef !== input.expectedProviderRef) throw new ServiceError("conflict", "The original send changed. Review its current evidence before retrying.");
    const [request] = await ctx.tx.select().from(mailDispatchRequests).where(eq(mailDispatchRequests.deliveryId, delivery.id));
    const resolutionDigest = receipts.digest("dispatch-resolution", JSON.stringify({ ...input, actor: actor.userId }));
    if (input.dispatchId) {
      const [dispatch] = await ctx.tx.select().from(mailDispatches).where(and(eq(mailDispatches.id, input.dispatchId), eq(mailDispatches.deliveryId, delivery.id))).for("update");
      if (!request || !dispatch || dispatch.routeDigest !== request.routeDigest || dispatch.payloadDigest !== request.payloadDigest) throw new ServiceError("conflict", "The original physical request is missing or inconsistent. Restore its matching backup.");
      if (dispatch.replyEvidenceDigest && input.outcome === "not_submitted") throw new ServiceError("conflict", "An actual positive reply exists for this caller. It cannot be confirmed as never submitted.");
      if (!["running", "unknown"].includes(dispatch.state)) {
        if (dispatch.state !== input.outcome) throw new ServiceError("conflict", "That exact physical caller already has a different final outcome.");
        if (!dispatch.resolutionSource) throw new ServiceError("conflict", "The original final-outcome receipt is missing. Restore its matching backup.");
        return { deliveryId: delivery.id, outcome: input.outcome, source: dispatch.resolutionSource, legacy: false };
      }
      await ctx.tx.update(mailDispatches).set({ state: input.outcome, providerRef: input.outcome === "submitted" ? input.providerOperationRef : null, resolutionDigest, resolvedBy: actor.userId, resolutionSource: "human_provider_confirmation", finishedAt: sql`clock_timestamp()`, ...(!dispatch.initialReviewDigest ? { initialReviewDigest: resolutionDigest, initialReviewedAt: sql`clock_timestamp()` } : {}) }).where(eq(mailDispatches.id, dispatch.id));
    } else {
      if (request || delivery.attempts === 0) throw new ServiceError("conflict", "Use the exact physical caller for a current request. Never-dispatched mail needs no historical outcome claim.");
      const [prior] = await ctx.tx.select().from(mailLegacyResolutions).where(eq(mailLegacyResolutions.deliveryId, delivery.id));
      if (prior) {
        if (prior.outcome !== input.outcome) throw new ServiceError("conflict", "This legacy send already has another final human-confirmed outcome.");
        return { deliveryId: delivery.id, outcome: input.outcome, source: "human_provider_confirmation" as const, legacy: true };
      }
      const originalDigest = receipts.digest("dispatch-payload", JSON.stringify({ id: delivery.id, provider: delivery.provider, recipient: delivery.recipient, subject: delivery.subject, attempts: delivery.attempts, providerRef: delivery.providerRef, createdAt: delivery.createdAt }));
      await ctx.tx.insert(mailLegacyResolutions).values({ deliveryId: delivery.id, originalDigest, outcome: input.outcome, evidenceDigest: resolutionDigest, resolvedBy: actor.userId, providerRef: input.outcome === "submitted" ? input.providerOperationRef : null });
    }
    // Keep the ledger's earlier actual reference. A later manually verified
    // reference lives on its own physical or legacy evidence row.
    await ctx.tx.update(mailDeliveries).set({ status: input.outcome === "submitted" ? "submitted" : "failed", lastError: null, updatedAt: new Date() }).where(eq(mailDeliveries.id, delivery.id));
    const pending = await ctx.tx.select({ id: mailDispatches.id }).from(mailDispatches).where(and(eq(mailDispatches.deliveryId, delivery.id), inArray(mailDispatches.state, ["running", "unknown"])));
    if (!pending.length && input.outcome === "submitted") await removeSettledMailBody(ctx.tx, delivery.id, held);
    ctx.setSubject("mail_delivery", delivery.id);
    return { deliveryId: delivery.id, outcome: input.outcome, source: "human_provider_confirmation" as const, legacy: !request };
  },
});

/** A new physical caller needs a separate fresh decision after guaranteed no-send. */
export const retryReconciledMail = defineService({
  name: "mail.retryReconciled", summary: "Authorize one new caller only after every original caller is confirmed stopped and not submitted.",
  kind: "mutation", permission: "scoped", agentCallable: false, stepUp: true,
  input: z.object({ deliveryId: z.uuid(), confirmation: z.literal("RETRY THE ORIGINAL MESSAGE") }), output: z.object({ queued: z.literal(true) }),
  auditInputFields: ["deliveryId"],
  handler: async (input, ctx) => {
    requirePerson(ctx.actor); await lockContactIdentityForRead(ctx.tx); await mailReceipts(ctx.tx);
    const [delivery] = await ctx.tx.select().from(mailDeliveries).where(eq(mailDeliveries.id, input.deliveryId)).for("update");
    const [request] = await ctx.tx.select().from(mailDispatchRequests).where(eq(mailDispatchRequests.deliveryId, input.deliveryId));
    const calls = await ctx.tx.select().from(mailDispatches).where(eq(mailDispatches.deliveryId, input.deliveryId));
    if (!delivery || delivery.redactedAt || !request || !calls.length || calls.length !== delivery.attempts || calls.some(row => row.state !== "not_submitted") || request.admittedAttempt !== delivery.attempts || request.admittedAttempt >= 20) throw new ServiceError("conflict", "Every original caller must be stopped with a guaranteed no-submission outcome before retrying.");
    const [body] = await ctx.tx.select({ id: mailOutbox.deliveryId }).from(mailOutbox).where(eq(mailOutbox.deliveryId, delivery.id));
    if (!body) throw new ServiceError("conflict", "The original private message is no longer available. Start a new business request instead.");
    const retired = await ctx.tx.execute<{ found: boolean }>(sql`select exists(select 1 from ${mailRecordSubjects} s join contacts c on c.id=s.contact_id where s.kind='delivery' and s.record_id=${delivery.id} and c.email is null) as found`);
    if (retired[0]?.found) throw new ServiceError("conflict", "This person's original mail was retired by privacy work and cannot be restarted.");
    await ctx.tx.update(mailDispatchRequests).set({ admittedAttempt: request.admittedAttempt + 1 }).where(eq(mailDispatchRequests.deliveryId, delivery.id));
    await ctx.tx.update(mailDeliveries).set({ status: "queued", lastError: null, updatedAt: new Date() }).where(eq(mailDeliveries.id, delivery.id));
    await enqueueJob(ctx.tx, "core.deliverMail", { deliveryId: delivery.id }, { idempotencyKey: `mail-dispatch-retry:${delivery.id}:${request.admittedAttempt + 1}` });
    ctx.setSubject("mail_delivery", delivery.id); return { queued: true as const };
  },
});

const route = dispatchRouteSchema.omit({ authorizationDigest: true });
export const listMailDispatchRecovery = defineService({
  name: "mail.listDispatchRecovery", summary: "Inspect original mail routes and incomplete physical outcomes for fresh human review.",
  kind: "query", permission: "scoped", agentCallable: false, stepUp: true,
  input: z.object({ afterId: z.uuid().optional(), limit: z.number().int().min(1).max(100).default(25) }),
  output: z.object({ rows: z.array(z.object({ deliveryId: z.uuid(), recipient: z.string(), subject: z.string(), provider: z.string(), providerRef: z.string().nullable(), attempts: z.number().int(), retryQueued: z.boolean(), createdAt: timestamp, legacy: z.boolean(), originalRoute: route.nullable(), dispatches: z.array(z.object({ id: z.uuid(), attempt: z.number().int(), state, providerRef: z.string().nullable(), replyProviderRef: z.string().nullable(), initialReviewedAt: timestamp.nullable(), createdAt: timestamp, resolutionSource: z.enum(["adapter", "human_provider_confirmation"]).nullable() })) })), nextCursor: z.uuid().nullable() }),
  handler: async (input, ctx) => {
    requirePerson(ctx.actor);
    const rows = await ctx.tx.select({ delivery: mailDeliveries, request: mailDispatchRequests }).from(mailDeliveries).leftJoin(mailDispatchRequests, eq(mailDispatchRequests.deliveryId, mailDeliveries.id)).where(and(isNull(mailDeliveries.redactedAt), input.afterId ? gt(mailDeliveries.id, input.afterId) : undefined,
      sql`${mailDeliveries.attempts}>0`, sql`(exists(select 1 from ${mailDispatches} where ${mailDispatches.deliveryId}=${mailDeliveries.id} and ${inArray(mailDispatches.state, ["running", "unknown", "not_submitted"])}) or (${mailDispatchRequests.deliveryId} is null and not exists(select 1 from ${mailLegacyResolutions} where ${mailLegacyResolutions.deliveryId}=${mailDeliveries.id})))`,
    )).orderBy(mailDeliveries.id).limit(input.limit + 1);
    const page = rows.slice(0, input.limit);
    return { rows: await Promise.all(page.map(async ({ delivery, request }) => ({ deliveryId: delivery.id, recipient: delivery.recipient, subject: delivery.subject, provider: delivery.provider, providerRef: delivery.providerRef, attempts: delivery.attempts, retryQueued: Boolean(request && request.admittedAttempt > delivery.attempts), createdAt: delivery.createdAt, legacy: !request, originalRoute: request?.encryptedRoute ? publicOriginalMailRoute(readOriginalMailRoute(request.encryptedRoute, delivery.id)) : null,
      dispatches: await ctx.tx.select({ id: mailDispatches.id, attempt: mailDispatches.attempt, state: mailDispatches.state, providerRef: mailDispatches.providerRef, replyProviderRef: mailDispatches.replyProviderRef, initialReviewedAt: mailDispatches.initialReviewedAt, createdAt: mailDispatches.createdAt, resolutionSource: mailDispatches.resolutionSource }).from(mailDispatches).where(eq(mailDispatches.deliveryId, delivery.id)).orderBy(mailDispatches.attempt).limit(20),
    }))), nextCursor: rows.length > input.limit ? page.at(-1)!.delivery.id : null };
  },
});
export default [reconcileMailDispatch, retryReconciledMail, listMailDispatchRecovery];
