// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.38: original partial customer money stays on its existing shared lifecycle.
import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { paymentAdapter } from "@/adapters/payments";
import { defineOrchestratedService, defineService, ServiceError } from "@/core/service";
import { payments } from "./schema";
import { merchantRefundSource } from "./merchant-refund-origin";
import { originalCashRecoveryFinancialWitness } from "./original-cash-recovery-store";
import { originalCashRecoveryPhase, claimOriginalCashRecovery, performOriginalCashRecovery, flushOriginalCashRecovery } from "./original-cash-recovery-service";
import { inspectOriginalCashInventory, recoverOriginalCashAuxiliary } from "./original-cash-recovery";
import { reconcileOriginalMerchantRefundCurrentState } from "./merchant-refund-current-service";
import { flushLocalMerchantRefundDispatchFinishes } from "./merchant-refund-dispatch";
import { retainOriginalPartialCashTarget, claimOriginalPartialCashAuxiliary, finalizeOriginalPartialCashTarget } from "./original-cash-partial-service";
import { ORIGINAL_PARTIAL_CASH_CONFIRMATION } from "./original-cash-partial-contract";
export const originalPartialCashEntry = defineService({
  name: "invoicing.originalPartialCashEntry", summary: "Resolve the exact original applied payment and retained cash owner without adopting a same-price resource or raw alternate PI.",
  kind: "query", permission: "system", external: false, input: z.object({ paymentId: z.uuid() }).strict(), output: z.object({ source: merchantRefundSource }),
  handler: async ({ paymentId }, ctx) => {
    const [payment] = await ctx.tx.select().from(payments).where(eq(payments.id, paymentId));
    if (!payment || payment.status !== "succeeded" || !payment.providerRef) throw new ServiceError("conflict", "Restore the actual original applied payment before partial return targets.");
    const witness = await originalCashRecoveryFinancialWitness(ctx.tx, [paymentId], []);
    const owners = witness.owners.filter(owner => owner.owner.cash.applied && owner.owner.cash.providerRef === payment.providerRef && owner.owner.cash.amountMinor === payment.amountMinor && owner.owner.cash.currency === payment.currency);
    if (owners.length > 1) throw new ServiceError("conflict", "Restore the one original canonical cash owner before partial money; an equal observation cannot choose it.");
    return { source: owners[0]?.owner.source ?? { kind: "payment" as const, paymentId } };
  },
});
export const originalPartialRefundInventory = defineService({
  name: "invoicing.originalPartialRefundInventory", summary: "Read exact original refund request UUIDs in the retained cash namespace before fresh current resource inspection.",
  kind: "query", permission: "system", external: false, input: z.object({ recoveryId: z.uuid() }).strict(), output: z.array(z.uuid()).max(5000),
  handler: async ({ recoveryId }, ctx) => {
    const rows = await ctx.tx.execute<{ id: string }>(sql`select r.id from merchant_refund_requests r join original_cash_recoveries c on c.id=${recoveryId}::uuid
      where r.provider_platform_account_id=c.owner->'cash'->>'providerPlatformAccountId' and r.charge_account_id is not distinct from c.owner->'cash'->>'chargeAccountId'
        and r.original_payment_ref=c.owner->'cash'->>'providerRef' and r.payment_id=c.payment_id and r.purpose='invoice_refund' order by r.id limit 5001`);
    if (rows.length > 5000) throw new ServiceError("conflict", "Restore the complete exact original refund inventory before cumulative targets.");
    return rows.map(row => row.id);
  },
});
export const reconcileOriginalPartialCashReturn = defineOrchestratedService({
  name: "invoicing.reconcileOriginalPartialCashReturn", summary: "Reconcile exact cumulative fees and original recipient resources for already confirmed original returned parts, preserving the issued credit and unreturned principal.",
  kind: "mutation", permission: "scoped", stepUp: true, agentCallable: false, writeClass: "money", auditInputFields: ["paymentId"],
  input: z.object({ paymentId: z.uuid(), confirmation: z.literal(ORIGINAL_PARTIAL_CASH_CONFIRMATION) }).strict(),
  output: z.object({ recoveryId: z.uuid(), targetFactId: z.uuid(), closureFactId: z.uuid() }),
  handler: async ({ paymentId }, actor) => {
    if (actor.kind !== "user" || actor.keyScopes) throw new ServiceError("permission", "A freshly verified signed-in person must authorize these exact original returned parts.");
    const system = { kind: "system", request: actor.request } as const;
    const entry = await originalPartialCashEntry.call({ paymentId }, system), { recoveryId } = await claimOriginalCashRecovery.call({ source: entry.source, authorizedBy: `user:${actor.userId}` }, system);
    await flushOriginalCashRecovery(recoveryId);
    const requests = await originalPartialRefundInventory.call({ recoveryId }, system);
    for (const requestId of requests) { await flushLocalMerchantRefundDispatchFinishes(requestId); await reconcileOriginalMerchantRefundCurrentState(requestId, actor); }
    const initial = await originalCashRecoveryPhase.call({ recoveryId }, system);
    for (const operationId of initial.auxiliaryIds) await recoverOriginalCashAuxiliary(recoveryId, operationId, actor);
    let operationId = await inspectOriginalCashInventory(recoveryId, actor);
    const { targetFactId } = await retainOriginalPartialCashTarget.call({ recoveryId, operationId, authorizedBy: `user:${actor.userId}` }, system);
    for (const kind of ["fee", "recipient"] as const) {
      const claim = await claimOriginalPartialCashAuxiliary.call({ recoveryId, operationId, targetFactId, kind }, system);
      if (!claim) continue;
      const adapter = paymentAdapter("stripe"), phase = await originalCashRecoveryPhase.call({ recoveryId, auxiliaryOperationId: claim.operationId }, system);
      if (!adapter.createMerchantCashAuxiliary || !phase.auxiliaryRequest) throw new ServiceError("conflict", "Restore the exact original partial-target auxiliary adapter and retained request.");
      await performOriginalCashRecovery(claim, observe => adapter.createMerchantCashAuxiliary!({ ...phase.auxiliaryRequest!,
        onParentObserved: evidence => observe("parent", evidence), onResourceAcknowledged: providerRef => observe("ack", { providerRef }), onResourceObserved: evidence => observe("resource", evidence) }));
      operationId = await inspectOriginalCashInventory(recoveryId, actor);
    }
    return { recoveryId, targetFactId, ...await finalizeOriginalPartialCashTarget.call({ recoveryId, operationId, targetFactId }, system) };
  },
});
export default [originalPartialCashEntry, originalPartialRefundInventory, reconcileOriginalPartialCashReturn];
