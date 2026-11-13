// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.38: PREPARED/UNRUN actual shared journeys; only provider edges synthetic.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/core/db";
import { ready } from "@/core/runtime";
import { stopJobs, reconcileJobDeploymentAdmission } from "@/core/jobs";
import { getService } from "@/core/service";
import { invoices, payments, creditNotes, creditNoteLines, refunds } from "@/modules/invoicing/schema";
import { returnRefundAllocations } from "@/modules/catalog/schema";
import { originalCashRecoveries, originalCashRecoveryOperations, originalCashRecoveryFacts } from "@/modules/invoicing/original-cash-recovery-schema";
import { merchantRefundRequests, merchantUnappliedChargeResolutions } from "@/modules/invoicing/merchant-refund-schema";
import { originalCashRecoveryFinancialWitness } from "@/modules/invoicing/original-cash-recovery-store";
import { inspectOriginalCashReturn } from "@/modules/invoicing/original-cash-recovery";
import { reviewOriginalUnassignedCash } from "@/modules/invoicing/original-cash-unassigned-service";
import { ORIGINAL_UNASSIGNED_CASH_CONFIRMATION } from "@/modules/invoicing/original-cash-partial-contract";
import { partialCashFixture } from "../helpers/original-cash-partial";
import { closeDb, hasDatabase, OWNER, truncateSpine } from "../helpers/spine";
describe.runIf(hasDatabase)("original partial cash checkpoint81", { timeout: 60000 }, () => {
  let active: Awaited<ReturnType<typeof partialCashFixture>> | undefined;
  beforeAll(ready, 60000); beforeEach(truncateSpine);
  afterEach(async () => { active?.release.resolve(); active?.base.cleanup(); active = undefined; vi.restoreAllMocks(); await stopJobs(); await reconcileJobDeploymentAdmission(); await closeDb(); }); afterAll(closeDb);
  it("reconciles three real returned original units cumulatively while preserving every issued credit, part and line", async () => {
    active = await partialCashFixture();
    for (let generation = 1; generation <= 3; generation++) {
      await active.returnOne();
      const notes = await db().select().from(creditNotes), lines = await db().select().from(creditNoteLines), parts = await db().select().from(returnRefundAllocations), customer = await db().select().from(refunds);
      const result = await active.partial(); expect(result.closureFactId).toBeTruthy();
      const posts = [...active.posts]; await active.partial(); expect(active.posts).toEqual(posts);
      expect(active.posts.filter(kind => kind === "customer")).toHaveLength(generation);
      expect(active.posts.filter(kind => kind === "fee")).toHaveLength(generation);
      expect(active.posts.filter(kind => kind === "recipient")).toHaveLength(generation);
      expect(await db().select().from(creditNotes)).toEqual(notes); expect(await db().select().from(creditNoteLines)).toEqual(lines);
      expect(await db().select().from(returnRefundAllocations)).toEqual(parts); expect(await db().select().from(refunds)).toEqual(customer);
      for (const note of notes) expect(await getService("invoicing.creditNoteDisposition").call({ creditNoteId: note.id }, { kind: "system" })).toMatchObject({ reservedForReturns: true, reservedMinor: note.totalMinor, availableMinor: 0, appliedMinor: 0 });
      const facts = await db().select().from(originalCashRecoveryFacts), target = facts.find(fact => fact.id === result.targetFactId)!;
      expect(target.evidence).toMatchObject({ originalPrincipalMinor: active.amount, customerReturnedMinor: active.amount * generation / 3, recipientTargetMinor: active.amount * generation / 3, feeTargetMinor: 400 * generation });
      expect((await db().select().from(payments).where(eq(payments.id, active.paymentId)))[0]).toMatchObject({ status: "succeeded", amountMinor: active.amount, refundedMinor: active.amount * generation / 3 });
      expect((await db().select().from(invoices).where(eq(invoices.id, active.invoiceId)))[0]).toMatchObject({ paidMinor: active.amount, refundedMinor: active.amount * generation / 3 });
    }
  });
  it("recovers an accepted unreadable second equal recipient generation by exact metadata and never repeats its POST", async () => {
    active = await partialCashFixture({ unreadableSecondRecipient: true }); await active.returnOne(); await active.partial(); await active.returnOne();
    await expect(active.partial()).rejects.toThrow();
    expect(active.posts).toEqual(["customer", "fee", "recipient", "customer", "fee", "recipient"]);
    expect((await db().select().from(originalCashRecoveryFacts)).some(fact => fact.kind === "finish" && fact.evidence.outcome === "threw")).toBe(true);
    const before = [...active.posts]; await active.partial(); expect(active.posts).toEqual(before);
    const operations = await db().select().from(originalCashRecoveryOperations), facts = await db().select().from(originalCashRecoveryFacts), recipients = operations.filter(operation => operation.kind === "recipient");
    expect(recipients).toHaveLength(2); expect(new Set(recipients.map(operation => operation.request.targetFactId)).size).toBe(2);
    const refs = recipients.map(operation => new Set(facts.filter(fact => fact.operationId === operation.id && fact.kind === "ack").map(fact => fact.evidence.providerRef)));
    expect(refs.every(ref => ref.size === 1)).toBe(true); expect([...refs[0]!][0]).not.toBe([...refs[1]!][0]);
    expect((await db().select().from(payments).where(eq(payments.id, active.paymentId)))[0]?.refundedMinor).toBe(active.amount * 2 / 3);
  });
  it("owns signed unassigned feedback before its first cash owner and returns only the reviewed actual unapplied remainder", async () => {
    active = await partialCashFixture({ unapplied: true }); const resource = active.dashboardRefund(active.amount / 3); await active.signedDashboard(resource);
    const beforePayment = await db().select().from(payments), beforeRefunds = await db().select().from(refunds);
    const original = await db().transaction(tx => originalCashRecoveryFinancialWitness(tx, [active!.paymentId], []));
    expect(original.owners).toHaveLength(0); expect(original.operations).toHaveLength(0);
    expect(original.feedback.some(entry => entry.namespace.paymentId === active!.paymentId && entry.feedback.evidence.observedRefundRef === resource.providerRef)).toBe(true);
    await expect(active.run()).rejects.toMatchObject({ code: "conflict" }); expect(active.posts).toEqual([]);
    const [owner] = await db().select().from(originalCashRecoveries); expect(owner).toBeTruthy();
    await inspectOriginalCashReturn.call({ recoveryId: owner!.id }, OWNER);
    const facts = await db().select().from(originalCashRecoveryFacts), raw = facts.filter(fact => fact.kind === "refund" && fact.evidence.providerRef === resource.providerRef).sort((a,b) => b.sequence-a.sequence)[0]!;
    await reviewOriginalUnassignedCash.call({ recoveryId: owner!.id, operationId: raw.operationId!, rawFactId: raw.id, confirmation: ORIGINAL_UNASSIGNED_CASH_CONFIRMATION }, OWNER);
    await active.run(); expect(active.posts).toEqual(["customer", "fee", "recipient"]);
    const requests = await db().select().from(merchantRefundRequests);
    expect(requests).toHaveLength(1); expect(requests[0]).toMatchObject({ purpose: "unapplied_return", refundId: null, amountMinor: active.amount * 2 / 3 });
    expect(await db().select().from(payments)).toEqual(beforePayment); expect(await db().select().from(refunds)).toEqual(beforeRefunds);
    expect(await db().select().from(creditNotes)).toHaveLength(0); expect(await db().select().from(merchantUnappliedChargeResolutions)).toHaveLength(1);
    const posts = [...active.posts]; await active.run(); expect(active.posts).toEqual(posts);
  });
});
