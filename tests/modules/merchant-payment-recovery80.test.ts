// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.38: actual current checkout/service spine; provider edge is synthetic.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/core/db";
import { ready } from "@/core/runtime";
import { AdapterError } from "@/adapters/types";
import { createPayment, failPayment, getInvoice } from "@/modules/invoicing/invoice-service";
import { claimMerchantPaymentDispatch } from "@/modules/invoicing/merchant-payment-request";
import { reconcileMerchantCheckout } from "@/modules/invoicing/merchant-payment-recovery";
import { merchantPaymentRetirementAcks, merchantPaymentTerminalReceipts } from "@/modules/invoicing/merchant-payment-recovery-schema";
import { invoiceMerchantAllocations, invoices, payments } from "@/modules/invoicing/schema";
import { invoiceMerchantCollections } from "@/modules/invoicing/merchant-collection-schema";
import { ANONYMOUS, closeDb, failure, hasDatabase, OWNER, truncateSpine } from "../helpers/spine";
import { seedMerchantCheckout80 } from "../helpers/merchant-checkout80";

const SYSTEM = { kind: "system" } as const;
describe.runIf(hasDatabase)("original merchant payment recovery on schema80", { timeout: 60000 }, () => {
  let fixture: Awaited<ReturnType<typeof seedMerchantCheckout80>> | undefined;
  beforeAll(ready, 60000);
  beforeEach(truncateSpine);
  afterEach(() => { fixture?.cleanup(); fixture = undefined; vi.restoreAllMocks(); });
  afterAll(closeDb);

  it.each(["direct", "destination"] as const)("freezes two actual sellers on one %s invoice and blocks whole-invoice collection", async kind => {
    fixture = await seedMerchantCheckout80(kind, 2);
    const quoted = await fixture.review();
    expect(quoted).toMatchObject({ collectionKind: kind, amounts: { subtotalMinor: 5000, taxMinor: 250, totalMinor: 5250 } });
    const placed = await fixture.checkout(), invoiceId = placed.order.invoiceId!;
    expect(await db().select().from(invoices)).toHaveLength(1);
    const portions = await db().select().from(invoiceMerchantAllocations).where(eq(invoiceMerchantAllocations.invoiceId, invoiceId));
    const collections = await db().select().from(invoiceMerchantCollections).where(eq(invoiceMerchantCollections.invoiceId, invoiceId));
    expect(portions).toHaveLength(2); expect(collections).toHaveLength(2);
    expect(portions.reduce((sum, row) => sum + row.totalMinor, 0)).toBe(5250);
    expect(collections.every(row => row.collectionKind === kind && (kind === "direct" ? row.chargeAccountId === row.recipientAccountId : row.chargeAccountId === null))).toBe(true);
    expect(await failure(createPayment.call({ invoiceId, provider: "stripe", method: "saved_method", amountMinor: 5250, idempotencyKey: crypto.randomUUID() }, OWNER))).toMatchObject({ code: "conflict" });
  });

  it("keeps a lost saved-card cancellation ACK, blocks replacement while unknown, and releases only exact zero-money terminal proof", async () => {
    fixture = await seedMerchantCheckout80("destination");
    const placed = await fixture.checkout(), invoiceId = placed.order.invoiceId!;
    const payment = await createPayment.call({ invoiceId, provider: "stripe", method: "saved_method", amountMinor: placed.order.totalMinor, idempotencyKey: crypto.randomUUID() }, OWNER);
    await claimMerchantPaymentDispatch.call({ paymentId: payment.id, requestDigest: "a".repeat(64) }, SYSTEM);
    expect(await failure(failPayment.call({ id: payment.id, code: "human_not_charged", message: "No provider absence proof" }, OWNER))).toMatchObject({ code: "conflict" });
    expect(await failure(createPayment.call({ invoiceId, provider: "stripe", method: "hosted_checkout", amountMinor: payment.amountMinor, idempotencyKey: crypto.randomUUID() }, OWNER))).toMatchObject({ code: "conflict" });
    const terminal = { state: "not_paid" as const, paymentRef: "pi_originalSaved", intentStatus: "canceled" as const, amountReceivedMinor: 0 as const };
    fixture.stripe.recoverMerchantIntent = async () => terminal;
    fixture.stripe.retireMerchantIntent = async request => {
      await request.onRetirementAcknowledged?.({ paymentRef: terminal.paymentRef, kind: "intent_canceled" });
      throw new AdapterError("payments", "stripe", "provider_failure", "Synthetic lost final read", true);
    };
    await expect(reconcileMerchantCheckout.call({ paymentId: payment.id, action: "retire" }, OWNER)).rejects.toMatchObject({ code: "provider_failure" });
    expect(await db().select().from(merchantPaymentRetirementAcks)).toEqual([expect.objectContaining({ paymentId: payment.id, checkoutRef: null, paymentRef: terminal.paymentRef, kind: "intent_canceled" })]);
    expect(await db().select().from(merchantPaymentTerminalReceipts)).toHaveLength(0);
    expect((await db().select().from(payments).where(eq(payments.id, payment.id)))[0]!.status).toBe("created");
    expect(await failure(reconcileMerchantCheckout.call({ paymentId: payment.id, action: "inspect" }, ANONYMOUS))).toMatchObject({ code: "permission" });
    expect((await reconcileMerchantCheckout.call({ paymentId: payment.id, action: "inspect" }, OWNER)).payment.status).toBe("failed");
    expect(await db().select().from(merchantPaymentTerminalReceipts)).toEqual([expect.objectContaining({ paymentId: payment.id, checkoutRef: null, sessionStatus: null, paymentRef: terminal.paymentRef, amountReceivedMinor: 0 })]);
    const replacement = await createPayment.call({ invoiceId, provider: "stripe", method: "hosted_checkout", amountMinor: payment.amountMinor, idempotencyKey: crypto.randomUUID() }, OWNER);
    expect(replacement.id).not.toBe(payment.id);
    expect((await getInvoice.call({ id: invoiceId }, OWNER)).invoice.paidMinor).toBe(0);
  });
});
