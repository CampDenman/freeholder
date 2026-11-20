// Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0
// PREPARED/UNRUN. Genuine producer/bank/private writer; no inserted proof/money.
import { eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/core/db";
import { defineService, getService } from "@/core/service";
import { ready } from "@/core/runtime";
import { stopJobs } from "@/core/jobs";
import * as outbox from "@/core/events/outbox";
import { createContact, mergeContacts, undoContactMerge } from "@/core/contacts/service";
import { advanceSubscriptionPeriod } from "@/core/entitlements/period-service";
import { entitlementGrants } from "@/core/entitlements/schema";
import { controlledFinancialWitness, exportControlledFinancialHistory } from "@/modules/invoicing/controlled-provider-financial-witness";
import { merchantRefundDependencyFingerprints } from "@/modules/invoicing/merchant-refund-dependencies";
import { invoiceMerchantDependencyFingerprints } from "@/modules/invoicing/merchant-payment-dependencies";
import { onInvoicePaid } from "@/modules/subscriptions/service";
import { invoices, payments } from "@/modules/invoicing/schema";
import { inspectControlledCashReceipt } from "@/modules/invoicing/controlled-cash-inspection-service";
import { merchantCashReturnObservations } from "@/modules/invoicing/merchant-refund-schema";
import { merchantReturnedCashEvidenceSchema } from "@/modules/invoicing/merchant-returned-cash-contract";
import { subscriptions, subscriptionProviderChargeReceipts } from "@/modules/subscriptions/schema";
import { collectControlledCollection } from "@/modules/subscriptions/controlled-provider-collection-orchestration";
import { completePaidControlledPeriod } from "@/modules/subscriptions/controlled-provider-paid-period";
import { subscriptionControlledPaidPeriodReceipts } from "@/modules/subscriptions/controlled-provider-paid-period-schema";
import { controlledPaidPeriodWitnesses, exportControlledPaidPeriodHistory } from "@/modules/subscriptions/controlled-provider-paid-period-witnesses";
import { CONTROLLED_COLLECTION_PROTOCOL } from "@/modules/subscriptions/controlled-provider-collection-protocol";
import { carts } from "@/modules/catalog/schema";
import { actualCartlessControlledPeriod84 } from "../helpers/actual-cartless-controlled-period84";
import { actualControlledPeriod84 } from "../helpers/actual-controlled-period84";
import { actualControlledOpenInvoice84 } from "../helpers/actual-controlled-open-invoice84";
import { retainActualControlledManifest84 } from "../helpers/actual-controlled-current-manifest84";
import { closeDb, failure, hasDatabase, OWNER, truncateSpine } from "../helpers/spine";

const batch = z.object({ invoiceId: z.uuid(), batchId: z.uuid(), payments: z.array(z.object({ receiptId: z.uuid(), paymentId: z.uuid() }).strict()),
  outstandingMinor: z.number().int().nonnegative(), batchRevision: z.string().regex(/^[a-f0-9]{64}$/), suppliesAccessAuthority: z.literal(false) }).strict();
/** REAL framework transaction: records the money-only boundary BEFORE COMMIT,
 * so ordinary paid-outbox timing cannot weaken the old-access oracle. No fake
 * ServiceContext, supplied proof, planned UUID or private override is created. */
const captureMoney = defineService({
  name: "subscriptions.controlledMoneySnapshotForNative", summary: "Capture actual shared money settlement and unchanged access inside its genuine outer transaction before commit.", kind: "mutation", permission: "system", external: false,
  input: z.object({ collectionId: z.uuid(), receiptIds: z.array(z.uuid()).min(1), subscriptionId: z.uuid() }).strict(),
  output: z.object({ money: batch, parent: z.unknown(), grants: z.array(z.unknown()), effectCount: z.number().int() }),
  handler: async (input, ctx) => {
    const writer = getService("invoicing.applyControlledReceiptBatch");
    if (writer.def.kind !== "mutation" || writer.def.permission !== "system" || writer.def.external !== false) throw Error("Install the genuine private batch writer, never a native stub.");
    const money = batch.parse(await ctx.callAsSystem(writer, { collectionId: input.collectionId, receiptIds: input.receiptIds, requiredProtocol: CONTROLLED_COLLECTION_PROTOCOL }));
    const [parent] = await ctx.tx.select().from(subscriptions).where(eq(subscriptions.id, input.subscriptionId));
    const grants = await ctx.tx.select().from(entitlementGrants).where(eq(entitlementGrants.sourceSubscriptionId, input.subscriptionId)).orderBy(entitlementGrants.id);
    const effects = await ctx.tx.select().from(subscriptionControlledPaidPeriodReceipts).where(eq(subscriptionControlledPaidPeriodReceipts.collectionId, input.collectionId));
    return { money, parent, grants, effectCount: effects.length };
  },
});

describe.runIf(hasDatabase)("actual independent controlled paid-period effect155", { timeout: 180000 }, () => {
  let f: Awaited<ReturnType<typeof actualControlledPeriod84>> | Awaited<ReturnType<typeof actualCartlessControlledPeriod84>> | undefined;
  beforeAll(ready, 60000); beforeEach(truncateSpine);
  afterEach(() => { vi.useRealTimers(); f?.cleanup(); f = undefined; vi.restoreAllMocks(); });
  afterAll(async () => { await stopJobs(); await closeDb(); });
  async function retained() {
    if (!f) throw Error("Create the real original accepted target first.");
    expect(await collectControlledCollection.call({ collectionId: f.target.collectionId }, OWNER)).toMatchObject({ state: "money_retained", applied: false });
    await retainActualControlledManifest84(f);
    const rows = await db().select().from(subscriptionProviderChargeReceipts).where(eq(subscriptionProviderChargeReceipts.subscriptionId, f.parent.id));
    expect(rows).toHaveLength(1); const receipt = rows[0]; if (!receipt) throw Error("Retain real positive provider cash first.");
    expect(await inspectControlledCashReceipt.call({ collectionId: f.target.collectionId, receiptId: receipt.id }, OWNER)).toMatchObject({ bankReadReturned: true, completeInventory: true });
    return receipt;
  }
  async function moneyOnly(receiptId: string) {
    if (!f) throw Error("Use the actual accepted target.");
    const [before] = await db().select().from(subscriptions).where(eq(subscriptions.id, f.parent.id));
    const result = await captureMoney.call({ collectionId: f.target.collectionId, receiptIds: [receiptId], subscriptionId: f.parent.id }, { kind: "system" });
    expect(result.parent).toEqual(before); expect(result.grants).toEqual([...f.grants].sort((a, b) => a.id.localeCompare(b.id))); expect(result.effectCount).toBe(0);
    return result.money;
  }
  it("commits actual full money before an independent effect, keeps old windows/usage, creates fresh IDs, refuses overlap, repeats exactly and preserves merge/undo/export ancestry", async () => {
    f = await actualCartlessControlledPeriod84(); const fixture = f; const receipt = await retained(), applied = await moneyOnly(receipt.id);
    expect(applied.outstandingMinor).toBe(0);
    // Exercise the actual post-commit event hook, not a native-only activation path.
    await onInvoicePaid({ invoiceId: applied.invoiceId });
    const outcome = await completePaidControlledPeriod.call({ invoiceId: applied.invoiceId }, { kind: "system" });
    expect(outcome.handled).toBe(true); expect(["applied", "already_applied"]).toContain(outcome.state);
    const [effect] = await db().select().from(subscriptionControlledPaidPeriodReceipts).where(eq(subscriptionControlledPaidPeriodReceipts.collectionId, f.target.collectionId));
    if (!effect) throw Error("A real independent immutable effect receipt is required.");
    expect(effect).toMatchObject({ invoiceId: applied.invoiceId, collectionId: f.target.collectionId, periodStart: new Date(f.target.periodStart), periodEnd: new Date(f.target.periodEnd) });
    const current = await db().select().from(entitlementGrants).where(eq(entitlementGrants.sourceSubscriptionId, f.parent.id)).orderBy(entitlementGrants.id);
    const fresh = current.filter(row => !f!.grants.some(old => old.id === row.id));
    const firstFresh = fresh[0]; if (!firstFresh) throw Error("Retain the actual new grant birth before checking retirement timestamps.");
    for (const old of f.grants) expect(current.find(row => row.id === old.id)).toEqual({ ...old, status: "expired", updatedAt: firstFresh.createdAt });
    // updatedAt records the actual retirement. Full microsecond SQL equality
    // and actual row transaction identities keep this stronger than anyDate.
    const [retirementStamp] = await db().execute<{ count: number; exact_time: boolean; actual_effect_tx: boolean }>(sql`select count(*)::integer as count,
      bool_and(retired.updated_at=fresh.created_at) as exact_time,
      bool_and(retired.xmin::text::bigint=(effect.admission_transaction_id::bigint%4294967296)
        and fresh.xmin::text::bigint=(effect.admission_transaction_id::bigint%4294967296)) as actual_effect_tx
      from entitlement_grants retired join subscription_controlled_paid_period_receipts effect on effect.id=${effect.id}::uuid
      join entitlement_grants fresh on fresh.id=${firstFresh.id}::uuid and fresh.source_subscription_id=effect.subscription_id
      where retired.source_subscription_id=effect.subscription_id and retired.id in(${sql.join(f.grants.map(row => sql`${row.id}::uuid`), sql`,`)})`);
    expect(retirementStamp).toEqual({ count: f.grants.length, exact_time: true, actual_effect_tx: true });
    expect(fresh.map(row => row.entitlementId).sort()).toEqual(f.grants.map(row => row.entitlementId).sort());
    for (const grant of fresh) expect(grant).toMatchObject({ startsAt: effect.effectAt, endsAt: effect.periodEnd, used: 0, status: "active" });
    expect(await advanceSubscriptionPeriod.call({ subscriptionId: f.parent.id, contactId: f.parent.contactId, planId: effect.planId,
      planName: f.original.plan.name, startsAt: effect.effectAt, endsAt: effect.periodEnd }, { kind: "system" })).toEqual({ grantIds: fresh.map(row => row.id), alreadyGranted: true });
    expect((await failure(advanceSubscriptionPeriod.call({ subscriptionId: f.parent.id, contactId: f.parent.contactId, planId: effect.planId,
      planName: f.original.plan.name, startsAt: new Date(effect.effectAt.getTime() + 1), endsAt: new Date(effect.periodEnd.getTime() + 1) }, { kind: "system" }))).code).toBe("conflict");
    expect(await completePaidControlledPeriod.call({ invoiceId: applied.invoiceId }, { kind: "system" })).toMatchObject({ state: "already_applied", financialReviewPending: null });
    expect(await db().select().from(entitlementGrants).where(eq(entitlementGrants.sourceSubscriptionId, f.parent.id)).orderBy(entitlementGrants.id)).toEqual(current);
    const invoiceHistory = await db().transaction(async tx => {
      const invoiceHistory = await controlledFinancialWitness(tx, { invoiceIds: [applied.invoiceId] });
      expect(invoiceHistory.incomplete).toBe(false);
      const paidEntries = invoiceHistory.entries.filter(row => row.table === "subscription_controlled_paid_period_receipts");
      expect(paidEntries.map(row => row.id)).toEqual([effect.id]);
      expect(new Set(invoiceHistory.entries.map(row => `${row.table}:${row.id}`)).size).toBe(invoiceHistory.entries.length);
      const subjectHistory = await controlledFinancialWitness(tx, { subscriptionIds: [fixture.parent.id] });
      expect(subjectHistory.paid?.entries).toEqual(invoiceHistory.paid?.entries);
      const cashHistory = await merchantRefundDependencyFingerprints(tx, { paymentIds: applied.payments.map(row => row.paymentId), subscriptionChargeReceiptIds: [receipt.id] });
      expect(cashHistory.incomplete).toBe(false); expect(cashHistory.entries.filter(row => row.table === "subscription_controlled_paid_period_receipts").map(({ table, id, fingerprint }) => ({ table, id, fingerprint }))).toEqual(paidEntries.map(({ table, id, fingerprint }) => ({ table, id, fingerprint })));
      const invoiceFootprint = await invoiceMerchantDependencyFingerprints(tx, [applied.invoiceId]);
      expect(invoiceFootprint?.has(applied.invoiceId)).toBe(true);
      const buyerArchive = await exportControlledFinancialHistory(tx, { invoiceIds: [applied.invoiceId] });
      expect(buyerArchive.exported.originalPaidPeriods?.receipts.map(row => row.id)).toEqual([effect.id]);
      expect(JSON.stringify(buyerArchive.exported.originalPaidPeriods)).not.toMatch(/financialReview|authentication|beforeEntries|beforeParentFields|bankRevisions|admissionTransaction|nonce/);
      const ownerProfile = invoiceHistory.paid?.entries[0]?.parents.profileId;
      if (!ownerProfile) throw Error("Retain the actual original accepted quote profile.");
      const merchantArchive = await exportControlledFinancialHistory(tx, { profileIds: [ownerProfile] });
      expect(merchantArchive.exported.originalPaidPeriods?.receipts).toEqual([expect.objectContaining({ id: effect.id, financialReviewPendingAtActivation: effect.financialReviewPending })]);
      return invoiceHistory;
    });
    const survivor = await createContact.call({ name: "Actual paid-period buyer alias", email: "paid-period-alias@example.test" }, OWNER);
    expect(await db().select({ id: carts.id, contactId: carts.contactId, status: carts.status, kind: carts.kind }).from(carts).where(inArray(carts.contactId, [survivor.id, f.parent.contactId]))).toEqual([]);
    const merge = await mergeContacts.call({ survivingId: survivor.id, duplicateId: f.parent.contactId }, OWNER);
    const moved = await db().select().from(entitlementGrants).where(eq(entitlementGrants.sourceSubscriptionId, f.parent.id)).orderBy(entitlementGrants.id);
    const [mergeStamp] = await db().execute<{ stamp: string; count: number; stamp_count: number; actual_tx: boolean }>(sql`select min(g.updated_at)::text as stamp,
      count(*)::integer as count,count(distinct g.updated_at)::integer as stamp_count,
      bool_and(g.xmin=operation.xmin and g.updated_at<=operation.merged_at) as actual_tx
      from entitlement_grants g join contact_merge_operations operation on operation.id=${merge.mergeOperationId}::uuid
      where g.id in(${sql.join(current.map(row => sql`${row.id}::uuid`), sql`,`)})`);
    expect(mergeStamp).toMatchObject({ count: current.length, stamp_count: 1, actual_tx: true });
    const mergedUpdatedAt = z.coerce.date().parse(mergeStamp?.stamp);
    expect(moved).toEqual(current.map(row => ({ ...row, contactId: survivor.id, updatedAt: mergedUpdatedAt })));
    await db().transaction(async tx => {
      expect((await controlledPaidPeriodWitnesses(tx, { subscriptionIds: [fixture.parent.id] })).entries).toHaveLength(1);
      expect((await controlledFinancialWitness(tx, { invoiceIds: [applied.invoiceId] })).paid?.entries).toEqual(invoiceHistory.paid?.entries);
      const exported = await exportControlledPaidPeriodHistory(tx, { subscriptionIds: [fixture.parent.id] }, { merchant: false });
      expect(exported.receipts).toHaveLength(1); expect(JSON.stringify(exported.receipts)).not.toMatch(/authentication|beforeEntries|beforeParentFields|bankRevisions|admissionTransaction|nonce/);
    });
    await undoContactMerge.call({ operationId: merge.mergeOperationId }, OWNER);
    const restored = await db().select().from(entitlementGrants).where(eq(entitlementGrants.sourceSubscriptionId, f.parent.id)).orderBy(entitlementGrants.id);
    const [undoStamp] = await db().execute<{ stamp: string; count: number; stamp_count: number; actual_tx: boolean }>(sql`select min(g.updated_at)::text as stamp,
      count(*)::integer as count,count(distinct g.updated_at)::integer as stamp_count,
      bool_and(g.xmin=operation.xmin and operation.undone_at is not null and g.updated_at>operation.merged_at and g.updated_at<=operation.undone_at) as actual_tx
      from entitlement_grants g join contact_merge_operations operation on operation.id=${merge.mergeOperationId}::uuid
      where g.id in(${sql.join(current.map(row => sql`${row.id}::uuid`), sql`,`)})`);
    expect(undoStamp).toMatchObject({ count: current.length, stamp_count: 1, actual_tx: true });
    const restoredUpdatedAt = z.coerce.date().parse(undoStamp?.stamp);
    expect(restored).toEqual(current.map(row => ({ ...row, updatedAt: restoredUpdatedAt })));
  });
  it("applies only the authentic tiny receipt, preserves4199 unpaid and all original access, and creates no paid effect", async () => {
    f = await actualControlledPeriod84(); const open = await actualControlledOpenInvoice84(f);
    f.remote.externallyAttachPayment(open.providerInvoiceRef, 1, 0); const receipt = await retained(), applied = await moneyOnly(receipt.id);
    expect(applied.outstandingMinor).toBe(4199);
    expect((await db().select().from(invoices).where(eq(invoices.id, applied.invoiceId)))[0]).toMatchObject({ status: "partially_paid", paidMinor: 1 });
    expect(await completePaidControlledPeriod.call({ invoiceId: applied.invoiceId }, { kind: "system" })).toMatchObject({ handled: true, state: "awaiting_payment" });
    expect(await db().select().from(subscriptionControlledPaidPeriodReceipts).where(eq(subscriptionControlledPaidPeriodReceipts.collectionId, f.target.collectionId))).toHaveLength(0);
    expect(await db().select().from(entitlementGrants).where(eq(entitlementGrants.sourceSubscriptionId, f.parent.id))).toEqual(f.grants);
    expect((await db().select().from(payments).where(eq(payments.invoiceId, applied.invoiceId))).map(row => row.amountMinor)).toEqual([1]);
  });
  it("retains a real later external refund and fresh finished bank read, then refuses paid access even while the canonical invoice still sayspaid", async () => {
    f = await actualControlledPeriod84(); const receipt = await retained();
    // Hold the REAL dispatch at its actual postcommit boundary, retaining the
    // actual pending outbox row. Workers are genuinely stopped, not replaced
    // with an access stub. Fresh cash inspection dispatch remains unaffected.
    await stopJobs();
    const originalDispatch = outbox.dispatchNow;
    let entered: () => void = () => {}, release: () => void = () => {};
    const holding = new Promise<void>(resolve => { entered = resolve; }), gate = new Promise<void>(resolve => { release = resolve; });
    vi.spyOn(outbox, "dispatchNow").mockImplementation(async events => {
      if (events.some(event => event.eventName === "invoice.paid" && z.object({ invoiceId: z.literal(f!.target.invoiceId) }).passthrough().safeParse(event.payload).success)) {
        entered(); await gate;
      }
      return originalDispatch(events);
    });
    const pending = moneyOnly(receipt.id);
    try {
      await Promise.race([holding, pending.then(() => { throw Error("The genuine paid outbox dispatch did not reach its postcommit hold."); })]);
      expect((await db().select().from(invoices).where(eq(invoices.id, f.target.invoiceId)))[0]).toMatchObject({ status: "paid", paidMinor: 4200 });
      f.remote.externallyRefundPayment(receipt.providerPaymentIntentRef, 1);
      const read = await inspectControlledCashReceipt.call({ collectionId: f.target.collectionId, receiptId: receipt.id }, OWNER);
      expect(read.bankReadReturned).toBe(true);
      const states = await db().select().from(merchantCashReturnObservations).where(eq(merchantCashReturnObservations.inspectionId, read.inspectionId)).orderBy(merchantCashReturnObservations.sequence);
      expect(merchantReturnedCashEvidenceSchema.parse(states.at(-1)?.evidence).refunds).toMatchObject([{ amountMinor: 1, status: "succeeded" }]);
      expect((await failure(completePaidControlledPeriod.call({ invoiceId: f.target.invoiceId }, { kind: "system" }))).code).toBe("conflict");
      expect(await db().select().from(subscriptionControlledPaidPeriodReceipts).where(eq(subscriptionControlledPaidPeriodReceipts.collectionId, f.target.collectionId))).toHaveLength(0);
      expect(await db().select().from(entitlementGrants).where(eq(entitlementGrants.sourceSubscriptionId, f.parent.id))).toEqual(f.grants);
    } finally { release(); await pending; }
    // Release the actual original event: it must not grant after the retained
    // contradictory current bank facts either.
    expect(await db().select().from(subscriptionControlledPaidPeriodReceipts).where(eq(subscriptionControlledPaidPeriodReceipts.collectionId, f.target.collectionId))).toHaveLength(0);
    expect(await db().select().from(entitlementGrants).where(eq(entitlementGrants.sourceSubscriptionId, f.parent.id))).toEqual(f.grants);
  });
});
