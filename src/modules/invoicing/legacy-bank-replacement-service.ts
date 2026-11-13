// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C5.19/C12.38: fresh human authority, actual legacy lineage and shared money.
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { defineOrchestratedService, defineService, ServiceError } from "@/core/service";
import { lockContactIdentityForRead } from "@/core/contacts/identity-lock";
import { routingForPayment } from "./merchant-charge";
import { createRefund } from "./invoice-service";
import { refundRow } from "./contract";
import { payments, refunds, moneyStateEvents } from "./schema";
import { originalLegacyBankRefund } from "./legacy-refund-dispatch";
import { reconcileLegacyBankRefund } from "./legacy-bank-current-service";
import { submitProviderRefund } from "./payment-provider-service";
import { merchantTaxDigest } from "./merchant-tax-store";
import { queueOriginalMerchantRefundRepair } from "./merchant-refund-privacy-repair";
import { assertLegacyBankRecoveryGuards, readLegacyReplacementChain, legacyReplacementFinancialState, legacyReplacementSigningKey } from "./legacy-bank-replacement-store";
import { LEGACY_REPLACEMENT_CONFIRMATION, LEGACY_REPLACEMENT_PROTOCOL, LEGACY_REPLACEMENT_STATE, LEGACY_REPLACEMENT_REASON, legacyReplacementKey, legacyReplacementReason, signLegacyReplacement } from "./legacy-bank-replacement-proof";
const id = z.object({ refundId: z.uuid() }).strict();
export const legacyBankReplacementPlan = defineService({
  name: "invoicing.legacyBankReplacementPlan", summary: "Read actual original legacy refund lineage before fresh inspection, never synthesize an original request.",
  kind: "query", permission: "system", external: false, input: id,
  output: z.object({ rootRefundId: z.uuid(), inspectRefundIds: z.array(z.uuid()).max(5000) }),
  handler: async ({ refundId }, ctx) => {
    const [refund] = await ctx.tx.select().from(refunds).where(eq(refunds.id, refundId));
    if (!refund) throw new ServiceError("conflict", "Restore this original legacy refund before replacement review.");
    const chain = await readLegacyReplacementChain(ctx.tx, refund);
    if (chain.incomplete) throw new ServiceError("conflict", "Restore every original legacy replacement receipt; unsigned or unrelated refunds cannot fulfill it.");
    await originalLegacyBankRefund(ctx.tx, chain.root);
    for (const node of chain.nodes) {
      const [rma] = await ctx.tx.execute<{ bound: boolean }>(sql`select freeholder_refund_is_prepared_return(${node.id}::uuid) bound`);
      if (rma?.bound) throw new ServiceError("conflict", "Use the original return's exact frozen payment part and issued credit. Generic replacement cannot adopt it.");
    }
    return { rootRefundId: chain.root.id, inspectRefundIds: chain.nodes.filter(node => node.providerRef).map(node => node.id) };
  },
});
export const claimLegacyBankReplacement = defineService({
  name: "invoicing.claimLegacyBankReplacement", summary: "Reserve one signed deterministic original legacy bank replacement after exact current failure and real caller completion.",
  kind: "mutation", permission: "system", external: false, writeClass: "money", auditInputFields: ["refundId", "authorizedBy"],
  input: id.extend({ authorizedBy: z.uuid() }), output: z.object({ state: z.enum(["ready", "fulfilled", "pending", "review"]), refund: refundRow }),
  handler: async ({ refundId, authorizedBy }, ctx) => {
    await assertLegacyBankRecoveryGuards(ctx);
    await lockContactIdentityForRead(ctx.tx);
    const [refund] = await ctx.tx.select().from(refunds).where(eq(refunds.id, refundId));
    if (!refund) throw new ServiceError("conflict", "Restore the original legacy refund before reserving a replacement.");
    const initial = await readLegacyReplacementChain(ctx.tx, refund);
    if (initial.incomplete) throw new ServiceError("conflict", "Restore the complete original legacy causal journal before changing money.");
    const leaf = initial.nodes.at(-1)!, key = legacyReplacementKey(leaf.id);
    await ctx.tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`legacy-bank-family:${refund.paymentId}`}))`);
    await ctx.tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`refund-idempotency:${key}`}))`);
    for (const node of [...initial.nodes].sort((a, b) => a.id.localeCompare(b.id))) await ctx.tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`refund:${node.id}`}))`);
    await ctx.tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`payment:${refund.paymentId}`}))`);
    const [payment] = await ctx.tx.select().from(payments).where(eq(payments.id, refund.paymentId));
    if (!payment) throw new ServiceError("conflict", "Restore this original legacy payment before replacement.");
    await ctx.tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`invoice:${payment.invoiceId}`}))`);
    const chain = await readLegacyReplacementChain(ctx.tx, refund);
    if (chain.incomplete || merchantTaxDigest(chain.nodes.map(node => node.id)) !== merchantTaxDigest(initial.nodes.map(node => node.id))) throw new ServiceError("conflict", "The original legacy chain changed; reload it before authorizing another exact operation.");
    for (const node of chain.nodes) {
      const [rma] = await ctx.tx.execute<{ bound: boolean }>(sql`select freeholder_refund_is_prepared_return(${node.id}::uuid) bound`);
      if (rma?.bound) throw new ServiceError("conflict", "Use this refund's original return and frozen payment part; generic replacement cannot own its issued credit.");
    }
    const state = await legacyReplacementFinancialState(ctx, chain);
    const currentLeaf = chain.nodes.at(-1)!;
    if (state.fulfilled) return { state: "fulfilled" as const, refund: state.states.find(row => row.state === "returned")!.refund };
    if (state.review || state.overReturned || (state.returnedMinor ?? 0) > 0) return { state: "review" as const, refund: currentLeaf };
    if (chain.links.length && state.states.at(-1)?.state === "unsubmitted" && state.states.slice(0, -1).every(row => row.state === "failed")) return { state: "ready" as const, refund: currentLeaf };
    if (!state.canReplace) return { state: "pending" as const, refund: currentLeaf };
    const [existing] = await ctx.tx.select({ id: refunds.id }).from(refunds).where(eq(refunds.idempotencyKey, key)).limit(1);
    if (existing) throw new ServiceError("conflict", "Restore the original signed child receipt; never adopt or re-sign an unsigned historical refund.");
    const rootOriginal = await originalLegacyBankRefund(ctx.tx, chain.root), parentOriginal = await originalLegacyBankRefund(ctx.tx, currentLeaf);
    const routing = await routingForPayment(ctx, payment.id);
    if (routing.providerPlatformAccountId || (routing.providerAccountId ?? null) !== rootOriginal.originalChargeAccountId || payment.providerRef !== rootOriginal.originalPaymentRef) throw new ServiceError("conflict", "Restore the authentic original legacy charge scope; a later merchant route cannot adopt it.");
    await ctx.tx.execute(sql`select set_config('freeholder.legacy_bank_replacement_parent',${currentLeaf.id},true)`);
    const child = await ctx.callAsSystem(createRefund, { paymentId: payment.id, amountMinor: chain.root.amountMinor, idempotencyKey: key, reason: legacyReplacementReason(currentLeaf.id) });
    await ctx.tx.execute(sql`select set_config('freeholder.legacy_bank_replacement_parent','',true),set_config('freeholder.legacy_bank_capacity_payment','',true)`);
    const evidenceId = randomUUID(), now = new Date(), metadata = signLegacyReplacement({ protocol: LEGACY_REPLACEMENT_PROTOCOL, evidenceId,
      rootRefundId: chain.root.id, rootOriginalDigest: merchantTaxDigest(rootOriginal), parentRefundId: currentLeaf.id, parentOriginalDigest: merchantTaxDigest(parentOriginal),
      replacementRefundId: child.id, replacementRequestHash: child.requestHash, paymentId: payment.id, invoiceId: payment.invoiceId,
      originalPaymentRef: rootOriginal.originalPaymentRef, originalChargeAccountId: rootOriginal.originalChargeAccountId,
      originalCreatePlatformAccountId: null, originalCreateProtocolVersion: null, amountMinor: chain.root.amountMinor, currency: chain.root.currency,
      terminalReads: state.terminalReads, authorizedBy: `user:${authorizedBy}`, authorizedAt: now.toISOString() }, legacyReplacementSigningKey());
    await ctx.tx.insert(moneyStateEvents).values({ id: evidenceId, subjectType: "refund", subjectId: currentLeaf.id, fromState: null, toState: LEGACY_REPLACEMENT_STATE,
      reason: LEGACY_REPLACEMENT_REASON, actor: `user:${authorizedBy}`, metadata, occurredAt: now });
    queueOriginalMerchantRefundRepair(ctx, { kind: "legacy_bank_replacement", id: evidenceId });
    ctx.setSubject("refund", child.id); return { state: "ready" as const, refund: child };
  },
});
export const legacyBankReplacementOutcome = defineService({
  name: "invoicing.legacyBankReplacementOutcome", summary: "Read the whole authentic legacy promise after actual replacement bank proof commits.",
  kind: "query", permission: "system", external: false, input: id.extend({ replacementRefundId: z.uuid() }),
  output: z.object({ state: z.enum(["fulfilled", "pending", "review"]), refund: refundRow }),
  handler: async ({ refundId, replacementRefundId }, ctx) => {
    const [original] = await ctx.tx.select().from(refunds).where(eq(refunds.id, refundId)), [replacement] = await ctx.tx.select().from(refunds).where(eq(refunds.id, replacementRefundId));
    if (!original || !replacement) throw new ServiceError("conflict", "Restore the actual original and replacement before reporting their outcome.");
    const chain = await readLegacyReplacementChain(ctx.tx, original);
    if (chain.incomplete || !chain.nodes.some(node => node.id === replacement.id)) return { state: "review" as const, refund: replacement };
    const state = await legacyReplacementFinancialState(ctx, chain);
    return { state: state.fulfilled ? "fulfilled" as const : state.review ? "review" as const : "pending" as const, refund: replacement };
  },
});
export const replaceLegacyReturnedBankRefund = defineOrchestratedService({
  name: "invoicing.replaceLegacyReturnedBankRefund", summary: "Authorize one exact causal replacement of a bank-returned legacy refund while preserving the original charge and every earlier fact.",
  kind: "mutation", permission: "scoped", agentCallable: false, stepUp: true, writeClass: "money",
  input: id.extend({ confirmation: z.literal(LEGACY_REPLACEMENT_CONFIRMATION) }).strict(), output: z.object({ state: z.enum(["fulfilled", "pending", "review"]), refund: refundRow }),
  handler: async ({ refundId }, caller) => {
    if (caller.kind !== "user" || caller.keyScopes) throw new ServiceError("permission", "A freshly verified signed-in person must authorize the exact original legacy replacement.");
    const system = { kind: "system", request: caller.request } as const;
    const plan = await legacyBankReplacementPlan.call({ refundId }, system), errors: unknown[] = [];
    for (const id of plan.inspectRefundIds) { try { await reconcileLegacyBankRefund.call({ refundId: id }, caller); } catch (error) { errors.push(error); } }
    if (errors.length) throw errors[0];
    const claim = await claimLegacyBankReplacement.call({ refundId: plan.rootRefundId, authorizedBy: caller.userId }, system);
    if (claim.state !== "ready") return claim;
    const prefix = "legacy-bank-replacement:v1:", parentId = claim.refund.idempotencyKey.slice(prefix.length);
    const actual = await submitProviderRefund.call({ paymentId: claim.refund.paymentId, amountMinor: claim.refund.amountMinor,
      reason: legacyReplacementReason(parentId), idempotencyKey: claim.refund.idempotencyKey }, caller);
    // The newly admitted caller invalidates earlier cash-inventory receipts.
    // Inspect every actual resource again after it really finishes, retaining
    // each packet even if another packet cannot yet authorize current money.
    const completionPlan = await legacyBankReplacementPlan.call({ refundId: plan.rootRefundId }, system), completionErrors: unknown[] = [];
    for (const id of completionPlan.inspectRefundIds) { try { await reconcileLegacyBankRefund.call({ refundId: id }, caller); } catch (error) { completionErrors.push(error); } }
    if (completionErrors.length) throw completionErrors[0];
    return legacyBankReplacementOutcome.call({ refundId: plan.rootRefundId, replacementRefundId: actual.id }, system);
  },
});
export const legacyBankCurrentReadFamily = defineService({
  name: "invoicing.legacyBankCurrentReadFamily", summary: "Read the authentic actual refund resources whose cash freshness changed together without authorizing replacement or adopting a corrupt causal link.",
  kind: "query", permission: "system", external: false, input: id, output: z.object({ inspectRefundIds: z.array(z.uuid()).min(1).max(5000) }),
  handler: async ({ refundId }, ctx) => {
    const [refund] = await ctx.tx.select().from(refunds).where(eq(refunds.id, refundId));
    if (!refund) throw new ServiceError("conflict", "Restore the actual original legacy refund before inspecting its bank family.");
    await originalLegacyBankRefund(ctx.tx, refund);
    const chain = await readLegacyReplacementChain(ctx.tx, refund);
    return { inspectRefundIds: chain.incomplete ? [refund.id] : chain.nodes.filter(node => node.providerRef).map(node => node.id) };
  },
});
export const recoverLegacyBankRefund = defineOrchestratedService({
  name: "invoicing.recoverLegacyBankRefund", summary: "Inspect the exact original legacy refund and current cash without creating a new refund or replacing money.",
  kind: "mutation", permission: "scoped", stepUp: true, writeClass: "money", input: id,
  output: z.object({ receiptId: z.uuid(), status: z.enum(["pending", "requires_action", "succeeded", "failed", "canceled"]).nullable(), applied: z.boolean(), requiresReview: z.boolean() }),
  handler: async (input, caller) => {
    const plan = await legacyBankCurrentReadFamily.call(input, { kind: "system", request: caller.request }), errors: unknown[] = [];
    let selected: Awaited<ReturnType<typeof reconcileLegacyBankRefund.call>> | undefined;
    for (const refundId of plan.inspectRefundIds) {
      try { const result = await reconcileLegacyBankRefund.call({ refundId }, caller); if (refundId === input.refundId) selected = result; }
      catch (error) { errors.push(error); }
    }
    if (errors.length) throw errors[0];
    if (!selected) throw new ServiceError("conflict", "Retain the exact original legacy read result before reporting its current state.");
    return selected;
  },
});
export default [legacyBankCurrentReadFamily, legacyBankReplacementPlan, claimLegacyBankReplacement, legacyBankReplacementOutcome, replaceLegacyReturnedBankRefund, recoverLegacyBankRefund];
