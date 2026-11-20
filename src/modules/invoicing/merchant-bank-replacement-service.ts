// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { lockContactIdentityForRead } from "@/core/contacts/identity-lock";
import { defineOrchestratedService, defineService, ServiceError } from "@/core/service";
import { refundRow } from "./contract";
import { moneyStateEvents, payments, refunds } from "./schema";
import { merchantRefundRequests, merchantRefundResourceBindings } from "./merchant-refund-schema";
import { merchantRefundRequestRow, claimMerchantRefundRequest } from "./merchant-refund-request";
import { lockMerchantRefundCash } from "./merchant-refund-origin";
import { reconcileOriginalMerchantRefundCurrentState } from "./merchant-refund-current-service";
import { submitOriginalMerchantRefund } from "./merchant-refund-execution";
import { queueOriginalMerchantRefundRepair } from "./merchant-refund-privacy-repair";
import { merchantTaxDigest } from "./merchant-tax-store";
import { bankReplacementFinancialState, bankReplacementSigningKey, readBankReplacementChain } from "./merchant-bank-replacement-store";
import { BANK_REPLACEMENT_CONFIRMATION, BANK_REPLACEMENT_PROTOCOL, BANK_REPLACEMENT_REASON, BANK_REPLACEMENT_STATE,
  bankReplacementKey, bankReplacementReason, signBankReplacement } from "./merchant-bank-replacement-proof";
const system = { kind: "system" } as const;
const requestInput = z.object({ requestId: z.uuid() }).strict();
const claimResult = z.discriminatedUnion("state", [
  z.object({ state: z.literal("ready"), request: merchantRefundRequestRow }),
  z.object({ state: z.enum(["fulfilled", "pending", "review"]), refund: refundRow }),
]);

export const merchantBankReplacementPlan = defineService({
  name: "invoicing.merchantBankReplacementPlan", summary: "Read one complete original bank-refund replacement chain before exact-resource inspection.",
  kind: "query", permission: "system", external: false, input: requestInput,
  output: z.object({ rootRequestId: z.uuid(), inspectRequestIds: z.array(z.uuid()).max(5000) }),
  handler: async ({ requestId }, ctx) => {
    const [request] = await ctx.tx.select().from(merchantRefundRequests).where(eq(merchantRefundRequests.id, requestId));
    if (!request || request.purpose !== "invoice_refund" || !request.paymentId || !request.refundId) throw new ServiceError("conflict", "Restore this actual invoice refund's original request; historical and receipt-owned cash are not fabricated into invoice refunds.");
    const chain = await readBankReplacementChain(ctx.tx, request);
    if (chain.incomplete) throw new ServiceError("conflict", "Restore the original replacement journal and every admitted child before another refund.");
    const inspectRequestIds: string[] = [];
    for (const node of chain.nodes) {
      const [prepared] = await ctx.tx.execute<{ prepared: boolean }>(sql`select freeholder_refund_is_prepared_return(${node.refundId}::uuid) as prepared`);
      if (prepared?.prepared) throw new ServiceError("conflict", "Use the original return's frozen refund part and issued credit; this generic replacement cannot own it.");
      const bindings = await ctx.tx.select({ providerRef: merchantRefundResourceBindings.providerRef }).from(merchantRefundResourceBindings).where(eq(merchantRefundResourceBindings.requestId, node.id)).limit(5001);
      if (bindings.length > 5000 || new Set(bindings.map(row => row.providerRef)).size > 1) throw new ServiceError("conflict", "Restore the exact original bank resource; no metadata or equal amount may choose one.");
      if (bindings.length) inspectRequestIds.push(node.id);
    }
    return { rootRequestId: chain.root.id, inspectRequestIds };
  },
});

export const claimMerchantBankReplacement = defineService({
  name: "invoicing.claimMerchantBankReplacement", summary: "Reserve one exact causal replacement after a fresh human-authorized original bank failure, never an unrelated equal refund.",
  kind: "mutation", permission: "system", external: false, writeClass: "money", auditInputFields: ["requestId", "authorizedBy"],
  input: requestInput.extend({ authorizedBy: z.uuid() }), output: claimResult,
  handler: async ({ requestId, authorizedBy }, ctx) => {
    await lockContactIdentityForRead(ctx.tx);
    const [original] = await ctx.tx.select().from(merchantRefundRequests).where(eq(merchantRefundRequests.id, requestId));
    if (!original || original.purpose !== "invoice_refund" || !original.paymentId || !original.refundId) throw new ServiceError("conflict", "Use the actual original invoice-refund request; do not create an invoice for retained unapplied cash.");
    const initial = await readBankReplacementChain(ctx.tx, original);
    if (initial.incomplete) throw new ServiceError("conflict", "Restore the complete original replacement chain and evidence before changing its money.");
    const leaf = initial.nodes.at(-1)!, key = bankReplacementKey(leaf.id);
    // Every writer of this chain takes identity/family, reservation, sorted
    // refund, payment, invoice and cash locks in that order. No physical I/O
    // happens in this transaction or while these locks are held.
    await ctx.tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`bank-replacement-family:${original.providerPlatformAccountId}:${original.chargeAccountId ?? ""}:${original.originalPaymentRef}`}))`);
    await ctx.tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`refund-idempotency:${key}`}))`);
    for (const id of initial.nodes.flatMap(node => node.refundId ? [node.refundId] : []).sort()) await ctx.tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`refund:${id}`}))`);
    await ctx.tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`payment:${original.paymentId}`}))`);
    const [payment] = await ctx.tx.select().from(payments).where(eq(payments.id, original.paymentId));
    if (!payment) throw new ServiceError("conflict", "Restore the original payment before reserving its replacement refund.");
    await ctx.tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`invoice:${payment.invoiceId}`}))`);
    await lockMerchantRefundCash(ctx, { ...original, providerRef: original.originalPaymentRef });
    const chain = await readBankReplacementChain(ctx.tx, original);
    if (chain.incomplete || merchantTaxDigest(chain.nodes.map(node => node.id)) !== merchantTaxDigest(initial.nodes.map(node => node.id))) throw new ServiceError("conflict", "The original chain changed; reload it before authorizing its next exact operation.");
    for (const node of chain.nodes) {
      const [prepared] = await ctx.tx.execute<{ prepared: boolean }>(sql`select freeholder_refund_is_prepared_return(${node.refundId}::uuid) as prepared`);
      if (prepared?.prepared) throw new ServiceError("conflict", "Use this refund's original return and frozen payment part; a generic replacement cannot take ownership of its issued credit.");
    }
    const state = await bankReplacementFinancialState(ctx, chain);
    const [lastRefund] = await ctx.tx.select().from(refunds).where(eq(refunds.id, leaf.refundId!));
    if (!lastRefund) throw new ServiceError("conflict", "Restore the actual original logical refund; no replacement may invent it.");
    if (state.fulfilled) {
      const actual = state.states.find(row => row.state === "returned")!.request;
      const [paid] = await ctx.tx.select().from(refunds).where(eq(refunds.id, actual.refundId!));
      if (!paid) throw new ServiceError("conflict", "Restore the actual returned refund before reporting this promise fulfilled.");
      return { state: "fulfilled" as const, refund: paid };
    }
    if (state.overReturned || (state.returnedMinor ?? 0) > 0) return { state: "review" as const, refund: lastRefund };
    const earlier = state.states.slice(0, -1);
    if (earlier.some(row => row.state !== "failed" && row.state !== "retired")) throw new ServiceError("conflict", "Inspect every earlier original resource and finish its callers before another replacement.");
    const last = state.states.at(-1)!;
    if (chain.links.length && last.state === "unsubmitted" && !state.review) return { state: "ready" as const, request: merchantRefundRequestRow.parse(leaf) };
    if (chain.links.length && last.state === "pending") return { state: "pending" as const, refund: lastRefund };
    if (state.review || !state.terminalReads.length || last.state !== "failed" && last.state !== "retired") throw new ServiceError("conflict", "An actual current failed or cancelled bank resource and finished callers are required; time or human belief cannot release it.");
    // The immutable child key is only a missing-proof detector. An existing
    // unsigned child is never adopted or given a newly invented signature.
    const [existing] = await ctx.tx.select({ id: merchantRefundRequests.id }).from(merchantRefundRequests).where(andKey(original.providerPlatformAccountId, original.chargeAccountId, key));
    if (existing) throw new ServiceError("conflict", "Restore this existing replacement's exact original signed receipt; do not create a new key or re-sign historical money.");
    const next = await ctx.callAsSystem(claimMerchantRefundRequest, { source: { kind: "payment", paymentId: original.paymentId },
      amountMinor: chain.root.amountMinor, idempotencyKey: key, reason: bankReplacementReason(leaf.id), initiatedBy: `user:${authorizedBy}` });
    if (!next.refundId || next.paymentId !== original.paymentId || next.originalPaymentRef !== original.originalPaymentRef || next.providerPlatformAccountId !== original.providerPlatformAccountId
      || next.chargeAccountId !== original.chargeAccountId || next.amountMinor !== chain.root.amountMinor || next.currency !== original.currency) throw new ServiceError("conflict", "The replacement does not match its exact original cash; preserve the existing financial history.");
    const now = new Date(), evidenceId = randomUUID();
    const metadata = signBankReplacement({ protocol: BANK_REPLACEMENT_PROTOCOL, evidenceId, rootRequestId: chain.root.id, rootRequestDigest: chain.root.requestDigest,
      parentRequestId: leaf.id, parentRequestDigest: leaf.requestDigest, parentRefundId: leaf.refundId!, replacementRequestId: next.id, replacementRequestDigest: next.requestDigest,
      replacementRefundId: next.refundId, paymentId: original.paymentId, providerPlatformAccountId: original.providerPlatformAccountId, chargeAccountId: original.chargeAccountId,
      originalPaymentRef: original.originalPaymentRef, amountMinor: chain.root.amountMinor, currency: original.currency,
      terminalReads: state.terminalReads, retiredRequestIds: state.retiredRequestIds, authorizedBy: `user:${authorizedBy}`, authorizedAt: now.toISOString() }, bankReplacementSigningKey());
    await ctx.tx.insert(moneyStateEvents).values({ id: evidenceId, subjectType: "refund", subjectId: leaf.refundId!, fromState: null,
      toState: BANK_REPLACEMENT_STATE, reason: BANK_REPLACEMENT_REASON, actor: `user:${authorizedBy}`, metadata, occurredAt: now });
    queueOriginalMerchantRefundRepair(ctx, { kind: "bank_replacement", id: evidenceId });
    ctx.setSubject("refund", next.refundId);
    return { state: "ready" as const, request: next };
  },
});

export const merchantBankReplacementOutcome = defineService({
  name: "invoicing.merchantBankReplacementOutcome", summary: "Recheck the entire original refund promise after its physical replacement fact committed.",
  kind: "query", permission: "system", external: false,
  input: requestInput.extend({ refundId: z.uuid() }), output: z.object({ state: z.enum(["fulfilled", "pending", "review"]), refund: refundRow }),
  handler: async ({ requestId, refundId }, ctx) => {
    const [request] = await ctx.tx.select().from(merchantRefundRequests).where(eq(merchantRefundRequests.id, requestId));
    const [refund] = await ctx.tx.select().from(refunds).where(eq(refunds.id, refundId));
    if (!request || !refund || request.paymentId !== refund.paymentId) throw new ServiceError("conflict", "Restore the original promise and actual replacement outcome before reporting success.");
    const chain = await readBankReplacementChain(ctx.tx, request);
    if (chain.incomplete || !chain.nodes.some(node => node.refundId === refundId)) return { state: "review" as const, refund };
    const state = await bankReplacementFinancialState(ctx, chain);
    return { state: state.fulfilled ? "fulfilled" as const : state.review ? "review" as const : "pending" as const, refund };
  },
});
function andKey(platform: string, account: string | null, key: string) {
  return sql`${merchantRefundRequests.providerPlatformAccountId}=${platform} and ${merchantRefundRequests.chargeAccountId} is not distinct from ${account} and ${merchantRefundRequests.idempotencyKey}=${key}`;
}

export const replaceReturnedBankRefund = defineOrchestratedService({
  name: "invoicing.replaceReturnedBankRefund", summary: "Authorize one replacement of an exact failed bank refund, preserving the original charge and every earlier return.",
  kind: "mutation", permission: "scoped", agentCallable: false, stepUp: true, writeClass: "money",
  input: requestInput.extend({ confirmation: z.literal(BANK_REPLACEMENT_CONFIRMATION) }).strict(),
  output: z.object({ state: z.enum(["fulfilled", "pending", "review"]), refund: refundRow }),
  handler: async ({ requestId }, caller) => {
    if (caller.kind !== "user" || caller.keyScopes) throw new ServiceError("permission", "A freshly verified signed-in person must authorize this exact replacement.");
    const actor = { ...system, request: caller.request };
    const plan = await merchantBankReplacementPlan.call({ requestId }, actor);
    const errors: unknown[] = [];
    for (const id of plan.inspectRequestIds) {
      try { await reconcileOriginalMerchantRefundCurrentState(id, caller); }
      catch (error) { errors.push(error); } // All actual facts commit before policy errors propagate.
    }
    if (errors.length) throw errors[0];
    const claim = await claimMerchantBankReplacement.call({ requestId: plan.rootRequestId, authorizedBy: caller.userId }, actor);
    if (claim.state !== "ready") return claim;
    const refund = await submitOriginalMerchantRefund({ paymentId: claim.request.paymentId!, amountMinor: claim.request.amountMinor,
      reason: bankReplacementReason(claim.request.idempotencyKey.slice("bank-replacement:v1:".length)), idempotencyKey: claim.request.idempotencyKey }, caller);
    return merchantBankReplacementOutcome.call({ requestId: plan.rootRequestId, refundId: refund.id }, actor);
  },
});

export default [merchantBankReplacementPlan, claimMerchantBankReplacement, merchantBankReplacementOutcome, replaceReturnedBankRefund];
