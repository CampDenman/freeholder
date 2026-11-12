// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C5.06/C11.10: actual short phases around a synthetic provider promise.
import { createHash, createHmac, randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import * as adapters from "@/adapters/payments";
import type { PaymentAdapter } from "@/adapters/payments/types";
import { createStripePayments } from "@/adapters/payments/stripe";
import { AdapterError } from "@/adapters/types";
import { db } from "@/core/db";
import * as environment from "@/core/env";
import { resolveContact } from "@/core/contacts/service";
import { ready } from "@/core/runtime";
import { ServiceError } from "@/core/service";
import { cancelRefund, createDraftInvoice, createPayment, createRefund, failRefund, issueInvoice, reserveRefundBatch, settlePayment, settleRefund, startRefund } from "@/modules/invoicing/invoice-service";
import { processPaymentProviderEvents, recordProviderRefundCaller, submitProviderRefund } from "@/modules/invoicing/payment-provider-service";
import { moneyStateEvents, payments, refunds } from "@/modules/invoicing/schema";
import { closeDb, hasDatabase, OWNER, truncateSpine } from "../helpers/spine";

async function payment(key: string) {
  const contact = (await resolveContact.call({ name: "Original refund buyer", email: `${key}@example.test` }, OWNER)).contact;
  const draft = await createDraftInvoice.call({ contactId: contact.id, currency: "CAD", idempotencyKey: `draft:${key}`,
    lines: [{ description: "Original service", quantityMicros: 1000000, unitAmountMinor: 1000 }],
    tax: { mode: "not_applicable", reason: "Synthetic original refund control." } }, OWNER);
  const invoice = (await issueInvoice.call({ id: draft.invoice.id }, OWNER)).invoice;
  const created = await createPayment.call({ invoiceId: invoice.id, provider: "stripe", method: "hosted_checkout", amountMinor: 1000, idempotencyKey: `payment:${key}` }, OWNER);
  return settlePayment.call({ id: created.id, providerRef: `pi_${key}` }, OWNER);
}
function input(paymentId: string, key: string) { return { paymentId, amountMinor: 1000, reason: "Original customer refund", idempotencyKey: key }; }
function edge(work: PaymentAdapter["refund"]) {
  const actual = adapters.paymentAdapter("stripe");
  const refund = vi.fn(work);
  vi.spyOn(adapters, "paymentAdapter").mockReturnValue({ ...actual, refund });
  return refund;
}
async function row(key: string) { return (await db().select().from(refunds).where(eq(refunds.idempotencyKey, key)))[0]!; }

describe.runIf(hasDatabase)("legacy refund original physical dispatch", () => {
  beforeAll(ready, 60000); beforeEach(truncateSpine); afterEach(() => vi.restoreAllMocks()); afterAll(closeDb);
  it("refuses duplicate creation and direct human transitions while the original caller is live", async () => {
    const original = await payment("live-transition");
    let release!: () => void, enter!: () => void;
    const paused = new Promise<void>(resolve => { release = resolve; });
    const entered = new Promise<void>(resolve => { enter = resolve; });
    const refund = edge(async () => { enter(); await paused; return { providerRef: "re_LiveTransitions", status: "succeeded" }; });
    const request = input(original.id, "live-transitions");
    const first = submitProviderRefund.call(request, OWNER).then(value => ({ ok: true as const, value }), (error: unknown) => ({ ok: false as const, error }));
    try {
      await Promise.race([entered, first.then(() => { throw new Error("The original caller never reached its edge."); })]);
      const pending = await row(request.idempotencyKey);
      expect(pending.status).toBe("processing");
      await expect(submitProviderRefund.call(request, OWNER)).rejects.toMatchObject({ code: "conflict" });
      await expect(cancelRefund.call({ id: pending.id, reason: "Cannot cancel the original live request." }, OWNER)).rejects.toMatchObject({ code: "conflict" });
      await expect(failRefund.call({ id: pending.id, message: "A local failure is not a provider result." }, OWNER)).rejects.toMatchObject({ code: "conflict" });
      await expect(startRefund.call({ id: pending.id, providerRef: "re_Forged" }, OWNER)).rejects.toMatchObject({ code: "permission" });
      await expect(settleRefund.call({ id: pending.id, providerRef: "re_Forged" }, OWNER)).rejects.toMatchObject({ code: "permission" });
      await expect(recordProviderRefundCaller.call({ dispatchId: randomUUID(), completionNonce: randomUUID(), initiatedBy: "forged" }, OWNER)).rejects.toMatchObject({ code: "permission" });
      await expect(recordProviderRefundCaller.call({ dispatchId: randomUUID(), completionNonce: randomUUID(), initiatedBy: "forged" }, { kind: "system" })).rejects.toMatchObject({ code: "permission" });
    } finally { release(); await first; }
    expect((await first).ok).toBe(true);
    expect(refund).toHaveBeenCalledTimes(1);
    expect(await row(request.idempotencyKey)).toMatchObject({ status: "succeeded", providerRef: "re_LiveTransitions" });
  });
  it("dispatches a current prepared reservation using its server-created journal marker", async () => {
    const original = await payment("prepared-current");
    const request = input(original.id, "prepared-current-refund");
    expect(await reserveRefundBatch.call({ refunds: [request] }, { kind: "system" })).toMatchObject([{ status: "created" }]);
    const refund = edge(async () => ({ providerRef: "re_PreparedCurrent", status: "succeeded" }));
    expect(await submitProviderRefund.call(request, OWNER)).toMatchObject({ status: "succeeded", providerRef: "re_PreparedCurrent" });
    expect(refund).toHaveBeenCalledTimes(1);
  });
  it("keeps an unmarked historical created reservation as review debt, without trusting a supplied reason", async () => {
    const original = await payment("historical-unknown");
    const request = input(original.id, "historical-unknown-refund");
    const reserved = await createRefund.call(request, OWNER);
    // Faithful missing-marker state, not an old-artifact acceptance claim.
    await db().delete(moneyStateEvents).where(and(eq(moneyStateEvents.subjectType, "refund"), eq(moneyStateEvents.subjectId, reserved.id)));
    const refund = edge(async () => ({ providerRef: "re_NeverSent", status: "succeeded" }));
    await expect(submitProviderRefund.call(request, OWNER)).rejects.toMatchObject({ code: "conflict" });
    await expect(cancelRefund.call({ id: reserved.id, reason: JSON.stringify({ protocol: "freeholder.refund-physical.v1", physicalState: "unsubmitted" }) }, OWNER)).rejects.toMatchObject({ code: "conflict" });
    await expect(failRefund.call({ id: reserved.id, message: "Do not invent an old dispatch outcome." }, OWNER)).rejects.toMatchObject({ code: "conflict" });
    expect(refund).not.toHaveBeenCalled();
    expect(await row(request.idempotencyKey)).toMatchObject({ status: "created", providerRef: null });
  });
  it.each(["amount", "currency"] as const)("refuses a corrupted unsubmitted refund %s before any provider POST", async field => {
    const original = await payment(`unsubmitted-${field}`);
    const request = input(original.id, `unsubmitted-${field}-refund`);
    const reserved = await createRefund.call(request, OWNER);
    await db().update(refunds).set(field === "amount" ? { amountMinor: 500 } : { currency: "USD" }).where(eq(refunds.id, reserved.id));
    const refund = edge(async () => ({ providerRef: "re_NeverCorruptAdmission", status: "succeeded" }));
    await expect(submitProviderRefund.call(request, OWNER)).rejects.toMatchObject({ code: "conflict" });
    await expect(cancelRefund.call({ id: reserved.id, reason: "Do not release an altered original reservation." }, OWNER)).rejects.toMatchObject({ code: "conflict" });
    expect(refund).not.toHaveBeenCalled();
    expect(await row(request.idempotencyKey)).toMatchObject({ status: "created", providerRef: null });
  });
  it("does not reactivate a birth marker after restored-created state loses its admission but retains actual positive history", async () => {
    const original = await payment("restored-created-positive");
    const request = input(original.id, "restored-created-positive-refund");
    const refund = edge(async () => ({ providerRef: "re_RestoredPositive", status: "succeeded" }));
    expect(await submitProviderRefund.call(request, OWNER)).toMatchObject({ status: "succeeded" });
    const settled = await row(request.idempotencyKey);
    // Controlled partial-restore fault: real finished money history remains.
    await db().update(refunds).set({ status: "created" }).where(eq(refunds.id, settled.id));
    await db().delete(moneyStateEvents).where(and(eq(moneyStateEvents.subjectId, settled.id), eq(moneyStateEvents.toState, "processing")));
    await expect(submitProviderRefund.call(request, OWNER)).rejects.toMatchObject({ code: "conflict" });
    await expect(cancelRefund.call({ id: settled.id, reason: "A restored row is not an unused provider request." }, OWNER)).rejects.toMatchObject({ code: "conflict" });
    expect(refund).toHaveBeenCalledTimes(1);
    const facts = await db().select().from(moneyStateEvents).where(and(eq(moneyStateEvents.subjectId, settled.id), eq(moneyStateEvents.toState, "provider_result_observed")));
    expect(facts).toHaveLength(1);
    expect(facts[0]?.metadata).toMatchObject({ result: { status: "succeeded", providerRef: "re_RestoredPositive" } });
    expect((await db().select().from(payments).where(eq(payments.id, original.id)))[0]?.refundedMinor).toBe(1000);
  });
  it.each([
    ["transport", new Error("Synthetic response lost after provider acceptance")],
    ["already", new AdapterError("payments", "stripe", "invalid_request", "Synthetic already-refunded answer", false, "charge_already_refunded")],
    ["inuse", new AdapterError("payments", "stripe", "invalid_request", "Synthetic idempotency request still live", false, "idempotency_error")],
  ])("keeps %s throws reserved without a second POST or manual release", async (kind, error) => {
    const original = await payment(`unknown-${kind}`);
    const request = input(original.id, `unknown-${kind}-refund`);
    const refund = edge(async () => { throw error; });
    await expect(submitProviderRefund.call(request, OWNER)).rejects.toMatchObject({ code: "conflict" });
    const pending = await row(request.idempotencyKey);
    expect(pending).toMatchObject({ status: "processing", providerRef: null });
    await expect(submitProviderRefund.call(request, OWNER)).rejects.toMatchObject({ code: "conflict" });
    await expect(cancelRefund.call({ id: pending.id, reason: "Unknown does not mean never applied." }, OWNER)).rejects.toMatchObject({ code: "conflict" });
    await expect(failRefund.call({ id: pending.id, message: "A local error cannot release original capacity." }, OWNER)).rejects.toMatchObject({ code: "conflict" });
    expect(refund).toHaveBeenCalledTimes(1);
  });
  it("retains the actual positive before logical projection fails and replays application without POST", async () => {
    const original = await payment("projection-recovery");
    const request = input(original.id, "projection-recovery-refund");
    const refund = edge(async () => ({ providerRef: "re_ProjectionRecovery", status: "succeeded" }));
    const projection = vi.spyOn(settleRefund.def, "handler").mockRejectedValueOnce(new ServiceError("conflict", "Synthetic logical projection unavailable."));
    await expect(submitProviderRefund.call(request, OWNER)).rejects.toMatchObject({ code: "conflict" });
    const pending = await row(request.idempotencyKey);
    expect(pending).toMatchObject({ status: "processing", providerRef: "re_ProjectionRecovery", processedAt: null });
    const facts = await db().select().from(moneyStateEvents).where(and(eq(moneyStateEvents.subjectId, pending.id), eq(moneyStateEvents.toState, "provider_result_observed")));
    expect(facts).toHaveLength(1);
    expect(facts[0]?.metadata).toMatchObject({ physicalState: "finished", recoveryRequired: false, result: { status: "succeeded", providerRef: "re_ProjectionRecovery" } });
    expect((await db().select().from(payments).where(eq(payments.id, original.id)))[0]?.refundedMinor).toBe(0);
    projection.mockRestore();
    expect(await submitProviderRefund.call(request, OWNER)).toMatchObject({ status: "succeeded" });
    expect(refund).toHaveBeenCalledTimes(1);
  });
  it("preserves a real positive when dispatch journal corruption prevents application", async () => {
    const original = await payment("corrupt-journal");
    const request = input(original.id, "corrupt-journal-refund");
    const refund = edge(async () => {
      const pending = await row(request.idempotencyKey);
      await db().update(moneyStateEvents).set({ metadata: { corrupted: true } }).where(and(eq(moneyStateEvents.subjectId, pending.id), eq(moneyStateEvents.toState, "processing")));
      return { providerRef: "re_CorruptJournal", status: "succeeded" };
    });
    await expect(submitProviderRefund.call(request, OWNER)).rejects.toMatchObject({ code: "conflict" });
    const pending = await row(request.idempotencyKey);
    expect(pending).toMatchObject({ status: "processing", providerRef: "re_CorruptJournal" });
    const facts = await db().select().from(moneyStateEvents).where(and(eq(moneyStateEvents.subjectId, pending.id), eq(moneyStateEvents.toState, "provider_result_observed")));
    expect(facts).toHaveLength(1);
    expect(facts[0]?.metadata).toMatchObject({ recoveryRequired: true, original: { paymentId: original.id, amountMinor: 1000, currency: "CAD" }, result: { status: "succeeded", providerRef: "re_CorruptJournal" } });
    await expect(submitProviderRefund.call(request, OWNER)).rejects.toMatchObject({ code: "conflict" });
    expect(refund).toHaveBeenCalledTimes(1);
    expect((await db().select().from(payments).where(eq(payments.id, original.id)))[0]?.refundedMinor).toBe(0);
  });
  it.each(["amount", "requestHash"] as const)("retains a true positive without applying it to an altered parent %s", async field => {
    const original = await payment(`parent-${field}`);
    const request = input(original.id, `parent-${field}-refund`);
    const refund = edge(async () => {
      await db().update(payments).set(field === "amount" ? { amountMinor: 1500 } : { requestHash: "f".repeat(64) }).where(eq(payments.id, original.id));
      return { providerRef: "re_OriginalParentFact", status: "succeeded" };
    });
    await expect(submitProviderRefund.call(request, OWNER)).rejects.toMatchObject({ code: "conflict" });
    const pending = await row(request.idempotencyKey);
    expect(pending).toMatchObject({ status: "processing", providerRef: null });
    const facts = await db().select().from(moneyStateEvents).where(and(eq(moneyStateEvents.subjectId, pending.id), eq(moneyStateEvents.toState, "provider_result_observed")));
    expect(facts).toHaveLength(1);
    expect(facts[0]?.metadata).toMatchObject({ recoveryRequired: true, original: { paymentAmountMinor: 1000, paymentRequestHash: original.requestHash },
      result: { status: "succeeded", providerRef: "re_OriginalParentFact" } });
    expect(refund).toHaveBeenCalledTimes(1);
    expect((await db().select().from(payments).where(eq(payments.id, original.id)))[0]?.refundedMinor).toBe(0);
  });
  it("flushes a completed server-held answer after its independent persistence phase fails, without another POST", async () => {
    const original = await payment("caller-persist-recovery");
    const request = input(original.id, "caller-persist-recovery-refund");
    const refund = edge(async () => ({ providerRef: "re_CallerPersistRecovery", status: "succeeded" }));
    const persistence = vi.spyOn(recordProviderRefundCaller.def, "handler").mockRejectedValueOnce(new ServiceError("conflict", "Synthetic receipt persistence unavailable."));
    await expect(submitProviderRefund.call(request, OWNER)).rejects.toMatchObject({ code: "conflict" });
    expect(await row(request.idempotencyKey)).toMatchObject({ status: "processing", providerRef: null });
    await expect(submitProviderRefund.call({ ...request, amountMinor: 500 }, OWNER)).rejects.toMatchObject({ code: "conflict" });
    persistence.mockRestore();
    expect(await submitProviderRefund.call(request, OWNER)).toMatchObject({ status: "succeeded", providerRef: "re_CallerPersistRecovery" });
    expect(refund).toHaveBeenCalledTimes(1);
    const pending = await row(request.idempotencyKey);
    expect(await db().select().from(moneyStateEvents).where(and(eq(moneyStateEvents.subjectId, pending.id), eq(moneyStateEvents.toState, "provider_result_observed")))).toHaveLength(1);
  });
  it("uses the mandatory current session key for new signatures when only a previous wrapping key is configured", async () => {
    const configured = environment.env();
    const keys = vi.spyOn(environment, "env").mockReturnValue({ ...configured, CREDENTIAL_KEY: undefined, CREDENTIAL_KEY_PREVIOUS: "22".repeat(32) });
    const original = await payment("previous-verification-only");
    const request = input(original.id, "previous-verification-only-refund");
    await reserveRefundBatch.call({ refunds: [request] }, { kind: "system" });
    keys.mockReturnValue({ ...configured, CREDENTIAL_KEY: undefined, CREDENTIAL_KEY_PREVIOUS: undefined });
    const refund = edge(async () => ({ providerRef: "re_CurrentSessionKey", status: "succeeded" }));
    expect(await submitProviderRefund.call(request, OWNER)).toMatchObject({ status: "succeeded", providerRef: "re_CurrentSessionKey" });
    expect(refund).toHaveBeenCalledTimes(1);
  });
  it("verifies pending original receipts across configured wrapping-key rotation without rebinding them", async () => {
    const original = await payment("journal-rotation");
    const request = input(original.id, "journal-rotation-refund");
    const refund = edge(async () => ({ providerRef: "re_JournalRotation", status: "pending" }));
    expect(await submitProviderRefund.call(request, OWNER)).toMatchObject({ status: "processing", providerRef: "re_JournalRotation" });
    const configured = environment.env();
    const keys = vi.spyOn(environment, "env").mockReturnValue({ ...configured, CREDENTIAL_KEY: "11".repeat(32), CREDENTIAL_KEY_PREVIOUS: configured.CREDENTIAL_KEY });
    expect(await submitProviderRefund.call(request, OWNER)).toMatchObject({ status: "processing", providerRef: "re_JournalRotation" });
    keys.mockReturnValue({ ...configured, CREDENTIAL_KEY: "11".repeat(32), CREDENTIAL_KEY_PREVIOUS: undefined });
    await expect(submitProviderRefund.call(request, OWNER)).rejects.toMatchObject({ code: "conflict" });
    expect(refund).toHaveBeenCalledTimes(1);
  });
  it("releases a finished pending caller only after exact authenticated terminal provider evidence", async () => {
    const original = await payment("pending-terminal");
    const request = input(original.id, "pending-terminal-refund");
    const refund = edge(async () => ({ providerRef: "re_PendingTerminal", status: "pending" }));
    expect(await submitProviderRefund.call(request, OWNER)).toMatchObject({ status: "processing", providerRef: "re_PendingTerminal" });
    const receivedAt = new Date().toISOString(), at = Math.floor(Date.parse(receivedAt) / 1000);
    const raw = JSON.stringify({ id: "evt_OriginalPendingFailed", type: "refund.updated", created: at,
      data: { object: { id: "re_PendingTerminal", payment_intent: original.providerRef, amount: 1000, currency: "cad", status: "failed" } } });
    const secret = "whsec_synthetic_original_pending";
    const signature = createHmac("sha256", secret).update(`${at}.${raw}`).digest("hex");
    const adapter = createStripePayments({ secretKey: "sk_synthetic", webhookSecrets: [secret] });
    const observed = await adapter.verifyWebhook({ headers: { "stripe-signature": `t=${at},v1=${signature}` }, body: Uint8Array.from(Buffer.from(raw)), receivedAt });
    await processPaymentProviderEvents.call({ provider: "stripe", bodySha256: createHash("sha256").update(raw).digest("hex"), receivedAt, events: [...observed] }, { kind: "system" });
    expect(await row(request.idempotencyKey)).toMatchObject({ status: "failed", failureCode: "provider_failed" });
    expect((await db().select().from(payments).where(eq(payments.id, original.id)))[0]?.refundedMinor).toBe(0);
    refund.mockResolvedValueOnce({ providerRef: "re_AfterProvenFailure", status: "succeeded" });
    expect(await submitProviderRefund.call(input(original.id, "after-proven-terminal"), OWNER)).toMatchObject({ status: "succeeded" });
    expect(refund).toHaveBeenCalledTimes(2);
  });
});
