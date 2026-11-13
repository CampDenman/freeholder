// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.38/C1.08: actual current order/privacy spine, synthetic paused provider edge.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/core/db";
import { env } from "@/core/env";
import { createDataRequest, fulfillDataRequest, verifyDataRequest } from "@/core/privacy/service";
import { ready } from "@/core/runtime";
import { merchantTaxProfiles } from "@/modules/invoicing/merchant-tax-schema";
import { beginPaymentCheckout } from "@/modules/invoicing/payment-provider-service";
import { closeDb, hasDatabase, OWNER, truncateSpine } from "../helpers/spine";
import { seedMerchantCheckout80 } from "../helpers/merchant-checkout80";
function signal() { let resolve!: () => void; const promise = new Promise<void>(accept => { resolve = accept; }); return { promise, resolve }; }
describe.runIf(hasDatabase)("merchant order creator privacy fence", { timeout: 60000 }, () => {
  let fixture: Awaited<ReturnType<typeof seedMerchantCheckout80>> | undefined;
  beforeAll(ready, 60000); beforeEach(truncateSpine);
  afterEach(() => { fixture?.cleanup(); fixture = undefined; vi.restoreAllMocks(); }); afterAll(closeDb);
  it("retains the original seller tax policy while an admitted order payment creator is still paused", async () => {
    fixture = await seedMerchantCheckout80("destination");
    const placed = await fixture.checkout(), profileId = fixture.profiles[0]!.profileId;
    const [original] = await db().select().from(merchantTaxProfiles).where(eq(merchantTaxProfiles.id, profileId));
    expect(original?.contactId).toBeTruthy();
    const entered = signal(), release = signal();
    fixture.stripe.createCheckout = async request => {
      entered.resolve(); await release.promise;
      return { providerRef: "cs_pausedPrivacy", url: "https://checkout.example.test/original", providerPlatformAccountId: request.providerPlatformAccountId,
        providerAccountId: request.providerAccountId, destinationAccountId: request.destinationAccountId, settlementMerchantAccountId: request.settlementMerchantAccountId };
    };
    const first = beginPaymentCheckout.call({ invoiceId: placed.order.invoiceId!, provider: "stripe", successUrl: env().APP_URL, cancelUrl: env().APP_URL, idempotencyKey: crypto.randomUUID() }, OWNER)
      .then(value => ({ value }), (error: unknown) => ({ error }));
    try {
      expect(await Promise.race([entered.promise.then(() => "entered"), first.then(() => "ended")])).toBe("entered");
      const request = await createDataRequest.call({ contactId: original!.contactId!, request: { kind: "erasure" } }, OWNER);
      await verifyDataRequest.call({ id: request.id, method: "Verified original merchant request during its actual admitted order call" }, OWNER);
      await fulfillDataRequest.call({ id: request.id, confirmation: "ERASE" }, OWNER);
      expect((await db().select().from(merchantTaxProfiles).where(eq(merchantTaxProfiles.id, profileId)))[0]).toMatchObject({ state: "active", contactId: original!.contactId });
    } finally { release.resolve(); await first; }
  });
});
