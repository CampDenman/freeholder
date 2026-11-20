// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.38/C1.08: independent human stop releases an actual original GET, never invents its finish.
import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { actorString, defineService, ServiceError } from "@/core/service";
import { merchantCallerLiveness, merchantPhysicalCaller } from "@/modules/invoicing/merchant-physical-caller";
import { merchantTaxDigest } from "@/modules/invoicing/merchant-tax-store";
import { payments } from "@/modules/invoicing/schema";
import { providerReaderStopVerdict, signProviderReadProof } from "./provider-read-signatures";
import { PRORATION_CARD_READ_PURPOSE } from "./proration-card-contract";
import { prorationCardCaller, originalProrationCardRead, originalProrationCardReadRows, finishedProrationCardRead, stoppedProrationCardRead } from "./proration-card-read-proof";
import { lockProrationPaymentReadOwner, originalProrationPaymentReadSource } from "./proration-card-read-runtime";
import { subscriptionProrationCardReadFinishes, subscriptionProrationCardReadStops, subscriptionProrationCardReads } from "./proration-card-schema";
import { requireProrationCardSchema } from "./proration-card-mandate";
export const PRORATION_READ_STOP_CONFIRMATION = "ORIGINAL CHANGED-PRICE PAYMENT READ RUNTIME STOP VERIFIED";
const sha = z.string().regex(/^[a-f0-9]{64}$/);
const rowSchema = z.object({ paymentId: z.uuid(), readId: z.uuid(), callerId: z.uuid(), admissionDigest: sha, sourceRevision: sha,
  liveness: z.enum(["live", "absent", "unobservable"]), reviewed: z.boolean() });
export const prorationPaymentReadRecoveryPlan = defineService({ name: "invoicing.prorationPaymentReadRecoveryPlan", summary: "Review every actual original changed-price payment reader on this exact invoice before its independent stop and next bank GET.",
  kind: "query", permission: "scoped", input: z.object({ invoiceId: z.uuid() }), output: z.array(rowSchema).max(5000),
  handler: async ({ invoiceId }, ctx) => {
    const sources = await ctx.tx.select({ id: payments.id }).from(payments).where(eq(payments.invoiceId, invoiceId)).limit(5001);
    if (sources.length > 5000) throw new ServiceError("conflict", "Restore the complete bounded original invoice/payment inventory.");
    const rows = await originalProrationCardReadRows(ctx.tx, sources.map(value => value.id));
    const output: Array<z.infer<typeof rowSchema>> = [];
    for (const row of rows) {
      if (finishedProrationCardRead(row.read, row.finish)) continue;
      const proof = originalProrationCardRead(row.read), source = await originalProrationPaymentReadSource(ctx, row.read.paymentId);
      if (!proof || !source) throw new ServiceError("conflict", "Restore this exact original admission and immutable accepted payment source.");
      const caller = prorationCardCaller.parse(proof.payload.caller);
      output.push(rowSchema.parse({ paymentId: row.read.paymentId, readId: row.read.id, callerId: caller.id, admissionDigest: row.read.admissionDigest,
        sourceRevision: source.sourceRevision, liveness: caller.id === merchantPhysicalCaller().id ? "live" : merchantCallerLiveness(caller), reviewed: stoppedProrationCardRead(row.read, row.stop) }));
    }
    return output;
  },
});
export const reviewProrationPaymentReadStopped = defineService({ name: "invoicing.reviewProrationPaymentReadStopped", summary: "Freshly review an exact original changed-price bank reader's actual hosting stop; API keys and agents cannot approve it.",
  kind: "mutation", permission: "scoped", agentCallable: false, stepUp: true, writeClass: "money", auditInputFields: ["paymentId", "readId", "expectedCallerId", "expectedAdmissionDigest", "expectedSourceRevision"],
  input: z.object({ paymentId: z.uuid(), readId: z.uuid(), expectedCallerId: z.uuid(), expectedAdmissionDigest: sha, expectedSourceRevision: sha,
    hostingEvidence: z.string().trim().min(30).max(2000), stoppedRuntimeReference: z.string().trim().min(8).max(300).optional(), stoppedRuntimeAt: z.iso.datetime().optional(),
    confirmation: z.literal(PRORATION_READ_STOP_CONFIRMATION) }).strict(), output: z.object({ reviewed: z.literal(true), mechanicalCheck: z.enum(["original_process_absent", "unobservable_host_review"]) }),
  handler: async (input, ctx) => {
    if (ctx.actor.kind !== "user" || ctx.actor.keyScopes) throw new ServiceError("permission", "A freshly verified signed-in person must review the actual original reader stop.");
    const source = await lockProrationPaymentReadOwner(ctx, input.paymentId); await requireProrationCardSchema(ctx);
    const [ticket] = await ctx.tx.select().from(subscriptionProrationCardReads).where(eq(subscriptionProrationCardReads.id, input.readId)).limit(1).for("update");
    const original = ticket ? originalProrationCardRead(ticket) : null;
    if (!source || !ticket || !original || ticket.paymentId !== input.paymentId || source.sourceRevision !== original.payload.sourceRevision) throw new ServiceError("conflict", "Restore the exact original signed admission and accepted payment before stop review.");
    const caller = prorationCardCaller.parse(original.payload.caller);
    const [finish] = await ctx.tx.select().from(subscriptionProrationCardReadFinishes).where(eq(subscriptionProrationCardReadFinishes.readId, input.readId)).limit(1);
    const [prior] = await ctx.tx.select().from(subscriptionProrationCardReadStops).where(eq(subscriptionProrationCardReadStops.readId, input.readId)).limit(1);
    if (prior) {
      if (!stoppedProrationCardRead(ticket, prior) || ticket.admissionDigest !== input.expectedAdmissionDigest || caller.id !== input.expectedCallerId || source.sourceRevision !== input.expectedSourceRevision)
        throw new ServiceError("conflict", "Preserve the first actual original stop receipt and reload its exact immutable payment source.");
      return { reviewed: true as const, mechanicalCheck: z.enum(["original_process_absent", "unobservable_host_review"]).parse(prior.proof.payload.mechanicalCheck) };
    }
    const liveness = caller.id === merchantPhysicalCaller().id ? "live" as const : merchantCallerLiveness(caller);
    const verdict = providerReaderStopVerdict({ ...input, actualAdmissionDigest: ticket.admissionDigest, actualSourceRevision: source.sourceRevision, actualCallerId: caller.id,
      finished: !!finish, liveness, runtimeEvidence: !!input.stoppedRuntimeReference && !!input.stoppedRuntimeAt && Date.parse(input.stoppedRuntimeAt) <= Date.now() });
    if (verdict === "live") throw new ServiceError("conflict", "The exact original process birth is still live. Actually stop it or retain its real finish before review.");
    if (verdict === "changed_or_finished") throw new ServiceError("conflict", "The original admission/source changed or actually finished; reload the current recovery plan.");
    if (verdict === "missing_runtime_evidence") throw new ServiceError("conflict", "Supply the actual stopped runtime reference and time from the owner's hosting evidence for this unobservable original birth.");
    const proof = signProviderReadProof("stop_review", { purpose: PRORATION_CARD_READ_PURPOSE, readId: ticket.id, paymentId: ticket.paymentId, prorationId: source.accepted.id,
      requestDigest: original.payload.requestDigest, callerId: caller.id, admissionDigest: ticket.admissionDigest, sourceRevision: source.sourceRevision, originalAdmission: ticket.admission,
      mechanicalCheck: verdict, reviewedBy: actorString(ctx.actor), reviewedAt: new Date().toISOString(), reviewerRuntime: merchantPhysicalCaller(),
      hostingEvidenceDigest: merchantTaxDigest({ hostingEvidence: input.hostingEvidence, stoppedRuntimeReference: input.stoppedRuntimeReference ?? null, stoppedRuntimeAt: input.stoppedRuntimeAt ?? null, originalCaller: caller }) });
    await ctx.tx.execute(sql`select set_config('freeholder.proration_card_v1','1',true)`);
    await ctx.tx.insert(subscriptionProrationCardReadStops).values({ readId: ticket.id, proof, proofDigest: merchantTaxDigest(proof) });
    ctx.setSubject("payment", ticket.paymentId);
    return { reviewed: true as const, mechanicalCheck: verdict };
  },
});
export default [prorationPaymentReadRecoveryPlan, reviewProrationPaymentReadStopped];
