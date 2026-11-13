// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.38/C1.08: original seller refund children guard contact-merge undo.
import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import type { InvoiceForCharge } from "@/adapters/payments";
import { db } from "@/core/db";
import { env } from "@/core/env";
import { ready } from "@/core/runtime";
import { createContact, mergeContacts, undoContactMerge } from "@/core/contacts/service";
import { beginPaymentCheckout, completePaymentCheckout } from "@/modules/invoicing/payment-provider-service";
import { createRefund } from "@/modules/invoicing/invoice-service";
import { invoiceMerchantAllocations } from "@/modules/invoicing/schema";
import { merchantPaymentRoutes } from "@/modules/invoicing/merchant-collection-schema";
import { merchantTaxProfiles } from "@/modules/invoicing/merchant-tax-schema";
import { merchantRefundRequests } from "@/modules/invoicing/merchant-refund-schema";
import { closeDb, failure, hasDatabase, OWNER, truncateSpine } from "../helpers/spine";
import { seedMerchantCheckout80 } from "../helpers/merchant-checkout80";

describe.runIf(hasDatabase)("seller tax refund merge witness80", { timeout: 60_000 }, () => {
  let fixture: Awaited<ReturnType<typeof seedMerchantCheckout80>> | undefined;
  beforeAll(ready, 60_000); beforeEach(truncateSpine);
  afterEach(() => { fixture?.cleanup(); fixture = undefined; vi.restoreAllMocks(); }); afterAll(closeDb);
  it("ignores another seller's refund on the same invoice but blocks undo after this seller's new refund child", async () => {
    fixture = await seedMerchantCheckout80("destination", 2);
    const placed = await fixture.checkout(), requests = new Map<string, InvoiceForCharge>();
    fixture.stripe.createCheckout = async request => {
      const ref = `cs_mergeOriginal${requests.size}`;
      requests.set(ref, request);
      return { ...request, providerRef: ref, paymentRef: `pi_${ref}`, url: `https://checkout.example.test/${ref}` };
    };
    fixture.stripe.captureCheckout = async request => {
      const original = requests.get(request.checkoutRef)!;
      return { ...original, providerRef: `pi_${request.checkoutRef}`, status: "succeeded", amountMinor: original.amountMinor, currency: original.currency,
        customerChargeVerified: true, merchantRouteVerified: true, merchantSettlementVerified: true,
        providerChargeRef: `ch_${request.checkoutRef}`, applicationFeeRef: `fee_${request.checkoutRef}`, transferRef: `tr_${request.checkoutRef}`,
        observedApplicationFeeMinor: original.applicationFeeMinor, applicationFeeCurrency: original.currency, observedFeeRefundedMinor: 0 };
    };
    for (let index = 0; index < 2; index++) {
      const begun = await beginPaymentCheckout.call({ invoiceId: placed.order.invoiceId!, provider: "stripe", successUrl: env().APP_URL, cancelUrl: env().APP_URL, idempotencyKey: randomUUID() }, OWNER);
      expect((await completePaymentCheckout.call({ paymentId: begun.payment.id, idempotencyKey: randomUUID() }, OWNER)).status).toBe("succeeded");
    }
    const routes = await db().select({ paymentId: merchantPaymentRoutes.paymentId, sellerUserId: invoiceMerchantAllocations.sellerUserId }).from(merchantPaymentRoutes)
      .innerJoin(invoiceMerchantAllocations, eq(invoiceMerchantAllocations.id, merchantPaymentRoutes.allocationId))
      .where(eq(invoiceMerchantAllocations.invoiceId, placed.order.invoiceId!));
    const own = routes.find(row => row.sellerUserId === fixture!.sellers[0]!.userId)!;
    const other = routes.find(row => row.sellerUserId === fixture!.sellers[1]!.userId)!;
    const [profile] = await db().select().from(merchantTaxProfiles).where(eq(merchantTaxProfiles.id, fixture.profiles[0]!.profileId));
    const originalContactId = profile!.contactId!;
    const survivor = await createContact.call({ name: "Seller alias", email: "seller-alias@example.test" }, OWNER);
    const merged = await mergeContacts.call({ survivingId: survivor.id, duplicateId: originalContactId }, OWNER);
    const unrelated = await createRefund.call({ paymentId: other.paymentId, amountMinor: 100, idempotencyKey: randomUUID(), reason: "Other seller's original allocation" }, OWNER);
    expect(await db().select().from(merchantRefundRequests).where(eq(merchantRefundRequests.refundId, unrelated.id))).toHaveLength(1);
    await undoContactMerge.call({ operationId: merged.mergeOperationId }, OWNER);
    expect((await db().select().from(merchantTaxProfiles).where(eq(merchantTaxProfiles.id, profile!.id)))[0]!.contactId).toBe(originalContactId);
    const again = await mergeContacts.call({ survivingId: survivor.id, duplicateId: originalContactId }, OWNER);
    const refund = await createRefund.call({ paymentId: own.paymentId, amountMinor: 100, idempotencyKey: randomUUID(), reason: "This seller's original allocation" }, OWNER);
    const [child] = await db().select().from(merchantRefundRequests).where(eq(merchantRefundRequests.refundId, refund.id));
    expect(child).toMatchObject({ paymentId: own.paymentId });
    expect((await failure(undoContactMerge.call({ operationId: again.mergeOperationId }, OWNER))).code).toBe("conflict");
    expect((await db().select().from(merchantTaxProfiles).where(eq(merchantTaxProfiles.id, profile!.id)))[0]!.contactId).toBe(survivor.id);
    expect((await db().select().from(merchantRefundRequests).where(eq(merchantRefundRequests.id, child!.id)))[0]).toEqual(child);
  });
});
