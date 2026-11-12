// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Human proof is distinct from the independently observed physical HTTP journal.
import { and, eq, gt } from "drizzle-orm";
import { z } from "zod";
import { timestamp } from "@/core/contract";
import { defineService, hasModuleAccess, ServiceError, type Actor } from "@/core/service";
import { effectiveLeadAttempt, leadCopyEvidenceDigest, leadCopyReceipts } from "./lead-copy-state";
import { formLeadCopies } from "./schema";
function requirePerson(actor: Actor) {
  if (actor.kind !== "user" || actor.keyScopes || !hasModuleAccess(actor, "forms", "manage")) throw new ServiceError("permission", "Sign in as a person with forms management access to review original lead evidence.");
  return actor;
}
export const listLeadCopyRecovery = defineService({
  name: "forms.listLeadCopyRecovery", summary: "Review original lead copies and physical HTTP outcomes without private request bodies or keyed receipts.",
  kind: "query", permission: "scoped", agentCallable: false, stepUp: true,
  input: z.object({ afterId: z.uuid().optional(), limit: z.number().int().min(1).max(100).default(25) }),
  output: z.object({ rows: z.array(z.object({ id: z.uuid(), submissionId: z.uuid().nullable(), originalBaseUrl: z.string().nullable(), originalResourceKnown: z.boolean(), state: z.string(), legacyReview: z.boolean(), legacyReviewOutcomes: z.array(z.enum(["copied", "not_copied"])), revision: z.number().int(), retiredAt: timestamp.nullable(), remoteErasedAt: timestamp.nullable(), privacyPending: z.boolean(), retryAvailable: z.boolean(), lastError: z.string().nullable(), attempts: z.array(z.object({ id: z.uuid(), attempt: z.number().int(), observed: z.enum(["running", "unknown", "copied", "not_copied"]), humanOutcome: z.enum(["copied", "not_copied"]).optional(), reviewOutcomes: z.array(z.enum(["copied", "not_copied"])), httpStatus: z.number().optional() })) })), nextCursor: z.uuid().nullable() }),
  handler: async (input, ctx) => {
    requirePerson(ctx.actor);
    const rows = await ctx.tx.select().from(formLeadCopies).where(and(input.afterId ? gt(formLeadCopies.id, input.afterId) : undefined)).orderBy(formLeadCopies.id).limit(input.limit + 1);
    const page = rows.slice(0, input.limit);
    return { rows: page.map(copy => ({ id: copy.id, submissionId: copy.submissionId, originalBaseUrl: copy.originalBaseUrl, originalResourceKnown: copy.kind === "site_notice" && Boolean(copy.resourceDigest && copy.noticeDigest), state: copy.state, legacyReview: copy.kind === "legacy_review", legacyReviewOutcomes: copy.legacyReviews.map(review => review.outcome), revision: copy.revision, retiredAt: copy.retiredAt, remoteErasedAt: copy.remoteErasedAt, privacyPending: copy.privacyPending, retryAvailable: Boolean(copy.encryptedRequest && !copy.retiredAt && copy.kind === "site_notice" && copy.attempts.length && copy.attempts.every(attempt => effectiveLeadAttempt(attempt) === "not_copied") && copy.attempts.length < 20), lastError: copy.lastError, attempts: copy.attempts.map(({ id, attempt, observed, humanOutcome, httpStatus, reviewHistory }) => ({ id, attempt, observed, humanOutcome, httpStatus, reviewOutcomes: reviewHistory?.map(review => review.outcome) ?? [] })) })), nextCursor: rows.length > input.limit ? page.at(-1)!.id : null };
  },
});
const evidence = z.string().trim().min(20).max(4_000);
export const reconcileLeadCopy = defineService({
  name: "forms.reconcileLeadCopy", summary: "Record verified final original-provider and stopped-caller proof without replacing observed HTTP evidence or contacting a provider.",
  kind: "mutation", permission: "scoped", agentCallable: false, stepUp: true,
  input: z.object({ id: z.uuid(), expectedRevision: z.number().int().min(0), operationId: z.uuid().optional(), outcome: z.enum(["copied", "not_copied"]), originalResourceEvidence: evidence, finalProviderEvidence: evidence, stoppedCallerEvidence: evidence, providerOperationRef: z.string().trim().min(1).max(2_000), remoteErasureEvidence: evidence.optional(), confirmation: z.literal("ORIGINAL LEAD OUTCOME VERIFIED") }),
  output: z.object({ id: z.uuid(), source: z.literal("human_provider_confirmation") }), auditInputFields: ["id", "outcome"],
  handler: async (input, ctx) => {
    const actor = requirePerson(ctx.actor), receipts = await leadCopyReceipts(ctx.tx);
    const [copy] = await ctx.tx.select().from(formLeadCopies).where(eq(formLeadCopies.id, input.id)).for("update");
    const operation = copy?.attempts.find(attempt => attempt.id === input.operationId);
    if (!copy || copy.revision !== input.expectedRevision || (copy.kind !== "legacy_review" && !operation) || (copy.kind === "legacy_review" && input.operationId)) throw new ServiceError("conflict", "The original lead-copy evidence changed; review it again.");
    if (copy.providerRefDigest && copy.providerRefDigest !== receipts.digest("provider:lead-reference", input.providerOperationRef)) throw new ServiceError("conflict", "That reference does not match the original provider's receipt.");
    if (operation && ["copied", "not_copied"].includes(operation.observed) && operation.observed !== input.outcome) throw new ServiceError("conflict", "Human proof cannot contradict the observed original provider reply.");
    const reviewDigest = receipts.digest("provider:lead-review", JSON.stringify({ ...input, actor: actor.userId, operation }));
    const attempts = copy.attempts.map(attempt => attempt.id === operation?.id ? { ...attempt, humanOutcome: input.outcome, reviewDigest, reviewHistory: [...(attempt.reviewHistory ?? []), { outcome: input.outcome, digest: reviewDigest }] } : attempt);
    const legacyOutcome = copy.kind === "legacy_review" ? input.outcome : copy.legacyOutcome;
    const unresolved = attempts.some(attempt => effectiveLeadAttempt(attempt) === "unknown");
    const copied = legacyOutcome === "copied" || attempts.some(attempt => effectiveLeadAttempt(attempt) === "copied");
    await ctx.tx.update(formLeadCopies).set({ attempts, legacyOutcome, ...(copy.kind === "legacy_review" ? { legacyReviews: [...copy.legacyReviews, { outcome: input.outcome, digest: reviewDigest }] } : {}), reviewDigest, state: unresolved ? "unknown" : copied ? "copied" : "not_copied", lastError: unresolved ? copy.lastError : null, ...(input.remoteErasureEvidence && copied ? { remoteErasedAt: copy.remoteErasedAt ?? new Date(), remoteErasureDigest: leadCopyEvidenceDigest({ ...copy, attempts, legacyOutcome }, receipts) } : {}), updatedAt: new Date() }).where(eq(formLeadCopies.id, copy.id));
    ctx.setSubject("form_lead_copy", copy.id);
    return { id: copy.id, source: "human_provider_confirmation" as const };
  },
});
export const retryLeadCopy = defineService({
  name: "forms.retryLeadCopy", summary: "Admit one new frozen original-account copy only after every earlier physical request is proved not copied and stopped.",
  kind: "mutation", permission: "scoped", agentCallable: false, stepUp: true,
  input: z.object({ id: z.uuid(), expectedRevision: z.number().int().min(0), confirmation: z.literal("RETRY ORIGINAL LEAD COPY") }),
  output: z.object({ id: z.uuid() }), auditInputFields: ["id"],
  handler: async (input, ctx) => {
    requirePerson(ctx.actor); await leadCopyReceipts(ctx.tx);
    const [copy] = await ctx.tx.select().from(formLeadCopies).where(eq(formLeadCopies.id, input.id)).for("update");
    if (!copy || copy.revision !== input.expectedRevision || copy.kind !== "site_notice" || copy.retiredAt || !copy.encryptedRequest || !copy.submissionId || !copy.attempts.length || copy.attempts.length >= 20 || copy.attempts.some(attempt => effectiveLeadAttempt(attempt) !== "not_copied")) throw new ServiceError("conflict", "Restore and verify the original not-copied and stopped-caller evidence before retrying.");
    if (copy.admittedAttempt > copy.attempts.length) throw new ServiceError("conflict", "A retry is already admitted; use its original outbox delivery.");
    await ctx.tx.update(formLeadCopies).set({ admittedAttempt: copy.attempts.length + 1, state: "ready", updatedAt: new Date() }).where(eq(formLeadCopies.id, copy.id));
    ctx.setSubject("form_lead_copy", copy.id);
    ctx.queueEvent("forms.leadCopyRequested", { leadCopyId: copy.id, leadRequested: true });
    return { id: copy.id };
  },
});
export default [listLeadCopyRecovery, reconcileLeadCopy, retryLeadCopy];
