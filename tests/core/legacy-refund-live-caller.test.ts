// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C5.06/C11.10: actual C0 services with one paused synthetic provider edge.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import * as adapters from "@/adapters/payments";
import type { PaymentAdapter } from "@/adapters/payments/types";
import { db } from "@/core/db";
import { resolveContact } from "@/core/contacts/service";
import { ready } from "@/core/runtime";
import { cancelRefund, createDraftInvoice, createPayment, issueInvoice, settlePayment } from "@/modules/invoicing/invoice-service";
import { submitProviderRefund } from "@/modules/invoicing/payment-provider-service";
import { payments, refunds } from "@/modules/invoicing/schema";
import { closeDb, hasDatabase, OWNER, truncateSpine } from "../helpers/spine";

describe.runIf(hasDatabase)("legacy provider refund physical caller", () => {
  beforeAll(ready, 60000);
  beforeEach(truncateSpine);
  afterAll(async () => { vi.restoreAllMocks(); await closeDb(); });
  it("keeps an admitted live refund reserved and records its eventual positive answer", async () => {
    const contact = (await resolveContact.call({ name: "Original refund buyer", email: "legacy-live-refund@example.test" }, OWNER)).contact;
    const draft = await createDraftInvoice.call({ contactId: contact.id, currency: "CAD", idempotencyKey: "legacy-live-refund-draft",
      lines: [{ description: "Original service", quantityMicros: 1000000, unitAmountMinor: 1000 }],
      tax: { mode: "not_applicable", reason: "Synthetic legacy refund control." } }, OWNER);
    const invoice = (await issueInvoice.call({ id: draft.invoice.id }, OWNER)).invoice;
    const payment = await createPayment.call({ invoiceId: invoice.id, provider: "stripe", method: "hosted_checkout", amountMinor: 1000,
      idempotencyKey: "legacy-live-refund-payment" }, OWNER);
    await settlePayment.call({ id: payment.id, providerRef: "pi_OriginalLegacyLiveRefund" }, OWNER);

    let release!: () => void;
    let enter!: () => void;
    const paused = new Promise<void>(resolve => { release = resolve; });
    const entered = new Promise<void>(resolve => { enter = resolve; });
    const physical: string[] = [];
    const refund = vi.fn(async (request: Parameters<PaymentAdapter["refund"]>[0]) => {
      physical.push(request.idempotencyKey);
      if (request.idempotencyKey === "legacy-live-refund-original") { enter(); await paused; }
      return { providerRef: request.idempotencyKey === "legacy-live-refund-original" ? "re_OriginalLive" : "re_ReplacementLive", status: "succeeded" as const };
    });
    const actual = adapters.paymentAdapter("stripe");
    vi.spyOn(adapters, "paymentAdapter").mockReturnValue({ ...actual, refund });
    const original = submitProviderRefund.call({ paymentId: payment.id, amountMinor: 1000, reason: "Original live provider refund",
      idempotencyKey: "legacy-live-refund-original" }, OWNER).then(value => ({ ok: true as const, value }), (error: unknown) => ({ ok: false as const, error }));
    let cancellation = "not_attempted", replacement = "not_attempted";
    try {
      await Promise.race([entered, original.then(() => { throw new Error("The original shared refund did not reach its provider edge."); })]);
      const [pending] = await db().select().from(refunds).where(eq(refunds.idempotencyKey, "legacy-live-refund-original"));
      if (!pending) throw new Error("The actual original refund reservation is missing.");
      cancellation = await cancelRefund.call({ id: pending.id, reason: "Do not cancel a live original provider request." }, OWNER)
        .then(value => value.status, () => "refused");
      replacement = await submitProviderRefund.call({ paymentId: payment.id, amountMinor: 1000, reason: "Replacement after local cancellation",
        idempotencyKey: "legacy-live-refund-replacement" }, OWNER).then(value => value.status, () => "refused");
    } finally {
      release();
      await original;
      vi.restoreAllMocks();
    }
    const first = await original;
    const [settled] = await db().select().from(payments).where(eq(payments.id, payment.id));
    const rows = await db().select().from(refunds).where(eq(refunds.paymentId, payment.id));
    const evidence = { cancellation, replacement, physicalKeys: physical, providerAcceptedMinor: physical.length * 1000,
      originalApplied: first.ok, ledgerRefundedMinor: settled?.refundedMinor,
      refunds: rows.map(row => ({ idempotencyKey: row.idempotencyKey, status: row.status, providerRef: row.providerRef })) };
    console.log("LEGACY_REFUND_CALLER_EVIDENCE", JSON.stringify(evidence));
    expect(evidence).toMatchObject({ cancellation: "refused", replacement: "refused", physicalKeys: ["legacy-live-refund-original"],
      providerAcceptedMinor: 1000, originalApplied: true, ledgerRefundedMinor: 1000 });
  });
});
