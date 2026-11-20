// Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0
// C12.38/C9.33. PREPARED/UNRUN. Genuine canonical money, no inserted proof/context.
import { eq } from "drizzle-orm";
import { z } from "zod";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/core/db";
import { defineService, getService } from "@/core/service";
import { ready } from "@/core/runtime";
import { stopJobs } from "@/core/jobs";
import { readOriginalCashPrincipalHistory } from "@/modules/invoicing/original-cash-principal";
import { readOriginalPrincipalEvidence } from "@/modules/invoicing/principal-authority";
import { originalCashRecoveries } from "@/modules/invoicing/original-cash-recovery-schema";
import { inspectControlledCashReceipt } from "@/modules/invoicing/controlled-cash-inspection-service";
import { collectControlledCollection } from "@/modules/subscriptions/controlled-provider-collection-orchestration";
import { subscriptionProviderChargeReceipts } from "@/modules/subscriptions/schema";
import { invoices, payments } from "@/modules/invoicing/schema";
import { CONTROLLED_COLLECTION_PROTOCOL } from "@/modules/subscriptions/controlled-provider-collection-protocol";
import { actualControlledPeriod84 } from "../helpers/actual-controlled-period84";
import { retainActualControlledManifest84 } from "../helpers/actual-controlled-current-manifest84";
import { actualControlledOpenInvoice84 } from "../helpers/actual-controlled-open-invoice84";
import { closeDb, hasDatabase, OWNER, truncateSpine } from "../helpers/spine";
const batch = z.object({ invoiceId: z.uuid(), batchId: z.uuid(), payments: z.array(z.object({ receiptId: z.uuid(), paymentId: z.uuid() }).strict()),
  outstandingMinor: z.number().int().nonnegative(), batchRevision: z.string(), suppliesAccessAuthority: z.literal(false) }).strict();
const principal = defineService({ name: "invoicing.controlledCurrentPrincipalForNative", summary: "Read authentic existing principal and current bare controlled bank facts in one genuine service transaction.",
  kind: "query", permission: "system", external: false, input: z.object({ paymentId: z.uuid() }).strict(),
  output: z.object({ principalSafe: z.boolean(), reviewRequired: z.boolean(), currentPrincipalMinor: z.number().int().nullable(), receiptOnly: z.boolean(), inventoryCount: z.number().int(), revision: z.string() }).strict(),
  handler: async ({ paymentId }, ctx) => { const raw = await readOriginalCashPrincipalHistory(ctx, { kind: "payment", paymentId });
    const actual = await readOriginalPrincipalEvidence(ctx, paymentId); return { principalSafe: actual.principalSafe, reviewRequired: raw.reviewRequired,
      currentPrincipalMinor: raw.currentPrincipalMinor, receiptOnly: raw.receiptOnly, inventoryCount: raw.inventoryCount, revision: raw.revision }; },
});
describe.runIf(hasDatabase)("current canonical controlled bank principal84", { timeout: 180000 }, () => {
  let fixture: Awaited<ReturnType<typeof actualControlledPeriod84>> | undefined;
  beforeAll(async () => { await ready(); await stopJobs(); }, 60000);
  beforeEach(async () => { await truncateSpine(); });
  afterEach(() => { vi.useRealTimers(); fixture?.cleanup(); fixture = undefined; vi.restoreAllMocks(); });
  afterAll(async () => { await stopJobs(); await closeDb(); });
  async function tiny() {
    fixture = await actualControlledPeriod84(); const current = fixture, open = await actualControlledOpenInvoice84(current);
    current.remote.externallyAttachPayment(open.providerInvoiceRef, 1, 0);
    await collectControlledCollection.call({ collectionId: current.target.collectionId }, OWNER);
    await retainActualControlledManifest84(current);
    const rows = await db().select().from(subscriptionProviderChargeReceipts).where(eq(subscriptionProviderChargeReceipts.subscriptionId, current.parent.id));
    expect(rows).toHaveLength(1); const receipt = rows[0]; if (!receipt) throw Error("Retain the genuine original positive receipt.");
    expect(await inspectControlledCashReceipt.call({ collectionId: current.target.collectionId, receiptId: receipt.id }, OWNER)).toMatchObject({ bankReadReturned: true, completeInventory: true });
    const service = getService("invoicing.applyControlledReceiptBatch");
    if (service.def.kind !== "mutation" || service.def.permission !== "system" || service.def.external !== false) throw Error("Use the genuine private application writer.");
    const money = batch.parse(await service.call({ collectionId: current.target.collectionId, receiptIds: [receipt.id], requiredProtocol: CONTROLLED_COLLECTION_PROTOCOL }, { kind: "system" }));
    expect(money.outstandingMinor).toBe(4199); const applied = money.payments[0]; if (!applied || money.payments.length !== 1) throw Error("One real receipt creates exactly one actual payment.");
    expect((await db().select().from(invoices).where(eq(invoices.id, money.invoiceId)))[0]).toMatchObject({ paidMinor: 1, status: "partially_paid" });
    expect(await db().select().from(originalCashRecoveries)).toHaveLength(0);
    return { current, receipt, applied };
  }
  it("proves a real applied one-cent principal independently of the unpaid target without manufacturing a recovery owner", async () => {
    const { applied } = await tiny();
    expect(await principal.call({ paymentId: applied.paymentId }, { kind: "system" })).toMatchObject({ principalSafe: true, reviewRequired: false, currentPrincipalMinor: 1, receiptOnly: false });
  });
  it("refuses a real later returned bank refund while canonical refund projection remains unchanged and no recovery owner exists", async () => {
    const { current, receipt, applied } = await tiny();
    const before = await principal.call({ paymentId: applied.paymentId }, { kind: "system" });
    expect(before.principalSafe).toBe(true);
    current.remote.externallyRefundPayment(receipt.providerPaymentIntentRef, 1);
    expect(await inspectControlledCashReceipt.call({ collectionId: current.target.collectionId, receiptId: receipt.id }, OWNER)).toMatchObject({ bankReadReturned: true, completeInventory: true });
    const after = await principal.call({ paymentId: applied.paymentId }, { kind: "system" });
    expect(after).toMatchObject({ principalSafe: false, reviewRequired: true, currentPrincipalMinor: null }); expect(after.revision).not.toBe(before.revision);
    expect((await db().select().from(payments).where(eq(payments.id, applied.paymentId)))[0]).toMatchObject({ amountMinor: 1, refundedMinor: 0 });
    expect(await db().select().from(originalCashRecoveries)).toHaveLength(0);
  });
});
