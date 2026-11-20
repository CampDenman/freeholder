// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.38/C1.08: reviewed runtime absence releases a reader, never inventing its finish.
import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { actorString, defineOrchestratedService, defineService, ServiceError, type ServiceContext } from "@/core/service";
import { lockContactIdentity } from "@/core/contacts/identity-lock";
import { merchantCallerLiveness, merchantPhysicalCaller, type MerchantPhysicalCaller } from "@/modules/invoicing/merchant-physical-caller";
import { merchantTaxDigest } from "@/modules/invoicing/merchant-tax-store";
import { subscriptionProviderScheduleOperations, subscriptionProviderScheduleResources } from "./provider-schedule-schema";
import { subscriptionProviderReadStops, subscriptionProviderReadTickets } from "./provider-read-ownership-schema";
import { assertProviderReaderSchema, providerReaderSourceRevision } from "./provider-read-ownership";
import { originalProviderReadAdmission, providerReaderStopVerdict, signProviderReadProof, stoppedProviderRead, verifiedProviderReadProof } from "./provider-read-signatures";
import { recoverMerchantPhaseProduct } from "./provider-phase-product-recovery";
import { recoverMerchantSchedule } from "./provider-schedule-recovery";
import { enqueueMerchantScheduleErasureRepair } from "./provider-schedule-erasure";
export const PROVIDER_READER_STOP_CONFIRMATION = "ORIGINAL SUBSCRIPTION READ RUNTIME STOP VERIFIED";
const sha = z.string().regex(/^[a-f0-9]{64}$/), historySchema = z.array(z.record(z.string(), z.unknown())).max(5000);
const callerSchema = z.object({ id: z.uuid(), pid: z.number().int().positive(), host: z.string().min(1).max(500), startedAt: z.iso.datetime(),
  bootId: z.string().nullable(), pidNamespace: z.string().nullable(), startTicks: z.string().nullable() });
function originalLiveness(admission: Record<string, unknown>) {
  const signed = verifiedProviderReadProof(admission.ownership, "admission"), parsed = callerSchema.safeParse(signed?.payload.caller);
  const caller: MerchantPhysicalCaller | null = parsed.success && parsed.data.id === admission.callerId ? parsed.data : null;
  if (admission.callerId === merchantPhysicalCaller().id) return { liveness: "live" as const, caller };
  return { liveness: caller ? merchantCallerLiveness(caller) : "unobservable" as const, caller };
}
async function original(ctx: ServiceContext, subscriptionId: string, operationId: string) {
  await lockContactIdentity(ctx.tx); await assertProviderReaderSchema(ctx);
  const [resource] = await ctx.tx.select().from(subscriptionProviderScheduleResources).where(eq(subscriptionProviderScheduleResources.subscriptionId, subscriptionId)).limit(1).for("update");
  const [operation] = await ctx.tx.select().from(subscriptionProviderScheduleOperations).where(eq(subscriptionProviderScheduleOperations.id, operationId)).limit(1).for("update");
  if (!resource || !operation || operation.subscriptionId !== subscriptionId || operation.requestDigest !== merchantTaxDigest(operation.originalRequest)) throw new ServiceError("conflict", "Restore the actual original agreement and immutable reader operation before review.");
  return { operation, resource, history: historySchema.parse(operation.providerObservation.history) };
}
const recoveryRow = z.object({ operationId: z.uuid(), readId: z.uuid(), callerId: z.uuid(), admissionDigest: sha, sourceRevision: sha,
  resourceKind: z.enum(["product", "schedule"]),
  liveness: z.enum(["live", "absent", "unobservable"]), historicalBirthUnknown: z.boolean(), reviewed: z.boolean(), canRecover: z.boolean() });
export const providerReaderRecoveryPlan = defineService({
  name: "subscriptions.providerReaderRecoveryPlan", summary: "Review exact original subscription verification readers and independent runtime stop receipts.",
  kind: "query", permission: "scoped", input: z.object({ subscriptionId: z.uuid() }), output: z.array(recoveryRow).max(5000),
  handler: async ({ subscriptionId }, ctx) => {
    await lockContactIdentity(ctx.tx); await assertProviderReaderSchema(ctx);
    const operations = await ctx.tx.select().from(subscriptionProviderScheduleOperations).where(eq(subscriptionProviderScheduleOperations.subscriptionId, subscriptionId)).orderBy(subscriptionProviderScheduleOperations.operationRevision).limit(5001);
    const [resource] = await ctx.tx.select().from(subscriptionProviderScheduleResources).where(eq(subscriptionProviderScheduleResources.subscriptionId, subscriptionId)).limit(1);
    if (!resource || operations.length > 5000) throw new ServiceError("conflict", "Restore the bounded original reader inventory before review.");
    const rows: Array<z.infer<typeof recoveryRow>> = [];
    for (const operation of operations) {
      const history = historySchema.parse(operation.providerObservation.history);
      for (const admission of history) {
        if (!["schedule_read_admitted", "phase_product_read_admitted"].includes(String(admission.source))) continue;
        if (!originalProviderReadAdmission(admission) || admission.operationId !== operation.id || admission.requestDigest !== operation.requestDigest) throw new ServiceError("conflict", "Restore the authentic original signed reader admission before review.");
        if (history.some(entry => ["schedule_read_finished", "phase_product_read_finished"].includes(String(entry.source)) && entry.readId === admission.readId
          && entry.operationId === operation.id && entry.requestDigest === operation.requestDigest && entry.completionDigest === admission.completionDigest)) continue;
        const life = originalLiveness(admission), reviewed = history.some(entry => stoppedProviderRead(admission, entry, subscriptionId));
        rows.push(recoveryRow.parse({ operationId: operation.id, readId: admission.readId, callerId: admission.callerId, admissionDigest: merchantTaxDigest(admission), resourceKind: operation.kind === "create_product" ? "product" : "schedule",
          sourceRevision: providerReaderSourceRevision(operation, resource), liveness: life.liveness, historicalBirthUnknown: !life.caller, reviewed, canRecover: reviewed && resource.recoveryPending }));
        if (rows.length > 5000) throw new ServiceError("conflict", "Restore the complete bounded reader inventory before reviewing any stop.");
      }
    }
    return rows;
  },
});
export const reviewProviderReaderStopped = defineService({
  name: "subscriptions.reviewProviderReaderStopped", summary: "Review an actual original verification runtime stop without inventing a provider return or caller finish.",
  kind: "mutation", permission: "scoped", agentCallable: false, stepUp: true, writeClass: "money", auditInputFields: ["subscriptionId", "operationId", "readId", "expectedCallerId", "expectedAdmissionDigest", "expectedSourceRevision"],
  input: z.object({ subscriptionId: z.uuid(), operationId: z.uuid(), readId: z.uuid(), expectedCallerId: z.uuid(), expectedAdmissionDigest: sha, expectedSourceRevision: sha,
    hostingEvidence: z.string().trim().min(30).max(2000), stoppedRuntimeReference: z.string().trim().min(8).max(300).optional(), stoppedRuntimeAt: z.iso.datetime().optional(),
    confirmation: z.literal(PROVIDER_READER_STOP_CONFIRMATION) }).strict(), output: z.object({ reviewed: z.literal(true), mechanicalCheck: z.enum(["original_process_absent", "unobservable_host_review"]) }),
  handler: async (input, ctx) => {
    if (ctx.actor.kind !== "user" || ctx.actor.keyScopes) throw new ServiceError("permission", "A freshly verified signed-in person must review the original runtime's actual stop; API keys and agents cannot approve it.");
    const { operation, resource, history } = await original(ctx, input.subscriptionId, input.operationId);
    const admissions = history.filter(entry => entry.readId === input.readId && ["schedule_read_admitted", "phase_product_read_admitted"].includes(String(entry.source)));
    const admission = admissions[0];
    if (admissions.length !== 1 || !admission || !originalProviderReadAdmission(admission)) throw new ServiceError("conflict", "Restore this exact original reader admission before reviewing its runtime.");
    const [ticket] = await ctx.tx.select().from(subscriptionProviderReadTickets).where(eq(subscriptionProviderReadTickets.readId, input.readId)).limit(1);
    if (admission.ownership !== undefined && (!ticket || ticket.admissionDigest !== merchantTaxDigest(admission) || merchantTaxDigest(ticket.admission) !== ticket.admissionDigest)) throw new ServiceError("conflict", "Restore the signed original reader's immutable ticket.");
    const [prior] = await ctx.tx.select().from(subscriptionProviderReadStops).where(eq(subscriptionProviderReadStops.readId, input.readId)).limit(1);
    if (prior) {
      if (prior.operationId !== operation.id || prior.proof.payload.admissionDigest !== input.expectedAdmissionDigest || prior.proof.payload.callerId !== input.expectedCallerId) throw new ServiceError("conflict", "Preserve the first exact independent runtime stop receipt.");
      return { reviewed: true as const, mechanicalCheck: z.enum(["original_process_absent", "unobservable_host_review"]).parse(prior.proof.payload.mechanicalCheck) };
    }
    const life = originalLiveness(admission), sourceRevision = providerReaderSourceRevision(operation, resource);
    const runtimeEvidence = !!input.stoppedRuntimeReference && !!input.stoppedRuntimeAt && Date.parse(input.stoppedRuntimeAt) <= Date.now();
    const verdict = providerReaderStopVerdict({ ...input, actualAdmissionDigest: merchantTaxDigest(admission), actualSourceRevision: sourceRevision, actualCallerId: admission.callerId,
      liveness: life.liveness, runtimeEvidence, finished: history.some(entry => entry.readId === input.readId && ["schedule_read_finished", "phase_product_read_finished"].includes(String(entry.source))) });
    if (verdict === "live") throw new ServiceError("conflict", "The exact original process birth is still live. Finish or actually stop that runtime before review.");
    if (verdict === "changed_or_finished") throw new ServiceError("conflict", "The reviewed original admission or current recovery history changed; reload its exact evidence.");
    if (verdict === "missing_runtime_evidence") throw new ServiceError("conflict", "This original birth cannot be observed here. Supply the actual stopped runtime reference and time from the owner's hosting evidence.");
    const reviewedBy = actorString(ctx.actor), proof = signProviderReadProof("stop_review", { readId: input.readId, operationId: operation.id, subscriptionId: operation.subscriptionId,
      requestDigest: operation.requestDigest, callerId: admission.callerId, admissionDigest: merchantTaxDigest(admission), sourceRevision, mechanicalCheck: verdict, reviewedBy,
      originalAdmission: admission,
      hostingEvidenceDigest: merchantTaxDigest({ hostingEvidence: input.hostingEvidence, stoppedRuntimeReference: input.stoppedRuntimeReference ?? null, stoppedRuntimeAt: input.stoppedRuntimeAt ?? null, originalCaller: life.caller }), reviewedAt: new Date().toISOString(), reviewerRuntime: merchantPhysicalCaller() });
    const receiptDigest = merchantTaxDigest(proof);
    await ctx.tx.execute(sql`select set_config('freeholder.subscription_provider_read_v1','1',true),set_config('freeholder.subscription_schedule_v1','1',true)`);
    await ctx.tx.insert(subscriptionProviderReadStops).values({ readId: input.readId, operationId: operation.id, subscriptionId: operation.subscriptionId, proof, proofDigest: receiptDigest });
    await ctx.tx.update(subscriptionProviderScheduleOperations).set({ state: "unknown", providerObservation: { ...operation.providerObservation,
      history: [...history, { source: "provider_read_stop_reviewed", operationId: operation.id, requestDigest: operation.requestDigest, readId: input.readId, receiptDigest, proof }] } }).where(eq(subscriptionProviderScheduleOperations.id, operation.id));
    await ctx.tx.update(subscriptionProviderScheduleResources).set({ recoveryPending: true, stoppedProof: null, evidenceRevision: resource.evidenceRevision + 1, updatedAt: new Date() }).where(eq(subscriptionProviderScheduleResources.subscriptionId, operation.subscriptionId));
    await enqueueMerchantScheduleErasureRepair(ctx.tx, { subscriptionId: operation.subscriptionId, evidenceDigest: receiptDigest });
    ctx.setSubject("subscription", operation.subscriptionId); return { reviewed: true as const, mechanicalCheck: verdict };
  },
});
export const recoverProviderReader = defineOrchestratedService({
  name: "subscriptions.recoverProviderReader", summary: "Read the original stopped verification resource through a newly admitted physical GET; never POST or fabricate a finish.",
  kind: "mutation", permission: "scoped", stepUp: true, writeClass: "money", input: z.object({ subscriptionId: z.uuid(), operationId: z.uuid() }), output: z.object({ verified: z.boolean() }),
  handler: async (input, actor) => {
    const plan = await providerReaderRecoveryPlan.call({ subscriptionId: input.subscriptionId }, actor);
    const row = plan.find(value => value.operationId === input.operationId && value.canRecover);
    if (!row || plan.some(value => value.operationId === input.operationId && !value.reviewed)) throw new ServiceError("conflict", "Review every original outstanding reader's actual runtime stop before a fresh GET.");
    return row.resourceKind === "product" ? recoverMerchantPhaseProduct.call({ operationId: row.operationId }, { kind: "system", request: actor.request })
      : recoverMerchantSchedule.call({ operationId: row.operationId }, { kind: "system", request: actor.request });
  },
});
export default [providerReaderRecoveryPlan, reviewProviderReaderStopped, recoverProviderReader];
