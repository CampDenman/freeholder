// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C5.19/C12.38/C1.08: actual RMA credit, retained signed feedback and returned callers.
import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq, sql } from "drizzle-orm";
import { db } from "@/core/db";
import { ready } from "@/core/runtime";
import { stopJobs, reconcileJobDeploymentAdmission } from "@/core/jobs";
import { createContact, mergeContacts, undoContactMerge } from "@/core/contacts/service";
import { contacts, contactMergeOperations } from "@/core/contacts/schema";
import { getReturn, getReturnRefundPlan } from "@/modules/catalog/service";
import { returnRequests } from "@/modules/catalog/schema";
import { myOrderReturns } from "@/modules/catalog/customer-returns";
import { getCustomerInvoice } from "@/modules/invoicing/customer-service";
import { invoiceRefundStates } from "@/modules/invoicing/merchant-refund-bank-state-service";
import { reconcileLegacyBankRefund } from "@/modules/invoicing/legacy-bank-current-service";
import { legacyBankFeedback } from "@/modules/invoicing/legacy-bank-feedback-schema";
import { legacyBankFeedbackReviewOwned, legacyFeedbackVerificationKeys } from "@/modules/invoicing/legacy-bank-feedback-store";
import { verifyLegacyBankFeedback } from "@/modules/invoicing/legacy-bank-feedback-proof";
import { legacyBankReads, legacyBankReadFacts, legacyBankReadFinishes, legacyBankCurrentReceipts } from "@/modules/invoicing/legacy-bank-read-schema";
import { merchantRefundRequests } from "@/modules/invoicing/merchant-refund-schema";
import { invoices, moneyStateEvents, payments, refunds } from "@/modules/invoicing/schema";
import { LEGACY_REPLACEMENT_PROTOCOL } from "@/modules/invoicing/legacy-bank-replacement-proof";
import { legacyRmaFixture } from "../helpers/legacy-bank-rma";
import { closeDb, failure, hasDatabase, OWNER, truncateSpine } from "../helpers/spine";
async function drain() { await stopJobs(); await reconcileJobDeploymentAdmission(); await closeDb(); }
describe.runIf(hasDatabase)("authentic original legacy RMA bank recovery80", { timeout: 60000 }, () => {
  beforeAll(ready, 60000); beforeEach(truncateSpine); afterEach(async () => { vi.restoreAllMocks(); await drain(); }); afterAll(drain);
  it("retains the original issued credit through unknown, action, failure and restoration, and replaces only its exact failed part once", async () => {
    const actual = await legacyRmaFixture(), credit = await actual.originalCredit(), unrelated = await actual.unrelated();
    expect(credit.credit.status).toBe("issued"); expect(credit.lines).toHaveLength(1); await actual.balances(2000);
    await actual.signedStatus(actual.original.providerRef!, null);
    expect((await getReturn.call({ id: actual.returnId }, OWNER)).return.status).toBe("received");
    expect(await getReturnRefundPlan.call({ id: actual.returnId }, OWNER)).toMatchObject({ bankReview: true, onlineConfirmedMinor: 0 });
    await actual.check(); await actual.balances(2000); expect(await actual.originalCredit()).toEqual(credit);
    for (const status of ["requires_action", "pending", "failed"] as const) {
      await actual.signedStatus(actual.original.providerRef!, status); await actual.check(); await actual.balances(1000);
      expect((await getReturn.call({ id: actual.returnId }, OWNER)).return.status).toBe("received");
      expect(await actual.originalCredit()).toEqual(credit); expect(actual.posts).toHaveLength(2);
    }
    const open = (await invoiceRefundStates.call({ invoiceId: actual.invoiceId }, OWNER)).find(row => row.id === actual.original.id);
    expect(open).toMatchObject({ refundPromiseOpen: true, promiseFulfilledElsewhere: false, canReplace: true });
    await actual.signedStatus(actual.original.providerRef!, "succeeded"); await actual.check(); await actual.balances(2000);
    expect((await getReturn.call({ id: actual.returnId }, OWNER)).return.status).toBe("refunded");
    await actual.signedStatus(actual.original.providerRef!, "failed"); await actual.check(); await actual.balances(1000);
    const replacement = await actual.replace(); expect(replacement.return.status).toBe("refunded"); await actual.balances(2000);
    expect(await actual.originalCredit()).toEqual(credit); expect(actual.posts).toHaveLength(3);
    expect(actual.posts[2]).toBe(`return:${actual.returnId}:allocation:${actual.part.id}:legacy-bank-replacement:v1:${actual.original.id}`);
    const [lineage] = await db().select().from(moneyStateEvents).where(sql`${moneyStateEvents.metadata}->>'protocol'=${LEGACY_REPLACEMENT_PROTOCOL}`);
    expect(lineage?.metadata).toMatchObject({ rootRefundId: actual.original.id, parentRefundId: actual.original.id,
      returnPart: { returnId: actual.returnId, allocationId: actual.part.id, creditNoteId: credit.credit.id }, originalCreatePlatformAccountId: null, originalCreateProtocolVersion: null });
    const childId = lineage?.metadata.replacementRefundId;
    expect(childId).not.toBe(unrelated.id);
    await actual.replace(); await actual.balances(2000); expect(actual.posts).toHaveLength(3); expect(await actual.originalCredit()).toEqual(credit);
    expect((await getCustomerInvoice.call({ id: actual.invoiceId }, actual.customer)).canPay).toBe(false);
    const [request] = await db().select().from(returnRequests).where(eq(returnRequests.id, actual.returnId));
    const customer = await myOrderReturns.call({ orderId: request!.orderId }, actual.customer);
    expect(customer.returns.find(row => row.id === actual.returnId)?.refund).toMatchObject({ confirmedMinor: 1000, needsReview: false });
    expect(await db().select().from(merchantRefundRequests)).toHaveLength(0);
    for (const read of await db().select().from(legacyBankReads)) expect(read.original).toMatchObject({ originalCreatePlatformAccountId: null, originalCreateProtocolVersion: null });
  });
  it("keeps primary positive bank facts and cash after the actual later return callback fails, then closes the same credit without another POST", async () => {
    const actual = await legacyRmaFixture(), credit = await actual.originalCredit();
    await actual.signedStatus(actual.original.providerRef!, "failed"); await actual.check(); await actual.balances(0);
    await actual.signedStatus(actual.original.providerRef!, "succeeded");
    const beforeFacts = (await db().select().from(legacyBankReadFacts)).length;
    // A test-owned database trigger rejects only the real later workflow
    // closure. All provider reads and primary financial services still run.
    await db().execute(sql`create function freeholder_test_rma_late_failure() returns trigger language plpgsql as $$ begin if new.status='refunded' then raise exception 'Synthetic actual later return closure failure'; end if; return new; end $$`);
    await db().execute(sql`create trigger freeholder_test_rma_late_failure before update on return_requests for each row execute function freeholder_test_rma_late_failure()`);
    try {
      await expect(actual.check()).rejects.toThrow(); await actual.balances(1000);
      expect((await db().select().from(legacyBankReadFacts)).length).toBeGreaterThan(beforeFacts);
      expect((await db().select().from(legacyBankReadFinishes)).every(finish => finish.outcome === "returned")).toBe(true);
      expect((await db().select().from(legacyBankCurrentReceipts)).some(receipt => receipt.status === "succeeded")).toBe(true);
      expect((await db().select().from(refunds).where(eq(refunds.id, actual.original.id)))[0]?.status).toBe("succeeded");
      expect((await db().select().from(returnRequests).where(eq(returnRequests.id, actual.returnId)))[0]?.status).toBe("received");
      expect(await actual.originalCredit()).toEqual(credit); expect(actual.posts).toHaveLength(1);
    } finally {
      await db().execute(sql`drop trigger freeholder_test_rma_late_failure on return_requests`);
      await db().execute(sql`drop function freeholder_test_rma_late_failure()`);
    }
    expect((await actual.check()).return.status).toBe("refunded"); await actual.balances(1000);
    expect(await actual.originalCredit()).toEqual(credit); expect(actual.posts).toHaveLength(1);
  });
  it("binds bank-feedback-only financial history before the first GET to its exact original owner and preserves canonical ownership on refused undo", async () => {
    const own = await legacyRmaFixture(), foreign = await legacyRmaFixture();
    expect(own.paymentRef).not.toBe(foreign.paymentRef);
    const alias = await createContact.call({ name: "Original bank-feedback buyer alias", email: `fictional-feedback-alias-${randomUUID()}@example.test` }, OWNER);
    const first = await mergeContacts.call({ survivingId: alias.id, duplicateId: own.buyer.id }, OWNER);
    const [firstInvoice] = await db().select().from(invoices).where(eq(invoices.id, own.invoiceId));
    await foreign.signedStatus(foreign.original.providerRef!, "requires_action", false);
    expect((await db().select().from(invoices).where(eq(invoices.id, own.invoiceId)))[0]).toEqual(firstInvoice);
    expect(await db().select().from(legacyBankReads)).toHaveLength(0);
    await undoContactMerge.call({ operationId: first.mergeOperationId }, OWNER);
    expect((await db().select().from(invoices).where(eq(invoices.id, own.invoiceId)))[0]?.contactId).toBe(own.buyer.id);
    const second = await mergeContacts.call({ survivingId: alias.id, duplicateId: own.buyer.id }, OWNER);
    const [canonicalInvoice] = await db().select().from(invoices).where(eq(invoices.id, own.invoiceId));
    const [canonicalContact] = await db().select().from(contacts).where(eq(contacts.id, alias.id));
    const [originalRefund] = await db().select().from(refunds).where(eq(refunds.id, own.original.id));
    const [originalPayment] = await db().select().from(payments).where(eq(payments.id, own.payment.id));
    const paths = own.paths.length;
    const receipt = await own.signedStatus(own.original.providerRef!, "requires_action", false);
    const retained = (await db().select().from(legacyBankFeedback)).filter(row => row.evidence.observedPaymentRef === own.paymentRef);
    expect(retained).toHaveLength(1);
    expect(verifyLegacyBankFeedback(retained[0]!, legacyFeedbackVerificationKeys())).toMatchObject({ observedRefundRef: own.original.providerRef, observedPaymentRef: own.paymentRef,
      rawBodySha256: receipt.bodySha256, verification: "stripe_exact_byte_hmac_verified_upstream", originalCreatePlatformAccountId: null, originalCreateProtocolVersion: null });
    expect(await db().transaction(tx => legacyBankFeedbackReviewOwned(tx, own.original.id))).toBe(true);
    expect(own.paths.slice(paths).every(path => path === "GET /v1/account")).toBe(true);
    expect(await db().select().from(legacyBankReads)).toHaveLength(0); expect(await db().select().from(legacyBankReadFacts)).toHaveLength(0);
    expect(await db().select().from(legacyBankReadFinishes)).toHaveLength(0); expect(await db().select().from(legacyBankCurrentReceipts)).toHaveLength(0);
    expect((await db().select().from(refunds).where(eq(refunds.id, own.original.id)))[0]).toEqual(originalRefund);
    expect((await db().select().from(payments).where(eq(payments.id, own.payment.id)))[0]).toEqual(originalPayment);
    expect(await failure(undoContactMerge.call({ operationId: second.mergeOperationId }, OWNER))).toMatchObject({ code: "conflict" });
    expect((await db().select().from(invoices).where(eq(invoices.id, own.invoiceId)))[0]).toEqual(canonicalInvoice);
    expect((await db().select().from(contacts).where(eq(contacts.id, alias.id)))[0]).toEqual(canonicalContact);
    expect(await db().select().from(contacts).where(eq(contacts.id, own.buyer.id))).toHaveLength(0);
    expect((await db().select().from(contactMergeOperations).where(eq(contactMergeOperations.id, second.mergeOperationId)))[0]?.undoneAt).toBeNull();
    expect(own.posts).toHaveLength(1); expect(foreign.posts).toHaveLength(1); expect(await db().select().from(merchantRefundRequests)).toHaveLength(0);
  });
  it("retains authentic feedback while the original accepted creator is paused, without inventing its refund reference or finish", async () => {
    const actual = await legacyRmaFixture({ pauseOriginal: true }), providerRef = [...actual.resources.keys()][0]!;
    try {
      expect(actual.original.providerRef).toBeNull();
      await actual.signedStatus(providerRef, "succeeded", false);
      const [retained] = await db().select().from(legacyBankFeedback);
      expect(verifyLegacyBankFeedback(retained!, legacyFeedbackVerificationKeys())).toMatchObject({ observedRefundRef: providerRef, observedPaymentRef: actual.paymentRef });
      expect((await db().select().from(refunds).where(eq(refunds.id, actual.original.id)))[0]).toMatchObject({ providerRef: null, status: "processing" });
      expect(await db().transaction(tx => legacyBankFeedbackReviewOwned(tx, actual.original.id))).toBe(true);
      expect(await failure(reconcileLegacyBankRefund.call({ refundId: actual.original.id }, OWNER))).toMatchObject({ code: "conflict" });
      expect(await db().select().from(legacyBankReads)).toHaveLength(0); expect(await db().select().from(legacyBankCurrentReceipts)).toHaveLength(0); await actual.balances(0);
      actual.release.resolve(); expect(await actual.pending).toHaveProperty("error");
      // The real finish and first ACK are retained independently. Its old
      // successful result cannot settle later bank-review debt by itself.
      const [finished] = await db().select().from(refunds).where(eq(refunds.id, actual.original.id));
      expect(finished).toMatchObject({ providerRef, status: "processing" });
      expect((await db().select().from(moneyStateEvents)).some(row => row.subjectId === actual.original.id && row.metadata.physicalState === "finished")).toBe(true);
      await actual.check(); await actual.balances(1000); expect(actual.posts).toHaveLength(1);
      expect((await db().select().from(refunds).where(eq(refunds.id, actual.original.id)))[0]).toMatchObject({ providerRef, status: "succeeded" });
    } finally { actual.release.resolve(); await actual.pending; }
  });
  it("commits the actual signed bank facts before contradictory amount policy refuses application, preserving existing cash and credit", async () => {
    const actual = await legacyRmaFixture(), credit = await actual.originalCredit();
    const resource = actual.resources.get(actual.original.providerRef!); if (!resource) throw Error("No actual bank resource.");
    resource.amount = 1001;
    await expect(actual.signedStatus(actual.original.providerRef!, "succeeded")).rejects.toThrow();
    const [retained] = await db().select().from(legacyBankFeedback);
    expect(verifyLegacyBankFeedback(retained!, legacyFeedbackVerificationKeys())).toMatchObject({ observedRefundRef: actual.original.providerRef, observedPaymentRef: actual.paymentRef, amountMinor: 1001, status: "succeeded" });
    await actual.balances(1000); expect(await actual.originalCredit()).toEqual(credit);
    expect((await db().select().from(refunds).where(eq(refunds.id, actual.original.id)))[0]).toMatchObject({ amountMinor: 1000, status: "succeeded" });
    expect(await db().select().from(legacyBankReads)).toHaveLength(0); expect(await db().select().from(legacyBankCurrentReceipts)).toHaveLength(0);
    expect((await getReturn.call({ id: actual.returnId }, OWNER)).return.status).toBe("received"); expect(actual.posts).toHaveLength(1);
    expect(await db().select().from(merchantRefundRequests)).toHaveLength(0);
  });

});
