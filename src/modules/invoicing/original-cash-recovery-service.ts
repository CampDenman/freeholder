// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.38/C1.08: original cash, real physical callers, independently committed facts.
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { and, desc, eq, or, sql } from "drizzle-orm";
import { z } from "zod";
import { actorString, defineService, ServiceError, type ServiceContext } from "@/core/service";
import { subscriptionMerchantScopes, subscriptionProviderChargeReceipts } from "@/modules/subscriptions/schema";
import { merchantFeeRefunds, merchantPaymentObservations } from "./merchant-collection-schema";
import { merchantRefundCashHistory } from "./merchant-refund-history";
import { lockMerchantRefundCash, merchantRefundSource, originalMerchantRefundCash } from "./merchant-refund-origin";
import { merchantPhysicalCaller, merchantCallerLiveness } from "./merchant-physical-caller";
import { merchantReturnedCashEvidenceSchema } from "./merchant-returned-cash-contract";
import { merchantReturnedCashProof } from "./merchant-returned-cash-proof";
import { merchantTaxDigest } from "./merchant-tax-store";
import { queueOriginalMerchantRefundRepair } from "./merchant-refund-privacy-repair";
import { merchantCashAuxiliaryBody } from "@/adapters/payments/stripe-cash-auxiliary";
import type { MerchantCashAuxiliaryRequest } from "@/adapters/payments/merchant-cash-auxiliary-types";
import { originalCashRecoveries, originalCashRecoveryOperations, originalCashRecoveryFacts, originalCashRecoveryClosures } from "./original-cash-recovery-schema";
import { cashNamespaceKey, exactCashResourceRefs, ORIGINAL_CASH_STOP_CONFIRMATION, remainingOriginalCashAuxiliary, signOriginalCashRecovery } from "./original-cash-recovery-proof";
import { originalCashEvidenceKeys, originalCashOperationFacts, originalCashRecoveryCashWitness, originalCashRecoveryOperation, originalCashRecoveryOwner, originalCashSigningKey } from "./original-cash-recovery-store";
import { verifyOriginalCashRecovery } from "./original-cash-recovery-proof";
import { claimMerchantRefundRequest, merchantRefundRequestRow } from "./merchant-refund-request";
import { recordMerchantRefundObservation } from "./merchant-refund-observations";
import { merchantRefundRequests, merchantRefundDispatches, merchantRefundResourceBindings } from "./merchant-refund-schema";
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const id = z.object({ recoveryId: z.uuid() }).strict();
const claimResult = z.object({ recoveryId: z.uuid(), operationId: z.uuid(), nonce: z.string(), request: z.record(z.string(), z.unknown()) });
type FactKind = typeof originalCashRecoveryFacts.$inferInsert.kind;
type Holder = { recoveryId: string; nonce: string; facts: Map<string, { kind: FactKind; evidence: Record<string, unknown> }>; outcome?: "returned" | "threw" };
const slot = Symbol.for("freeholder.original-cash-return.actual-callers.v1");
const globals = globalThis as typeof globalThis & { [slot]?: Map<string, Holder> };
const held = globals[slot] ??= new Map<string, Holder>();
const json = (value: unknown) => z.record(z.string(), z.unknown()).parse(JSON.parse(JSON.stringify(value)));
function human(ctx: ServiceContext) { if (ctx.actor.kind !== "user" || ctx.actor.keyScopes) throw new ServiceError("permission", "A freshly verified signed-in person must review this exact original cash."); return actorString(ctx.actor); }
async function write(ctx: ServiceContext) {
  const [ready] = await ctx.tx.execute<{ ready: boolean }>(sql`select count(*)=4 ready from pg_trigger where not tgisinternal and tgenabled in ('O','A') and tgname='original_cash_recovery_guard'
    and tgrelid in(to_regclass('original_cash_recoveries'),to_regclass('original_cash_recovery_operations'),to_regclass('original_cash_recovery_facts'),to_regclass('original_cash_recovery_closures'))`);
  if (!ready?.ready) throw new ServiceError("conflict", "Install the complete original cash-return guards before admitting financial work.");
  await ctx.tx.execute(sql`select set_config('freeholder.original_cash_recovery_v1','1',true)`);
}
async function bound(ctx: ServiceContext, recoveryId: string) {
  const owner = await originalCashRecoveryOwner(ctx.tx, recoveryId), cash = await originalMerchantRefundCash(ctx, owner.owner.source);
  await lockMerchantRefundCash(ctx, cash);
  const actual = await originalMerchantRefundCash(ctx, owner.owner.source);
  if (merchantTaxDigest({ ...actual, applied: owner.owner.cash.applied }) !== merchantTaxDigest(owner.owner.cash)
    || actual.applied !== owner.owner.cash.applied) throw new ServiceError("conflict", "Restore this original cash namespace and canonical application before returning money; do not rebind its receipt.");
  return { owner, cash: actual };
}
export async function originalCashRecoveryRevision(ctx: ServiceContext, recoveryId: string, excludedRead?: string) {
  const { cash } = await bound(ctx, recoveryId), history = await merchantRefundCashHistory(ctx, cash, undefined, excludedRead);
  if (history.incomplete) throw new ServiceError("conflict", "Restore the complete original cash/caller inventory before current return proof.");
  return { cash, history, revision: merchantTaxDigest({ cash, history: history.digest }) };
}
async function appendFact(ctx: ServiceContext, recoveryId: string, operationId: string | null, kind: FactKind, evidence: Record<string, unknown>, factId = randomUUID()) {
  const [prior] = await ctx.tx.select().from(originalCashRecoveryFacts).where(eq(originalCashRecoveryFacts.id, factId));
  const [last] = prior ? [] : await ctx.tx.select({ sequence: originalCashRecoveryFacts.sequence }).from(originalCashRecoveryFacts).where(eq(originalCashRecoveryFacts.recoveryId, recoveryId)).orderBy(desc(originalCashRecoveryFacts.sequence)).limit(1);
  const sequence = prior?.sequence ?? (last?.sequence ?? 0) + 1;
  const createdAt = new Date(), body = { recoveryId, operationId, sequence, kind, evidence: json(evidence) }, digest = merchantTaxDigest(body);
  const row = { id: factId, ...body, digest, createdAt, authentication: signOriginalCashRecovery("fact", { id: factId, digest, createdAt }, originalCashSigningKey()) };
  if (prior) { if (prior.digest !== digest || !verifyOriginalCashRecovery("fact", prior, body, originalCashEvidenceKeys())) throw new ServiceError("conflict", "Preserve the corrupt original cash fact and restore its authentication."); return; }
  await write(ctx); await ctx.tx.insert(originalCashRecoveryFacts).values(row);
  queueOriginalMerchantRefundRepair(ctx, { kind: "original_cash_fact", id: factId });
}
async function admit(ctx: ServiceContext, recoveryId: string, kind: "inspection" | "fee" | "recipient", request: Record<string, unknown>, operationId = randomUUID()) {
  const nonce = randomBytes(32).toString("base64url"), createdAt = new Date(), caller = merchantPhysicalCaller();
  const body = { recoveryId, kind, request: json(request), caller, nonceHash: hash(nonce) }, digest = merchantTaxDigest(body);
  await write(ctx); await ctx.tx.insert(originalCashRecoveryOperations).values({ id: operationId, ...body, digest, createdAt,
    authentication: signOriginalCashRecovery("operation", { id: operationId, digest, createdAt }, originalCashSigningKey()) });
  queueOriginalMerchantRefundRepair(ctx, { kind: "original_cash_operation", id: operationId });
  return { recoveryId, operationId, nonce, request: body.request };
}
export const claimOriginalCashRecovery = defineService({
  name: "invoicing.claimOriginalCashRecovery", summary: "Freeze the actual original positive cash owner without creating a local payment or refund.",
  kind: "mutation", permission: "system", external: false, writeClass: "money",
  input: z.object({ source: merchantRefundSource, authorizedBy: z.string().min(1) }).strict(), output: id,
  handler: async ({ source, authorizedBy }, ctx) => {
    const initial = await originalMerchantRefundCash(ctx, source); await lockMerchantRefundCash(ctx, initial);
    const cash = await originalMerchantRefundCash(ctx, source), namespaceKey = cashNamespaceKey(cash);
    const [prior] = await ctx.tx.select().from(originalCashRecoveries).where(eq(originalCashRecoveries.namespaceKey, namespaceKey));
    if (prior) {
      if (prior.paymentId !== cash.paymentId || prior.subscriptionChargeReceiptId !== cash.subscriptionChargeReceiptId
        || merchantTaxDigest(prior.owner.source) !== merchantTaxDigest(source)) throw new ServiceError("conflict", "This cash namespace already has its exact original source receipt. Do not adopt another observation, payment or equal resource into its recovery.");
      await bound(ctx, prior.id); return { recoveryId: prior.id };
    }
    let recipientAccountId: string | null;
    if (source.kind === "subscription") {
      const [record] = await ctx.tx.select({ scope: subscriptionMerchantScopes, receipt: subscriptionProviderChargeReceipts }).from(subscriptionProviderChargeReceipts)
        .innerJoin(subscriptionMerchantScopes, eq(subscriptionMerchantScopes.subscriptionId, subscriptionProviderChargeReceipts.subscriptionId)).where(eq(subscriptionProviderChargeReceipts.id, source.receiptId));
      if (!record || record.scope.providerPlatformAccountId !== cash.providerPlatformAccountId || record.scope.chargeAccountId !== cash.chargeAccountId) throw new ServiceError("conflict", "Restore the authentic original agreement namespace before cash recovery.");
      const observedRecipient = cash.chargeAccountId ?? record.receipt.actualDestinationAccountId;
      recipientAccountId = observedRecipient === record.scope.recipientAccountId ? observedRecipient : null;
    } else {
      const [actual] = await ctx.tx.select().from(merchantPaymentObservations).where(eq(merchantPaymentObservations.id, cash.originalObservationId!));
      if (!actual || actual.paymentId !== source.paymentId || actual.providerApiVersion === null || actual.providerApiVersion !== cash.providerApiVersion
        || !["2026-02-25.clover", "2026-10-28.endive"].includes(actual.providerApiVersion)) throw new ServiceError("conflict", "Restore the actual retained original provider protocol; cash recovery cannot guess an unknown create namespace from today's route.");
      recipientAccountId = actual.chargeAccountId ?? actual.recipientAccountId;
    }
    const recoveryId = randomUUID(), createdAt = new Date(), owner = { source, cash, recipientAccountId, authorizedBy, authorizedAt: createdAt.toISOString() };
    const body = { namespaceKey, paymentId: cash.paymentId, subscriptionChargeReceiptId: cash.subscriptionChargeReceiptId, owner }, digest = merchantTaxDigest(body);
    await write(ctx); await ctx.tx.insert(originalCashRecoveries).values({ id: recoveryId, ...body, digest, createdAt,
      authentication: signOriginalCashRecovery("owner", { id: recoveryId, digest, createdAt }, originalCashSigningKey()) });
    queueOriginalMerchantRefundRepair(ctx, { kind: "original_cash_owner", id: recoveryId });
    return { recoveryId };
  },
});
export const claimOriginalCashInspection = defineService({
  name: "invoicing.claimOriginalCashInspection", summary: "Admit a distinct actual original-cash GET caller, after each prior creator and reader finishes or is reviewed stopped.",
  kind: "mutation", permission: "system", external: false, writeClass: "money", input: id.extend({ auxiliaryOperationId: z.uuid().optional() }), output: claimResult,
  handler: async ({ recoveryId, auxiliaryOperationId }, ctx) => {
    const current = await originalCashRecoveryRevision(ctx, recoveryId);
    if (!current.history.creatorsQuiesced) throw new ServiceError("conflict", "The original caller remains unfinished; finish it or review its actual hosting stop before another GET.");
    if (auxiliaryOperationId) {
      const original = await originalCashRecoveryOperation(ctx.tx, auxiliaryOperationId);
      if (original.recoveryId !== recoveryId || original.kind === "inspection") throw new ServiceError("conflict", "An auxiliary GET must follow its exact original physical admission.");
    }
    return admit(ctx, recoveryId, "inspection", { sourceRevision: current.revision, ...(auxiliaryOperationId ? { auxiliaryOperationId } : {}) });
  },
});
export const recordOriginalCashFact = defineService({
  name: "invoicing.recordOriginalCashFact", summary: "Commit only actual server-held callback or wrapper completion, before later financial policy.",
  kind: "mutation", permission: "system", external: false, writeClass: "money", auditInputFields: ["operationId", "factId"],
  input: z.object({ operationId: z.uuid(), nonce: z.string(), factId: z.uuid() }).strict(), output: z.object({ retained: z.literal(true) }),
  handler: async ({ operationId, nonce, factId }, ctx) => {
    const local = held.get(operationId), fact = local?.facts.get(factId);
    if (!local || local.nonce !== nonce || !fact) throw new ServiceError("permission", "Only this actual original physical caller can retain its observed facts.");
    const original = await originalCashRecoveryOperation(ctx.tx, operationId);
    if (original.nonceHash !== hash(nonce) || original.caller.id !== merchantPhysicalCaller().id || original.recoveryId !== local.recoveryId) throw new ServiceError("permission", "Restore the exact admitted original caller before its private persistence phase.");
    const owner = await originalCashRecoveryOwner(ctx.tx, local.recoveryId); await lockMerchantRefundCash(ctx, owner.owner.cash);
    await appendFact(ctx, local.recoveryId, operationId, fact.kind, fact.evidence, factId);
    return { retained: true as const };
  },
});
export async function performOriginalCashRecovery<T>(claim: z.infer<typeof claimResult>, work: (observe: (kind: "primary" | "refund" | "state" | "parent" | "ack" | "resource", value: unknown) => Promise<void>) => Promise<T>): Promise<T> {
  const local: Holder = { recoveryId: claim.recoveryId, nonce: claim.nonce, facts: new Map() }; held.set(claim.operationId, local);
  const observe = async (kind: "primary" | "refund" | "state" | "parent" | "ack" | "resource", value: unknown) => {
    const factId = randomUUID(); local.facts.set(factId, { kind, evidence: json(value) });
    await recordOriginalCashFact.call({ operationId: claim.operationId, nonce: claim.nonce, factId }, { kind: "system" });
  };
  try { const result = await work(observe); local.outcome = "returned"; return result; }
  catch (error) { local.outcome = "threw"; throw error; }
  finally {
    const factId = randomUUID(); local.facts.set(factId, { kind: "finish", evidence: { callerInstanceId: merchantPhysicalCaller().id, outcome: local.outcome ?? "threw" } });
    // Do not discard primary facts whose first persistence failed. Flush every
    // actually held packet before its actual finish, without another I/O.
    for (const pendingId of local.facts.keys()) await recordOriginalCashFact.call({ operationId: claim.operationId, nonce: claim.nonce, factId: pendingId }, { kind: "system" });
    held.delete(claim.operationId);
  }
}
export async function flushOriginalCashRecovery(recoveryId: string) {
  for (const [operationId, local] of held) if (local.recoveryId === recoveryId && local.outcome) {
    for (const factId of local.facts.keys()) await recordOriginalCashFact.call({ operationId, nonce: local.nonce, factId }, { kind: "system" });
    held.delete(operationId);
  }
}
export async function currentOriginalCashInventory(ctx: ServiceContext, recoveryId: string, operationId: string) {
  const operation = await originalCashRecoveryOperation(ctx.tx, operationId);
  if (operation.recoveryId !== recoveryId || operation.kind !== "inspection" || operation.request.auxiliaryOperationId) throw new ServiceError("conflict", "Use the exact finished original cash-inventory GET.");
  const facts = await originalCashOperationFacts(ctx.tx, operation.id), finish = facts.find(fact => fact.kind === "finish");
  if (finish?.evidence.outcome !== "returned" || finish.evidence.callerInstanceId !== operation.caller.id) throw new ServiceError("conflict", "Retain the actual returned complete original inventory; a hosting stop is not a returned bank snapshot.");
  const current = await originalCashRecoveryRevision(ctx, recoveryId, operationId);
  if (current.revision !== operation.request.sourceRevision) throw new ServiceError("conflict", "The original cash inventory changed during this GET. Retain its facts and inspect it again.");
  const evidence = merchantReturnedCashEvidenceSchema.parse(facts.filter(fact => fact.kind === "state").at(-1)?.evidence);
  const proof = merchantReturnedCashProof({ original: { ...current.cash, paymentProviderRef: current.cash.providerRef }, evidence,
    creatorsQuiesced: current.history.creatorsQuiesced, inventoryStable: true });
  return { ...current, evidence, proof };
}
export const claimOriginalCashAuxiliary = defineService({
  name: "invoicing.claimOriginalCashAuxiliary", summary: "Admit one exact original fee or recipient return after full customer-cash confirmation and actual caller quiescence.",
  kind: "mutation", permission: "system", external: false, writeClass: "money", input: id.extend({ operationId: z.uuid(), kind: z.enum(["fee", "recipient"]) }), output: claimResult.nullable(),
  handler: async ({ recoveryId, operationId, kind }, ctx) => {
    const { owner, cash } = await bound(ctx, recoveryId);
    const witness = await originalCashRecoveryCashWitness(ctx.tx, cash), prior = witness.operations.find(operation => operation.kind === kind);
    if (prior) return null; // A retained admission grants GET recovery only.
    const current = await currentOriginalCashInventory(ctx, recoveryId, operationId);
    if (current.history.feeDebt || current.proof.debt.some(debt => debt !== "commission" && debt !== "recipient")) throw new ServiceError("conflict", "Restore full original customer return, actual callers and earlier fee-operation hosting evidence before auxiliary money.");
    const resource = kind === "fee" ? current.evidence.fee : current.evidence.transfer;
    if (!resource) return null;
    const returned = kind === "fee" ? current.evidence.fee?.refundedMinor : current.evidence.transfer?.reversedMinor;
    const amount = remainingOriginalCashAuxiliary(resource.amountMinor, returned ?? null);
    const account = kind === "fee" ? current.evidence.fee?.accountId : current.evidence.transfer?.destinationAccountId;
    const charge = kind === "fee" ? current.evidence.fee?.originatingChargeRef : current.evidence.transfer?.sourceChargeRef;
    if (amount === null || !resource.currency || !owner.owner.recipientAccountId || account !== owner.owner.recipientAccountId || charge !== current.evidence.providerChargeRef) throw new ServiceError("conflict", "Restore the actual original auxiliary resource, account, charge, money and currency; never assume a conversion.");
    if (!amount) return null;
    const auxiliaryId = randomUUID(), request = { kind, operationId: auxiliaryId, providerPlatformAccountId: cash.providerPlatformAccountId,
      providerApiVersion: cash.providerApiVersion, originalChargeRef: current.evidence.providerChargeRef, originalAccountId: account,
      parentRef: resource.providerRef, originalAmountMinor: resource.amountMinor, alreadyReturnedMinor: returned, amountMinor: amount, currency: resource.currency,
      idempotencyKey: `original-cash-auxiliary:${auxiliaryId}`, frozenBody: merchantCashAuxiliaryBody(auxiliaryId, amount) };
    return admit(ctx, recoveryId, kind, request, auxiliaryId);
  },
});
export const originalCashAuxiliaryRequest = z.object({ kind: z.enum(["fee", "recipient"]), operationId: z.uuid(), providerPlatformAccountId: z.string(),
  providerApiVersion: z.enum(["2026-02-25.clover", "2026-10-28.endive"]), originalChargeRef: z.string(), originalAccountId: z.string(), parentRef: z.string(),
  originalAmountMinor: z.number().int().positive(), alreadyReturnedMinor: z.number().int().min(0), amountMinor: z.number().int().positive(), currency: z.string(), idempotencyKey: z.string(), frozenBody: z.string() }).strict();
export async function originalCashAuxiliaryRecoveryRequest(ctx: ServiceContext, recoveryId: string, operationId: string): Promise<Omit<MerchantCashAuxiliaryRequest, "onResourceAcknowledged" | "onResourceObserved" | "onParentObserved">> {
  await bound(ctx, recoveryId); const original = await originalCashRecoveryOperation(ctx.tx, operationId);
  if (original.recoveryId !== recoveryId || original.kind === "inspection") throw new ServiceError("conflict", "Restore the exact original auxiliary caller before GET recovery.");
  const witness = await originalCashRecoveryCashWitness(ctx.tx, (await bound(ctx, recoveryId)).cash);
  const facts = witness.facts.filter(fact => fact.operationId === operationId || fact.evidence.auxiliaryOperationId === operationId), refs = exactCashResourceRefs(facts);
  if (!refs || refs.length > 1) throw new ServiceError("conflict", "Preserve all actual auxiliary ACKs; ambiguous resources cannot be chosen by equal money.");
  return { ...originalCashAuxiliaryRequest.parse(original.request), ...(refs[0] ? { originalResourceRef: refs[0] } : {}) };
}
export const reviewOriginalCashCallerStopped = defineService({
  name: "invoicing.reviewOriginalCashCallerStopped", summary: "Record fresh human hosting-stop evidence for one exact original physical cash-return caller without inventing a wrapper finish.",
  kind: "mutation", permission: "scoped", stepUp: true, agentCallable: false, writeClass: "money", auditInputFields: ["operationId", "expectedDigest"],
  input: z.object({ operationId: z.uuid(), expectedDigest: z.string().length(64), callerId: z.uuid(), hostingEvidence: z.string().trim().min(30).max(2000), confirmation: z.literal(ORIGINAL_CASH_STOP_CONFIRMATION) }).strict(), output: z.object({ reviewed: z.literal(true) }),
  handler: async (input, ctx) => {
    const reviewedBy = human(ctx), operation = await originalCashRecoveryOperation(ctx.tx, input.operationId), owner = await originalCashRecoveryOwner(ctx.tx, operation.recoveryId);
    await lockMerchantRefundCash(ctx, owner.owner.cash);
    if (operation.digest !== input.expectedDigest || operation.caller.id !== input.callerId || merchantCallerLiveness(operation.caller) === "live") throw new ServiceError("conflict", "The exact original process is still live or changed. Stop it before recording hosting evidence.");
    const facts = await originalCashOperationFacts(ctx.tx, operation.id);
    if (!facts.some(fact => fact.kind === "finish" || fact.kind === "stop")) await appendFact(ctx, operation.recoveryId, operation.id, "stop", { operationDigest: operation.digest,
      callerInstanceId: operation.caller.id, mechanicalCheck: merchantCallerLiveness(operation.caller), reviewedBy, hostingEvidenceDigest: hash(input.hostingEvidence) });
    return { reviewed: true as const };
  },
});
export const reviewOriginalCashLegacyFeeStopped = defineService({
  name: "invoicing.reviewOriginalCashLegacyFeeStopped", summary: "Review an exact existing fee operation's hosting stop now; missing historical process identity remains unknown, never backfilled.",
  kind: "mutation", permission: "scoped", stepUp: true, agentCallable: false, writeClass: "money", auditInputFields: ["recoveryId", "feeOperationId", "expectedDigest"],
  input: id.extend({ feeOperationId: z.uuid(), expectedDigest: z.string().length(64), hostingEvidence: z.string().trim().min(30).max(2000), confirmation: z.literal(ORIGINAL_CASH_STOP_CONFIRMATION) }).strict(), output: z.object({ reviewed: z.literal(true) }),
  handler: async (input, ctx) => {
    const reviewedBy = human(ctx), { cash } = await bound(ctx, input.recoveryId);
    const [fee] = await ctx.tx.select().from(merchantFeeRefunds).where(and(eq(merchantFeeRefunds.id, input.feeOperationId), or(
      ...(cash.paymentId ? [eq(merchantFeeRefunds.paymentId, cash.paymentId)] : []), ...(cash.subscriptionChargeReceiptId ? [eq(merchantFeeRefunds.originalChargeReceiptId, cash.subscriptionChargeReceiptId)] : []))));
    if (!fee || fee.providerPlatformAccountId !== cash.providerPlatformAccountId || merchantTaxDigest(fee) !== input.expectedDigest) throw new ServiceError("conflict", "Restore the exact original fee operation before its explicit hosting review.");
    await appendFact(ctx, input.recoveryId, null, "legacy_fee_stop", { originalFeeOperationId: fee.id, originalFeeDigest: input.expectedDigest,
      originalCaller: null, mechanicalCheck: "historical_birth_unknown_human_hosting_review", reviewedBy, hostingEvidenceDigest: hash(input.hostingEvidence) });
    return { reviewed: true as const };
  },
});
export const claimOriginalUnappliedCashRefund = defineService({
  name: "invoicing.claimOriginalUnappliedCashRefund", summary: "Reserve only actual remaining original receipt-owned cash, with explicit exact failed-parent lineage and no invented logical refund.",
  kind: "mutation", permission: "system", external: false, writeClass: "money", input: id.extend({ operationId: z.uuid(), authorizedBy: z.string().min(1) }), output: merchantRefundRequestRow.nullable(),
  handler: async ({ recoveryId, operationId, authorizedBy }, ctx) => {
    const { owner, cash } = await bound(ctx, recoveryId);
    if (cash.applied) return null; // Applied payments keep their actual ordinary refund/credit lifecycle.
    const prior = await ctx.tx.select().from(merchantRefundRequests).where(and(eq(merchantRefundRequests.providerPlatformAccountId, cash.providerPlatformAccountId),
      sql`${merchantRefundRequests.chargeAccountId} is not distinct from ${cash.chargeAccountId}`, eq(merchantRefundRequests.originalPaymentRef, cash.providerRef))).limit(5001);
    if (prior.length > 5000) throw new ServiceError("conflict", "Restore complete original refund capacity before another cash-return generation.");
    const own = prior.filter(row => row.idempotencyKey.startsWith(`original-cash-return:${recoveryId}:`));
    // A previously retained reservation is never recreated or reassigned.
    const unsubmitted = [];
    for (const request of own) {
      const calls = await ctx.tx.select().from(merchantRefundDispatches).where(eq(merchantRefundDispatches.requestId, request.id)).limit(2);
      if (!calls.length) unsubmitted.push(request);
    }
    if (unsubmitted.length > 1) throw new ServiceError("conflict", "Restore the one original retained cash-return reservation.");
    const current = await currentOriginalCashInventory(ctx, recoveryId, operationId);
    if (!current.history.creatorsQuiesced || current.proof.debt.some(debt => !["customer_refund", "commission", "recipient"].includes(debt))) throw new ServiceError("conflict", "Restore the exact positive cash, complete inventory and finished callers before a return.");
    const resources = current.evidence.refunds;
    if (!current.evidence.refundsComplete || resources.some(row => !["succeeded", "failed", "canceled"].includes(row.status ?? "unknown"))) throw new ServiceError("conflict", "A nullable, action or pending original refund still owns its reservation.");
    const returned = resources.filter(row => row.status === "succeeded").reduce((sum, row) => sum + BigInt(row.amountMinor ?? 0), 0n);
    if (returned !== BigInt(current.evidence.amountRefundedMinor ?? -1) || returned > BigInt(cash.amountMinor)) throw new ServiceError("conflict", "Retain the actual contradictory returned cash; never clamp it or add another key.");
    if (returned === BigInt(cash.amountMinor)) return null;
    if (unsubmitted[0]) {
      if (BigInt(unsubmitted[0].amountMinor) !== BigInt(cash.amountMinor) - returned) throw new ServiceError("conflict", "The actual remaining cash changed after its original reservation. Review and retire that exact unsubmitted reservation before authorizing a new amount.");
      return merchantRefundRequestRow.parse(unsubmitted[0]);
    }
    let parent: string | null = null;
    const lineage = await originalCashRecoveryCashWitness(ctx.tx, cash), visited = new Set<string>();
    while (visited.size < own.length) {
      const request = own.find(row => row.idempotencyKey === `original-cash-return:${recoveryId}:${parent ?? "initial"}`);
      if (!request || visited.has(request.id) || !lineage.facts.some(fact => fact.kind === "customer_request" && fact.evidence.requestId === request.id
        && fact.evidence.parentRequestId === parent && fact.evidence.requestDigest === request.requestDigest)) throw new ServiceError("conflict", "Restore the exact signed original cash-return generations; do not adopt a same-amount refund or invent a missing parent.");
      visited.add(request.id);
      const bindings = await ctx.tx.select().from(merchantRefundResourceBindings).where(eq(merchantRefundResourceBindings.requestId, request.id)).limit(5001);
      const refs = [...new Set(bindings.map(row => row.providerRef))];
      const actual = refs.length === 1 ? resources.find(row => row.providerRef === refs[0]) : null;
      if (!actual || actual.amountMinor !== request.amountMinor || actual.currency !== request.currency || !["failed", "canceled"].includes(actual.status ?? "unknown")) throw new ServiceError("conflict", "The exact prior cash-return request is unresolved or already positive; equal resources cannot replace it.");
      parent = request.id;
    }
    // Shared capacity learns actual dashboard resources from this already
    // committed authentic inventory, never amounts supplied by the caller.
    for (const resource of resources) {
      if (resource.amountMinor === null || resource.currency === null) throw new ServiceError("conflict", "Restore each actual original refund's money before capacity reconciliation.");
      await ctx.callAsSystem(recordMerchantRefundObservation, { source: owner.owner.source, evidence: { providerRef: resource.providerRef, paymentProviderRef: resource.paymentProviderRef,
        providerChargeRef: resource.chargeRef ?? undefined, providerPlatformAccountId: cash.providerPlatformAccountId, providerAccountId: cash.chargeAccountId ?? undefined,
        providerApiVersion: cash.providerApiVersion, amountMinor: resource.amountMinor, currency: resource.currency,
        status: resource.status, bindingVerified: false }, captureKey: merchantTaxDigest({ recoveryId, operationId, resourceRef: resource.providerRef }) });
    }
    const request = await ctx.callAsSystem(claimMerchantRefundRequest, { source: owner.owner.source, amountMinor: Number(BigInt(cash.amountMinor) - returned),
      reason: "Return the actual original unapplied cash to its original payer", idempotencyKey: `original-cash-return:${recoveryId}:${parent ?? "initial"}`, initiatedBy: authorizedBy });
    if (request.refundId !== null || request.purpose !== "unapplied_return") throw new ServiceError("conflict", "Receipt-owned cash cannot acquire a fabricated canonical refund.");
    // This is a new signed authorization occurrence, not a reconstructed old
    // creator, resource assignment, finish or credit.
    await appendFact(ctx, recoveryId, null, "customer_request", { requestId: request.id, parentRequestId: parent, requestDigest: request.requestDigest, originalInventoryOperationId: operationId, authorizedBy });
    return request;
  },
});
export const originalCashRecoveryPhase = defineService({
  name: "invoicing.originalCashRecoveryPhase", summary: "Read only the authentic original cash namespace and its exact admitted auxiliary work for orchestration.",
  kind: "query", permission: "system", external: false, input: id.extend({ auxiliaryOperationId: z.uuid().optional() }),
  output: z.object({ source: merchantRefundSource, applied: z.boolean(), platform: z.string(), account: z.string().nullable(), paymentRef: z.string(),
    apiVersion: z.enum(["2026-02-25.clover", "2026-10-28.endive"]), auxiliaryIds: z.array(z.uuid()).max(5000), auxiliaryRequest: originalCashAuxiliaryRequest.extend({ originalResourceRef: z.string().optional() }).nullable() }),
  handler: async ({ recoveryId, auxiliaryOperationId }, ctx) => {
    const { owner, cash } = await bound(ctx, recoveryId), witness = await originalCashRecoveryCashWitness(ctx.tx, cash);
    return { source: owner.owner.source, applied: cash.applied, platform: cash.providerPlatformAccountId, account: cash.chargeAccountId, paymentRef: cash.providerRef,
      apiVersion: cash.providerApiVersion, auxiliaryIds: witness.operations.filter(operation => operation.kind !== "inspection").map(operation => operation.id),
      auxiliaryRequest: auxiliaryOperationId ? await originalCashAuxiliaryRecoveryRequest(ctx, recoveryId, auxiliaryOperationId) : null };
  },
});
export const checkOriginalCashInventory = defineService({
  name: "invoicing.checkOriginalCashInventory", summary: "Validate the unchanged actual returned inventory without dispatching provider work or changing canonical cash.",
  kind: "query", permission: "system", external: false, input: id.extend({ operationId: z.uuid() }),
  output: z.object({ settled: z.boolean(), feeDebt: z.boolean(), applied: z.boolean(), source: merchantRefundSource }),
  handler: async ({ recoveryId, operationId }, ctx) => {
    const current = await currentOriginalCashInventory(ctx, recoveryId, operationId), owner = await originalCashRecoveryOwner(ctx.tx, recoveryId);
    return { settled: current.proof.settled, feeDebt: current.history.feeDebt, applied: current.cash.applied, source: owner.owner.source };
  },
});
function auxiliaryFactsResolved(witness: Awaited<ReturnType<typeof originalCashRecoveryCashWitness>>) {
  return witness.operations.filter(operation => operation.kind !== "inspection").every(operation => {
    const facts = witness.facts.filter(fact => fact.operationId === operation.id || fact.evidence.auxiliaryOperationId === operation.id), refs = exactCashResourceRefs(facts);
    const resources = facts.filter(fact => fact.kind === "resource");
    return refs?.length === 1 && resources.some(fact => fact.evidence.bindingVerified === true && fact.evidence.providerRef === refs[0]
      && fact.evidence.operationId === operation.id && fact.evidence.parentRef === operation.request.parentRef
      && fact.evidence.amountMinor === operation.request.amountMinor && fact.evidence.currency === operation.request.currency)
      && resources.every(fact => fact.evidence.providerRef === refs[0]
        && (fact.evidence.operationId === null || fact.evidence.operationId === operation.id)
        && (fact.evidence.parentRef === null || fact.evidence.parentRef === operation.request.parentRef)
        && (fact.evidence.amountMinor === null || fact.evidence.amountMinor === operation.request.amountMinor)
        && (fact.evidence.currency === null || fact.evidence.currency === operation.request.currency));
  });
}
export const finalizeOriginalCashRecovery = defineService({
  name: "invoicing.finalizeOriginalCashRecovery", summary: "Retain a fresh complete original cash-return closure after actual refund, fee, recipient, dispute and physical-caller proof.",
  kind: "mutation", permission: "system", external: false, writeClass: "money", input: id.extend({ operationId: z.uuid(), unappliedReturnReceiptId: z.uuid().optional() }),
  output: z.object({ closureId: z.uuid() }),
  handler: async ({ recoveryId, operationId, unappliedReturnReceiptId }, ctx) => {
    const { owner, cash } = await bound(ctx, recoveryId), witness = await originalCashRecoveryCashWitness(ctx.tx, cash);
    const current = cash.applied ? await currentOriginalCashInventory(ctx, recoveryId, operationId) : null;
    if (current && (!current.proof.settled || current.history.feeDebt) || !auxiliaryFactsResolved(witness)) throw new ServiceError("conflict", "Keep the authentic original cash-return debt until all actual resources and callers are resolved.");
    if (!cash.applied) {
      // The canonical receipt service revalidates its own separate returned
      // complete read and actual finish; no new local payment is created.
      const returned = await import("./merchant-cash-return-service");
      if (!unappliedReturnReceiptId || !await returned.verifiedOriginalCashReturnReceipt(ctx, unappliedReturnReceiptId, owner.owner.source)) throw new ServiceError("conflict", "Keep the original unapplied cash pending until its exact canonical return receipt and separate current finished inspection are verified.");
    }
    const revision = (await originalCashRecoveryRevision(ctx, recoveryId)).revision;
    const prior = await ctx.tx.select().from(originalCashRecoveryClosures).where(eq(originalCashRecoveryClosures.operationId, operationId));
    if (prior[0]) { if (prior[0].revision !== revision) throw new ServiceError("conflict", "Retain this older closure and inspect the original cash again."); return { closureId: prior[0].id }; }
    const closureId = randomUUID(), createdAt = new Date(), body = { recoveryId, operationId, revision, unappliedReturnReceiptId: unappliedReturnReceiptId ?? null }, digest = merchantTaxDigest(body);
    await write(ctx); await ctx.tx.insert(originalCashRecoveryClosures).values({ id: closureId, ...body, digest, createdAt,
      authentication: signOriginalCashRecovery("closure", { id: closureId, digest, createdAt }, originalCashSigningKey()) });
    queueOriginalMerchantRefundRepair(ctx, { kind: "original_cash_closure", id: closureId });
    return { closureId };
  },
});
export async function originalCashFullReturnCurrent(ctx: ServiceContext, paymentId: string): Promise<boolean> {
  const { originalCashRecoveryFinancialWitness } = await import("./original-cash-recovery-store");
  const witness = await originalCashRecoveryFinancialWitness(ctx.tx, [paymentId], []);
  for (const owner of witness.owners) {
    if (!owner.owner.cash.applied) continue;
    const current = await originalCashRecoveryRevision(ctx, owner.id);
    if (witness.closures.some(closure => closure.recoveryId === owner.id && closure.revision === current.revision)) return true;
  }
  return false;
}
export default [claimOriginalCashRecovery, claimOriginalCashInspection, recordOriginalCashFact, claimOriginalCashAuxiliary, claimOriginalUnappliedCashRefund,
  originalCashRecoveryPhase, checkOriginalCashInventory, finalizeOriginalCashRecovery, reviewOriginalCashCallerStopped, reviewOriginalCashLegacyFeeStopped];
