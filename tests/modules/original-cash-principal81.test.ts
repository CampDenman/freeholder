// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.38 PREPARED/UNRUN: actual original charge and exact-byte signed raw
// callback retained before domain processing. Fictional provider HTTP only.
import { createHash, createHmac, randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createStripePayments } from "@/adapters/payments/stripe";
import { db } from "@/core/db";
import { stopJobs, reconcileJobDeploymentAdmission } from "@/core/jobs";
import { ready } from "@/core/runtime";
import { legacyBankFeedback } from "@/modules/invoicing/legacy-bank-feedback-schema";
import { retainLegacyBankFeedback } from "@/modules/invoicing/legacy-bank-feedback-service";
import { originalCashRecoveries, originalCashRecoveryOperations } from "@/modules/invoicing/original-cash-recovery-schema";
import { merchantPaymentObservations } from "@/modules/invoicing/merchant-collection-schema";
import { merchantRefundObservations } from "@/modules/invoicing/merchant-refund-schema";
import { originalPrincipalAuthority } from "@/modules/invoicing/principal-authority";
import { payments, refunds } from "@/modules/invoicing/schema";
import { partialCashFixture } from "../helpers/original-cash-partial";
import { closeDb, hasDatabase, truncateSpine } from "../helpers/spine";
describe.runIf(hasDatabase)("actual raw-only cash feedback owns principal review before domain application", { timeout: 60000 }, () => {
  let source: Awaited<ReturnType<typeof partialCashFixture>> | undefined;
  beforeAll(ready, 60000); beforeEach(truncateSpine);
  afterEach(async () => { vi.useRealTimers(); source?.release.resolve(); source?.base.cleanup(); source = undefined; vi.restoreAllMocks(); await stopJobs(); await reconcileJobDeploymentAdmission(); await closeDb(); });
  afterAll(closeDb);
  it("refuses previously usable paid principal after an authentic raw refund callback while canonical refund projection and all domain observations remain unchanged", async () => {
    source = await partialCashFixture();
    const before = await originalPrincipalAuthority.call({ paymentId: source.paymentId }, { kind: "system" });
    expect(before).toMatchObject({ principalSafe: true, currentPrincipalMinor: source.amount });
    const captured = (await db().select().from(merchantPaymentObservations).where(eq(merchantPaymentObservations.paymentId, source.paymentId))).find(row => row.status === "succeeded" && row.providerChargeRef !== null);
    if (!captured?.providerChargeRef) throw new Error("Retain the actual original customer charge before its signed bank callback.");
    const resource = source.dashboardRefund(source.amount / 3);
    const priorPayments = await db().select().from(payments), priorRefunds = await db().select().from(refunds), priorDomain = await db().select().from(merchantRefundObservations);
    const secret = "whsec_principal_raw_fixture_only", timestamp = Math.floor(Date.now() / 1000), receivedAt = new Date(timestamp * 1000).toISOString();
    const body = Buffer.from(JSON.stringify({ id: `evt_Principal${randomUUID()}`, type: "refund.updated", api_version: "2026-10-28.endive", created: timestamp,
      data: { object: { id: resource.providerRef, payment_intent: captured.providerRef, charge: captured.providerChargeRef, amount: source.amount / 3, currency: captured.currency.toLowerCase(), status: "succeeded" } } }));
    const signature = createHmac("sha256", secret).update(`${timestamp}.`).update(body).digest("hex");
    const adapter = createStripePayments({ secretKey: "sk_principal_raw_fixture_only", webhookSecrets: [secret], fetch: async (input, init = {}) => {
      const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
      if (url.href === "https://api.stripe.com/v1/account" && (init.method ?? "GET") === "GET") return Response.json({ id: "acct_fixturePlatform" });
      throw new Error(`Unexpected actual raw-verifier request ${init.method ?? "GET"} ${url.pathname}`);
    } });
    const decoded = await adapter.verifyWebhook({ body, receivedAt, headers: { "stripe-signature": `t=${timestamp},v1=${signature}` } });
    expect(decoded).toHaveLength(1); if (!decoded[0]) throw new Error("The actual signed refund event was not decoded.");
    await retainLegacyBankFeedback.call({ provider: "stripe", event: { ...decoded[0] }, rawBodySha256: createHash("sha256").update(body).digest("hex"), receivedAt }, { kind: "system" });
    // Deliberately stop at the real independently committed raw boundary: a
    // later domain handler may fail, but cannot erase this actual occurrence.
    const after = await originalPrincipalAuthority.call({ paymentId: source.paymentId }, { kind: "system" });
    expect(after).toMatchObject({ principalSafe: false, currentPrincipalMinor: 0, financialDebtPending: true });
    expect(after.reasons).toContain("inventory"); expect(after.witness.revision).not.toBe(before.witness.revision);
    expect(await db().select().from(legacyBankFeedback)).toHaveLength(1);
    expect(await db().select().from(payments)).toEqual(priorPayments); expect(await db().select().from(refunds)).toEqual(priorRefunds);
    expect(await db().select().from(merchantRefundObservations)).toEqual(priorDomain);
    expect((await db().select().from(payments).where(eq(payments.id, source.paymentId)))[0]?.refundedMinor).toBe(0);
    expect(await db().select().from(originalCashRecoveries)).toHaveLength(0); expect(await db().select().from(originalCashRecoveryOperations)).toHaveLength(0);
    expect(source.posts).toEqual([]);
  });
});
