// Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0
// PREPARED/UNRUN: real original target, cash, bank, privacy and postcommit event.
import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/core/db";
import { ready } from "@/core/runtime";
import { defineService, getService } from "@/core/service";
import { prepareServiceJobRuntime, stopJobs } from "@/core/jobs";
import * as outbox from "@/core/events/outbox";
import { contacts } from "@/core/contacts/schema";
import { lockContactIdentityForRead } from "@/core/contacts/identity-lock";
import { createDataRequest, verifyDataRequest, addRetentionException } from "@/core/privacy/service";
import { entitlementGrants } from "@/core/entitlements/schema";
import { invoices, payments } from "@/modules/invoicing/schema";
import { inspectControlledCashReceipt } from "@/modules/invoicing/controlled-cash-inspection-service";
import { collectControlledCollection } from "@/modules/subscriptions/controlled-provider-collection-orchestration";
import { completePaidControlledPeriod } from "@/modules/subscriptions/controlled-provider-paid-period";
import { subscriptionControlledPaidPeriodReceipts } from "@/modules/subscriptions/controlled-provider-paid-period-schema";
import { subscriptionProviderChargeReceipts } from "@/modules/subscriptions/schema";
import { CONTROLLED_COLLECTION_PROTOCOL } from "@/modules/subscriptions/controlled-provider-collection-protocol";
import { actualControlledPeriod84 } from "../helpers/actual-controlled-period84";
import { retainActualControlledManifest84 } from "../helpers/actual-controlled-current-manifest84";
import { closeDb, failure, hasDatabase, OWNER, truncateSpine } from "../helpers/spine";

const captureMoney = defineService({
  name: "tests.applyActualPrivacyPeriodCash", summary: "Commit only actual retained cash before the independent privacy-sensitive paid effect.",
  kind: "mutation", permission: "system", external: false,
  input: z.object({ collectionId: z.uuid(), receiptId: z.uuid() }),
  output: z.object({ invoiceId: z.uuid(), outstandingMinor: z.number().int() }),
  handler: async (input, ctx) => {
    const writer = getService("invoicing.applyControlledReceiptBatch");
    if (!writer || writer.def.permission !== "system" || writer.def.external !== false) throw Error("The genuine private batch writer is required.");
    return z.object({ invoiceId: z.uuid(), outstandingMinor: z.number().int() }).parse(await ctx.callAsSystem(writer,
      { collectionId: input.collectionId, receiptIds: [input.receiptId], requiredProtocol: CONTROLLED_COLLECTION_PROTOCOL }));
  },
});
function barrier() {
  let enter: () => void = () => {}, release: () => void = () => {};
  const entered = new Promise<void>(resolve => { enter = resolve; }), gate = new Promise<void>(resolve => { release = resolve; });
  return { enter, release, entered, gate };
}
// Real service transactions, not fabricated ServiceContexts or raw lock tokens.
let admissionBarrier: ReturnType<typeof barrier> | undefined;
const holdVerifiedRequest = defineService({
  name: "tests.holdActualVerifiedPrivacyRequest", summary: "Hold the genuine verified request transaction before its real commit.",
  kind: "mutation", permission: "scoped", external: false,
  input: z.object({ requestId: z.uuid() }), output: z.object({ verified: z.literal(true) }),
  handler: async (input, ctx) => {
    await ctx.call(verifyDataRequest, { id: input.requestId, method: "Recorded owner verification during the real concurrency acceptance." });
    if (!admissionBarrier) throw Error("Install the real transaction barrier.");
    admissionBarrier.enter(); await admissionBarrier.gate; return { verified: true as const };
  },
});
const holdPaidEffect = defineService({
  name: "tests.holdActualPrivacyPaidEffect", summary: "Hold the shared identity prefix before a real independent paid-effect transaction.",
  kind: "mutation", permission: "system", external: false,
  input: z.object({ invoiceId: z.uuid() }), output: z.object({ state: z.string() }),
  handler: async (input, ctx) => {
    await lockContactIdentityForRead(ctx.tx);
    if (!admissionBarrier) throw Error("Install the real transaction barrier.");
    admissionBarrier.enter(); await admissionBarrier.gate;
    return { state: (await ctx.callAsSystem(completePaidControlledPeriod, input)).state };
  },
});

describe.runIf(hasDatabase)("actual original-owner paid-access privacy fence", { timeout: 180000 }, () => {
  let f: Awaited<ReturnType<typeof actualControlledPeriod84>> | undefined;
  beforeAll(ready, 60000); beforeEach(truncateSpine);
  afterEach(() => { admissionBarrier?.release(); admissionBarrier = undefined; f?.cleanup(); f = undefined; vi.restoreAllMocks(); });
  afterAll(async () => { await stopJobs(); await closeDb(); });
  async function heldMoney() {
    f = await actualControlledPeriod84(); const fixture = f;
    expect(await collectControlledCollection.call({ collectionId: fixture.target.collectionId }, OWNER)).toMatchObject({ state: "money_retained", applied: false });
    await retainActualControlledManifest84(fixture);
    const receipts = await db().select().from(subscriptionProviderChargeReceipts).where(eq(subscriptionProviderChargeReceipts.subscriptionId, fixture.parent.id));
    expect(receipts).toHaveLength(1); const receipt = receipts[0]; if (!receipt) throw Error("Retain genuine bank cash first.");
    expect(await inspectControlledCashReceipt.call({ collectionId: fixture.target.collectionId, receiptId: receipt.id }, OWNER)).toMatchObject({ bankReadReturned: true, completeInventory: true });
    await stopJobs(); await prepareServiceJobRuntime();
    const originalDispatch = outbox.dispatchNow, paid = barrier();
    vi.spyOn(outbox, "dispatchNow").mockImplementation(async events => {
      if (events.some(event => event.eventName === "invoice.paid" && z.object({ invoiceId: z.literal(fixture.target.invoiceId) }).passthrough().safeParse(event.payload).success)) {
        paid.enter(); await paid.gate;
      }
      return originalDispatch(events);
    });
    const pending = captureMoney.call({ collectionId: fixture.target.collectionId, receiptId: receipt.id }, { kind: "system" });
    try { await Promise.race([paid.entered, pending.then(() => { throw Error("The actual committed paid event did not reach its barrier."); })]); }
    catch (error) { paid.release(); await pending.catch(() => {}); throw error; }
    expect((await db().select().from(invoices).where(eq(invoices.id, fixture.target.invoiceId)))[0]).toMatchObject({ status: "paid", totalMinor: 4200, paidMinor: 4200 });
    const money = await db().select().from(payments).where(eq(payments.invoiceId, fixture.target.invoiceId)); expect(money).toHaveLength(1);
    return { fixture, receipt, money, pending, release: paid.release };
  }
  async function unchangedAccess(fixture: NonNullable<typeof f>) {
    expect(await db().select().from(subscriptionControlledPaidPeriodReceipts).where(eq(subscriptionControlledPaidPeriodReceipts.collectionId, fixture.target.collectionId))).toHaveLength(0);
    // Compared by id, not by the order the plan happened to return. Both sides
    // are unordered selects, so under contention two grants with 131ms between
    // their createdAt came back swapped and a deep-equality assertion failed on
    // identical data -- measured 2026-11-19 in a three-way parallel run. The
    // capture side lives in tests/helpers/actual-controlled-period84.ts, which
    // is in the controlled-cash-origin-batch84 protected set, so the ordering
    // is applied here rather than by editing a file declared unchanged.
    const byGrantId = (rows: typeof fixture.grants) => [...rows].sort((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0);
    expect(byGrantId(await db().select().from(entitlementGrants).where(eq(entitlementGrants.sourceSubscriptionId, fixture.parent.id)))).toEqual(byGrantId(fixture.grants));
  }
  it.each(["buyer", "merchant"] as const)("retains real fully paid cash but refuses new access and the original event retry after actual verified %s erasure", async owner => {
    const h = await heldMoney();
    try {
      const [frozenMerchant] = await db().execute<{ contact_id: string }>(sql`select profile.contact_id from subscription_controlled_collections collection
        join subscription_controlled_quotes quote on quote.id=collection.quote_id join merchant_tax_profiles profile on profile.id=quote.profile_id where collection.id=${h.fixture.target.collectionId}::uuid`);
      const contactId = owner === "buyer" ? h.fixture.parent.contactId : frozenMerchant?.contact_id;
      if (!contactId) throw Error("The actual frozen target owner is required.");
      const request = await createDataRequest.call({ contactId, request: { kind: "erasure" } }, OWNER);
      await verifyDataRequest.call({ id: request.id, method: "Actual recorded owner verification after the real payment commit." }, OWNER);
      expect((await db().select().from(contacts).where(eq(contacts.id, contactId)))[0]?.source).not.toBe("privacy-erasure");
      expect(await completePaidControlledPeriod.call({ invoiceId: h.fixture.target.invoiceId }, { kind: "system" })).toMatchObject({ handled: true, state: "review_required" });
      await unchangedAccess(h.fixture);
      expect(await db().select().from(payments).where(eq(payments.invoiceId, h.fixture.target.invoiceId))).toEqual(h.money);
    } finally { h.release(); await h.pending; }
    await unchangedAccess(h.fixture);
  });
  it("refuses actual verification while a real paid-effect shared identity transaction is active", async () => {
    const h = await heldMoney(); let effect: ReturnType<typeof holdPaidEffect.call> | undefined;
    try {
      const request = await createDataRequest.call({ contactId: h.fixture.parent.contactId, request: { kind: "erasure" } }, OWNER);
      admissionBarrier = barrier(); effect = holdPaidEffect.call({ invoiceId: h.fixture.target.invoiceId }, { kind: "system" });
      await Promise.race([admissionBarrier.entered, effect.then(() => { throw Error("Missing actual effect transaction barrier."); })]);
      expect((await failure(verifyDataRequest.call({ id: request.id, method: "Real concurrent owner verification." }, OWNER))).code).toBe("conflict");
      admissionBarrier.release(); expect(await effect).toMatchObject({ state: "applied" });
      await verifyDataRequest.call({ id: request.id, method: "Actual retry after independent paid access commits." }, OWNER);
    } finally { admissionBarrier?.release(); if (effect) await effect; h.release(); await h.pending; }
  });
  it("refuses a real concurrent effect during exclusive verification and then refuses access after that verified request commits", async () => {
    const h = await heldMoney(); let verification: ReturnType<typeof holdVerifiedRequest.call> | undefined;
    try {
      const request = await createDataRequest.call({ contactId: h.fixture.parent.contactId, request: { kind: "erasure" } }, OWNER);
      admissionBarrier = barrier(); verification = holdVerifiedRequest.call({ requestId: request.id }, OWNER);
      await Promise.race([admissionBarrier.entered, verification.then(() => { throw Error("Missing actual verification transaction barrier."); })]);
      expect((await failure(completePaidControlledPeriod.call({ invoiceId: h.fixture.target.invoiceId }, { kind: "system" }))).code).toBe("conflict");
      // Another backend's real exclusive lock cannot authorize this backend's SQL writer.
      await expect(db().transaction(tx => tx.execute(sql`update contacts set source='privacy-erasure' where id=${h.fixture.parent.contactId}::uuid`))).rejects.toMatchObject({ cause: { code: "23514" } });
      admissionBarrier.release(); await verification;
      expect(await completePaidControlledPeriod.call({ invoiceId: h.fixture.target.invoiceId }, { kind: "system" })).toMatchObject({ handled: true, state: "review_required" });
      await unchangedAccess(h.fixture);
    } finally { admissionBarrier?.release(); if (verification) await verification; h.release(); await h.pending; }
    await unchangedAccess(h.fixture);
  });
  it("refuses direct SQL restriction onset and request/retention ownership rebinding without the actual exclusive identity prefix", async () => {
    const h = await heldMoney();
    try {
      const request = await createDataRequest.call({ contactId: h.fixture.parent.contactId, request: { kind: "erasure" } }, OWNER);
      await expect(db().transaction(tx => tx.execute(sql`update data_requests set status='verified',verified_at=clock_timestamp() where id=${request.id}::uuid`))).rejects.toMatchObject({ cause: { code: "23514" } });
      await expect(db().transaction(tx => tx.execute(sql`update contacts set source='privacy-erasure' where id=${h.fixture.parent.contactId}::uuid`))).rejects.toMatchObject({ cause: { code: "23514" } });
      await expect(db().transaction(async tx => {
        await tx.execute(sql`select pg_advisory_xact_lock_shared(hashtext('contact-identity-privacy'))`);
        await tx.execute(sql`update contacts set source='privacy-erasure' where id=${h.fixture.parent.contactId}::uuid`);
      })).rejects.toMatchObject({ cause: { code: "23514" } });
      await expect(db().transaction(async tx => {
        await tx.execute(sql`select pg_advisory_xact_lock(hashtext('a-different-privacy-key'))`);
        await tx.execute(sql`update contacts set source='privacy-erasure' where id=${h.fixture.parent.contactId}::uuid`);
      })).rejects.toMatchObject({ cause: { code: "23514" } });
      // Actual merchant contact is returned by the real immutable quote profile.
      const [merchant] = await db().execute<{ contact_id: string }>(sql`select profile.contact_id from subscription_controlled_collections collection
        join subscription_controlled_quotes quote on quote.id=collection.quote_id join merchant_tax_profiles profile on profile.id=quote.profile_id where collection.id=${h.fixture.target.collectionId}::uuid`);
      if (!merchant?.contact_id) throw Error("A genuine frozen seller contact is required.");
      const other = await createDataRequest.call({ contactId: merchant.contact_id, request: { kind: "erasure" } }, OWNER);
      const hold = await addRetentionException.call({ dataRequestId: other.id, scope: "commerce.money", reason: "accounting_tax", legalBasis: "Actual owner-recorded required accounting retention." }, OWNER);
      await expect(db().transaction(tx => tx.execute(sql`update privacy_retention_exceptions set data_request_id=${request.id}::uuid where id=${hold.id}::uuid`))).rejects.toMatchObject({ cause: { code: "23514" } });
      await expect(db().transaction(tx => tx.execute(sql`update data_requests set contact_id=${h.fixture.parent.contactId}::uuid where id=${other.id}::uuid`))).rejects.toMatchObject({ cause: { code: "23514" } });
      await verifyDataRequest.call({ id: request.id, method: "Actual owner verification for rebinding refusal acceptance." }, OWNER);
      await expect(db().transaction(tx => tx.execute(sql`update data_requests set contact_id=${merchant.contact_id}::uuid where id=${request.id}::uuid`))).rejects.toMatchObject({ cause: { code: "23514" } });
      await unchangedAccess(h.fixture);
    } finally { h.release(); await h.pending; }
  });
});
