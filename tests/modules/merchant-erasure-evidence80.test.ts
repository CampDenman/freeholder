// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.38/C1.08: no-subscription financial facts survive receipt recovery failure.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/core/db";
import { env } from "@/core/env";
import { createDataRequest, fulfillDataRequest, verifyDataRequest } from "@/core/privacy/service";
import { dataRequestArtifacts, dataRequests } from "@/core/privacy/schema";
import { ready } from "@/core/runtime";
import { merchantTaxProfiles } from "@/modules/invoicing/merchant-tax-schema";
import { merchantPaymentDispatches } from "@/modules/invoicing/merchant-payment-recovery-schema";
import { merchantTaxDigest } from "@/modules/invoicing/merchant-tax-store";
import { beginPaymentCheckout } from "@/modules/invoicing/payment-provider-service";
import { reconcileMerchantTaxErasureEvidence } from "@/modules/subscriptions/provider-schedule-erasure";
import { subscriptionProviderScheduleErasures } from "@/modules/subscriptions/provider-schedule-schema";
import { closeDb, hasDatabase, OWNER, truncateSpine } from "../helpers/spine";
import { seedMerchantCheckout80 } from "../helpers/merchant-checkout80";

function signal() { let resolve!: () => void; const promise = new Promise<void>(accept => { resolve = accept; }); return { promise, resolve }; }
describe.runIf(hasDatabase)("original merchant financial evidence receipt repair", { timeout: 60000 }, () => {
  let fixture: Awaited<ReturnType<typeof seedMerchantCheckout80>> | undefined;
  beforeAll(ready, 60000); beforeEach(truncateSpine);
  afterEach(() => { fixture?.cleanup(); fixture = undefined; vi.restoreAllMocks(); }); afterAll(closeDb);
  it("reuses the actual no-subscription task and commits corrupt-artifact recovery without deleting its independent original dispatch fact", async () => {
    fixture = await seedMerchantCheckout80("destination");
    const placed = await fixture.checkout(), profileId = fixture.profiles[0]!.profileId;
    const [profile] = await db().select().from(merchantTaxProfiles).where(eq(merchantTaxProfiles.id, profileId));
    const entered = signal(), release = signal();
    fixture.stripe.createCheckout = async request => {
      entered.resolve(); await release.promise;
      return { providerRef: "cs_originalProfileRepair", url: "https://checkout.example.test/original", providerPlatformAccountId: request.providerPlatformAccountId,
        providerAccountId: request.providerAccountId, destinationAccountId: request.destinationAccountId, settlementMerchantAccountId: request.settlementMerchantAccountId };
    };
    const physical = beginPaymentCheckout.call({ invoiceId: placed.order.invoiceId!, provider: "stripe", successUrl: env().APP_URL,
      cancelUrl: env().APP_URL, idempotencyKey: crypto.randomUUID() }, OWNER).then(value => ({ value }), (error: unknown) => ({ error }));
    try {
      expect(await Promise.race([entered.promise.then(() => "entered"), physical.then(() => "ended")])).toBe("entered");
      const [originalDispatch] = await db().select().from(merchantPaymentDispatches);
      expect(originalDispatch).toBeDefined();
      const request = await createDataRequest.call({ contactId: profile!.contactId!, request: { kind: "erasure" } }, OWNER);
      await verifyDataRequest.call({ id: request.id, method: "Verified synthetic business request during its independently admitted original payment" }, OWNER);
      await fulfillDataRequest.call({ id: request.id, confirmation: "ERASE" }, OWNER);
      const [cohort] = await db().select().from(subscriptionProviderScheduleErasures).where(eq(subscriptionProviderScheduleErasures.requestId, request.id));
      expect(cohort).toMatchObject({ subscriptionId: null, profileId, state: "pending" });
      const input = { profileId, sourceKey: `payment:${originalDispatch!.paymentId}`, evidenceDigest: merchantTaxDigest(originalDispatch) };
      await expect(reconcileMerchantTaxErasureEvidence.call(input, OWNER)).rejects.toMatchObject({ code: "permission" });
      expect(await reconcileMerchantTaxErasureEvidence.call(input, { kind: "system" })).toEqual({ reopened: 0, recoveryRequired: false });
      const [artifact] = await db().select().from(dataRequestArtifacts).where(eq(dataRequestArtifacts.dataRequestId, request.id));
      const corrupted = { ...artifact!.body as Record<string, unknown>, note: "Synthetic parseable original artifact corruption; keep its checksum unchanged" };
      await db().update(dataRequestArtifacts).set({ body: corrupted }).where(eq(dataRequestArtifacts.id, artifact!.id));
      expect(await reconcileMerchantTaxErasureEvidence.call(input, { kind: "system" })).toEqual({ reopened: 0, recoveryRequired: true });
      expect((await db().select().from(dataRequestArtifacts).where(eq(dataRequestArtifacts.id, artifact!.id)))[0]).toMatchObject({ body: corrupted, sha256: artifact!.sha256 });
      expect((await db().select().from(dataRequests).where(eq(dataRequests.id, request.id)))[0]).toMatchObject({ status: "in_progress", fulfilledAt: null,
        resolution: "New source evidence requires recovery of the exact original erasure receipt before completion." });
      expect(await db().select().from(merchantPaymentDispatches)).toEqual([originalDispatch]);
      expect((await db().select().from(subscriptionProviderScheduleErasures).where(eq(subscriptionProviderScheduleErasures.id, cohort!.id)))[0]).toMatchObject({ jobId: cohort!.jobId, jobIds: cohort!.jobIds });
      expect((await db().select().from(merchantTaxProfiles).where(eq(merchantTaxProfiles.id, profileId)))[0]).toMatchObject({ state: "active", contactId: profile!.contactId });
    } finally { release.resolve(); await physical; }
  });
});
