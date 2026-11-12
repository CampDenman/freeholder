// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C3.31/C11.08: carrier consent and withdrawal need their original outcomes.
// Mocked provider HTTP only; no message or consent reaches an external site.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { resetMailForTests } from "@/adapters/mail";
import { setParadiseFetchForTests } from "@/adapters/paradise/http";
import { carrierResource } from "@/core/mail/carrier-operations";
import { users } from "@/core/auth/schema";
import { resolveContact } from "@/core/contacts/service";
import { db } from "@/core/db";
import { resetEnvForTests } from "@/core/env";
import { getJob, startJobProducer, stopJobs } from "@/core/jobs";
import { mirrorMarketingWithdrawal, rememberProviderGrant, withdrawDetachedGrants } from "@/core/mail/permission";
import { mailDispatches, mailDispatchRequests, mailProviderGrants, mailSenders } from "@/core/mail/schema";
import { deliverQueuedMail, sendMail } from "@/core/mail/service";
import { confirmCarrierWithdrawal } from "@/core/mail/carrier-services";
import { reconcileMailDispatch } from "@/core/mail/dispatch-services";
import { eraseMailRecords } from "@/core/mail/record-privacy";
import { dataRequestArtifacts, dataRequests } from "@/core/privacy/schema";
import { consentRecords } from "@/core/privacy/schema";
import { addRetentionException, createDataRequest, fulfillDataRequest, verifyDataRequest } from "@/core/privacy/service";
import { ready } from "@/core/runtime";
import { closeDb, hasDatabase, OWNER, truncateSpine } from "../helpers/spine";

const saved = new Map<string, string | undefined>();
const EMAIL = "fictional-reader@example.test";
const HUMAN = { ...OWNER, security: { twoFactorRequired: false, twoFactorEnrolled: true, twoFactorVerified: true, stepUpValid: true } };
function environment(values: Record<string, string>) {
  for (const [key, value] of Object.entries(values)) { if (!saved.has(key)) saved.set(key, process.env[key]); process.env[key] = value; }
  resetEnvForTests(); resetMailForTests();
}
async function reader() {
  const { contact } = await resolveContact.call({ name: "Fictional reader", email: EMAIL }, OWNER);
  const [consent] = await db().insert(consentRecords).values({ contactId: contact.id, purpose: "marketing", channel: "email", state: "granted", method: "double_opt_in", actor: `user:${OWNER.userId}`, evidence: { statement: "Yes, send me the fictional newsletter." } }).returning();
  return { contact, consent: consent! };
}
async function campaign(contactId: string) {
  await db().insert(mailSenders).values({ purpose: "bulk", provider: "paradise", email: "news@original.example.test", verificationStatus: "verified", status: "active", isDefault: true, createdBy: OWNER.userId });
  return db().transaction(tx => sendMail(tx, { to: EMAIL, subject: "Fictional newsletter", text: "Fictional original content", headers: { "List-Unsubscribe": "<https://original.example.test/unsubscribe>", "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" } }, { purpose: "bulk", marketingContactId: contactId, idempotencyKey: "fictional-original-campaign" }));
}
const withdrawal = (contactId: string) => ({ contactId, purpose: "marketing", channel: "email", state: "withdrawn" });

describe.runIf(hasDatabase)("original carrier consent and withdrawal operations (C3.31/C11.08)", () => {
  beforeAll(ready, 60_000);
  beforeEach(async () => {
    environment({ SESSION_SECRET: "carrier-operations-fixture-only-secret-material", APP_URL: "https://original.example.test", MAIL_BULK_ADAPTER: "paradise", MAIL_BULK_FROM: "news@original.example.test", PARADISEMODERN_API_KEY: "fictional-original-site-key", PARADISEMODERN_URL: "https://carrier-original.example.test" });
    await truncateSpine(); await db().insert(users).values({ id: OWNER.userId, role: "owner", email: "owner@example.test" }); await startJobProducer();
  });
  afterEach(() => { for (const [key, value] of saved) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } saved.clear(); resetEnvForTests(); resetMailForTests(); setParadiseFetchForTests(undefined); });
  afterAll(async () => { await stopJobs(); await closeDb(); });

  it("withdraws a grant actually recorded before the following send loses its reply", async () => {
    const { contact } = await reader(); let remoteGranted = false, sends = 0, withdrawals = 0;
    setParadiseFetchForTests(async url => {
      if (url.endsWith("/email/consent")) { remoteGranted = true; return new Response('{"id":42,"recorded_at":"2026-11-11T12:00:00.000Z"}', { status: 201 }); }
      if (url.endsWith("/email/consent/withdraw")) { remoteGranted = false; withdrawals++; return new Response('{"success":true}', { status: 200 }); }
      if (++sends === 1) return new Response('{"code":"EMAIL_CONSENT_REQUIRED"}', { status: 409 });
      throw new Error("Fictional lost final send reply after the remote consent completed");
    });
    const queued = await campaign(contact.id);
    expect(await deliverQueuedMail(queued.id)).toEqual({ status: "unknown" });
    expect(remoteGranted).toBe(true); expect(sends).toBe(2);
    await db().insert(consentRecords).values({ contactId: contact.id, purpose: "marketing", channel: "email", state: "withdrawn", method: "preference_center", actor: `user:${OWNER.userId}` });
    await mirrorMarketingWithdrawal(withdrawal(contact.id));
    expect(withdrawals).toBe(1); expect(remoteGranted).toBe(false);
  });

  it("keeps a refused detached withdrawal pending instead of deleting its only original witness", async () => {
    const { consent } = await reader();
    await db().transaction(async tx => rememberProviderGrant(tx, "paradise", { email: EMAIL, evidenceRef: `freeholder-consent:${consent.id}`, ...await carrierResource(tx) }));
    const [grant] = await db().select().from(mailProviderGrants);
    await db().update(mailProviderGrants).set({ consentRecordId: null }).where(eq(mailProviderGrants.id, grant!.id));
    setParadiseFetchForTests(async () => new Response('{"code":"SITE_KEY_FORBIDDEN"}', { status: 403 }));
    expect(await withdrawDetachedGrants([grant!.id])).toEqual({ removed: 0, waiting: 1 });
    expect(await db().select().from(mailProviderGrants).where(eq(mailProviderGrants.id, grant!.id))).toHaveLength(1);
  });

  it("refuses to withdraw an original grant through a replacement site account", async () => {
    const { contact } = await reader(); let sends = 0; const withdrawals: string[] = [];
    setParadiseFetchForTests(async url => {
      if (url.endsWith("/email/consent/withdraw")) { withdrawals.push(url); return new Response('{"success":true}', { status: 200 }); }
      if (url.endsWith("/email/consent")) return new Response('{"id":42,"recorded_at":"2026-11-11T12:00:00.000Z"}', { status: 201 });
      if (++sends === 1) return new Response('{"code":"EMAIL_CONSENT_REQUIRED"}', { status: 409 });
      return new Response('{"messageId":"fictional-original-carrier-message"}', { status: 200 });
    });
    const queued = await campaign(contact.id); expect(await deliverQueuedMail(queued.id)).toEqual({ status: "submitted" });
    expect(await db().select().from(mailProviderGrants)).toHaveLength(1);
    environment({ PARADISEMODERN_API_KEY: "fictional-replacement-site-key", PARADISEMODERN_URL: "https://carrier-replacement.example.test" });
    await expect(mirrorMarketingWithdrawal(withdrawal(contact.id))).rejects.toMatchObject({ code: "conflict" });
    expect(withdrawals).toEqual([]);
    expect((await db().select().from(mailProviderGrants))[0]?.withdrawnAt).toBeNull();
  });

  it("keeps a lost withdrawal reply unknown and never automatically repeats its physical call", async () => {
    const { consent } = await reader();
    await db().transaction(async tx => rememberProviderGrant(tx, "paradise", { email: EMAIL, evidenceRef: `freeholder-consent:${consent.id}`, ...await carrierResource(tx) }));
    const [grant] = await db().select().from(mailProviderGrants);
    await db().update(mailProviderGrants).set({ consentRecordId: null }).where(eq(mailProviderGrants.id, grant!.id));
    let calls = 0;
    setParadiseFetchForTests(async () => { calls++; throw new Error("Remote withdrawal may have completed; reply lost"); });
    expect(await withdrawDetachedGrants([grant!.id])).toEqual({ removed: 0, waiting: 1 });
    expect(await withdrawDetachedGrants([grant!.id])).toEqual({ removed: 0, waiting: 1 });
    expect(calls).toBe(1);
    expect((await db().select().from(mailProviderGrants))[0]?.carrierOperations).toMatchObject([{ kind: "withdraw", state: "unknown" }]);
  });

  it("quarantines a legacy grant without borrowing the configured account", async () => {
    const { consent } = await reader();
    await rememberProviderGrant(db(), "paradise", { email: EMAIL, evidenceRef: `freeholder-consent:${consent.id}` });
    const [grant] = await db().select().from(mailProviderGrants);
    await db().update(mailProviderGrants).set({ consentRecordId: null }).where(eq(mailProviderGrants.id, grant!.id));
    let calls = 0; setParadiseFetchForTests(async () => { calls++; return new Response("{}", { status: 200 }); });
    await expect(withdrawDetachedGrants([grant!.id])).rejects.toMatchObject({ code: "conflict" });
    expect(calls).toBe(0);
    expect((await db().select().from(mailProviderGrants))[0]?.resourceDigest).toBeNull();
  });

  it("retains an uncertain consent call separately from the first send refusal", async () => {
    const { contact } = await reader(); let calls = 0;
    setParadiseFetchForTests(async url => {
      calls++;
      if (url.endsWith("/email/consent")) throw new Error("Remote grant may have committed before reply was lost");
      return new Response('{"code":"EMAIL_CONSENT_REQUIRED"}', { status: 409 });
    });
    const queued = await campaign(contact.id);
    expect(await deliverQueuedMail(queued.id)).toEqual({ status: "unknown" });
    expect((await db().select().from(mailDispatches))[0]?.carrierOperations).toMatchObject([{ kind: "send", state: "refused" }, { kind: "consent", state: "unknown" }]);
    expect((await db().select().from(mailProviderGrants))[0]?.carrierOperations).toMatchObject([{ kind: "consent", state: "unknown" }]);
    await mirrorMarketingWithdrawal(withdrawal(contact.id));
    expect(calls).toBe(2);
  });

  it("does not erase a grant on an HTTP-success response that denies withdrawal", async () => {
    const { consent } = await reader();
    await db().transaction(async tx => rememberProviderGrant(tx, "paradise", { email: EMAIL, evidenceRef: `freeholder-consent:${consent.id}`, ...await carrierResource(tx) }));
    const [grant] = await db().select().from(mailProviderGrants);
    await db().update(mailProviderGrants).set({ consentRecordId: null }).where(eq(mailProviderGrants.id, grant!.id));
    setParadiseFetchForTests(async () => new Response('{"success":false}', { status: 200 }));
    expect(await withdrawDetachedGrants([grant!.id])).toEqual({ removed: 0, waiting: 1 });
    expect((await db().select().from(mailProviderGrants))[0]?.carrierOperations).toMatchObject([{ kind: "withdraw", state: "unknown" }]);
  });

  it("does not record or send against consent withdrawn during the first request", async () => {
    const { contact } = await reader(); let sends = 0, grants = 0;
    setParadiseFetchForTests(async url => {
      if (url.endsWith("/email/consent")) { grants++; return new Response('{"id":42}', { status: 201 }); }
      if (++sends === 1) {
        await db().insert(consentRecords).values({ contactId: contact.id, purpose: "marketing", channel: "email", state: "withdrawn", method: "preference_center", actor: `user:${OWNER.userId}` });
        return new Response('{"code":"EMAIL_CONSENT_REQUIRED"}', { status: 409 });
      }
      return new Response('{"messageId":"fictional-forbidden-second-send"}', { status: 200 });
    });
    const queued = await campaign(contact.id); await deliverQueuedMail(queued.id);
    expect(grants).toBe(0); expect(sends).toBe(1);
  });

  it("does not repeat an unknown address withdrawal through a sibling grant", async () => {
    const { contact, consent } = await reader();
    await db().transaction(async tx => rememberProviderGrant(tx, "paradise", { email: EMAIL, evidenceRef: `freeholder-consent:${consent.id}`, ...await carrierResource(tx) }));
    const [second] = await db().insert(consentRecords).values({ contactId: contact.id, purpose: "marketing", channel: "email", state: "granted", method: "double_opt_in", actor: `user:${OWNER.userId}` }).returning();
    await db().transaction(async tx => rememberProviderGrant(tx, "paradise", { email: EMAIL, evidenceRef: `freeholder-consent:${second!.id}`, ...await carrierResource(tx) }));
    await db().update(mailProviderGrants).set({ consentRecordId: null });
    let calls = 0; setParadiseFetchForTests(async () => { calls++; throw new Error("Fictional lost original address withdrawal reply"); });
    expect(await withdrawDetachedGrants()).toEqual({ removed: 0, waiting: 2 });
    expect(await withdrawDetachedGrants()).toEqual({ removed: 0, waiting: 2 });
    expect(calls).toBe(1);
    const receipts = await db().select().from(mailProviderGrants);
    expect(receipts[0]?.carrierOperations[0]?.id).toBe(receipts[1]?.carrierOperations[0]?.id);
  });

  it("uses one positive original address acknowledgment for the grant set claimed before HTTP", async () => {
    const { contact, consent } = await reader();
    await db().transaction(async tx => rememberProviderGrant(tx, "paradise", { email: EMAIL, evidenceRef: `freeholder-consent:${consent.id}`, ...await carrierResource(tx) }));
    const [second] = await db().insert(consentRecords).values({ contactId: contact.id, purpose: "marketing", channel: "email", state: "granted", method: "double_opt_in", actor: `user:${OWNER.userId}` }).returning();
    await db().transaction(async tx => rememberProviderGrant(tx, "paradise", { email: EMAIL, evidenceRef: `freeholder-consent:${second!.id}`, ...await carrierResource(tx) }));
    await db().update(mailProviderGrants).set({ consentRecordId: null });
    let calls = 0; setParadiseFetchForTests(async () => { calls++; return new Response('{"success":true}', { status: 200 }); });
    expect(await withdrawDetachedGrants()).toEqual({ removed: 2, waiting: 0 }); expect(calls).toBe(1);
    const receipts = await db().select().from(mailProviderGrants);
    expect(receipts).toHaveLength(2); expect(receipts.every(row => row.email === "" && row.redactedAt && row.emailDigest)).toBe(true);
    expect(receipts[0]?.carrierOperations[0]?.id).toBe(receipts[1]?.carrierOperations[0]?.id);
  });

  it("retains a late original consent acknowledgment after verified withdrawal and address erasure", async () => {
    const { contact } = await reader(); let sends = 0;
    let entered!: () => void, release!: () => void;
    const waiting = new Promise<void>(resolve => { entered = resolve; }), held = new Promise<void>(resolve => { release = resolve; });
    setParadiseFetchForTests(async url => {
      if (url.endsWith("/email/consent")) { entered(); await held; return new Response('{"id":42}', { status: 201 }); }
      sends++; return new Response('{"code":"EMAIL_CONSENT_REQUIRED"}', { status: 409 });
    });
    const queued = await campaign(contact.id), caller = deliverQueuedMail(queued.id);
    try {
      await waiting;
      await db().insert(consentRecords).values({ contactId: contact.id, purpose: "marketing", channel: "email", state: "withdrawn", method: "preference_center", actor: `user:${OWNER.userId}` });
      const [original] = await db().select().from(mailProviderGrants);
      await db().update(mailProviderGrants).set({ consentRecordId: null }).where(eq(mailProviderGrants.id, original!.id));
      const [grant] = await db().select().from(mailProviderGrants);
      await confirmCarrierWithdrawal.call({ id: grant!.id, expectedRevision: grant!.revision, expectedEmail: EMAIL, originalResourceEvidence: "Fictional exact original account independently verified.", finalProviderEvidence: "Fictional original provider final record confirms the remote grant was withdrawn after recording.", stoppedCallerEvidence: "Fictional original remote operation completed and its caller was positively stopped before review.", providerOperationRef: "fictional-original-final-withdrawal", confirmation: "ORIGINAL CARRIER WITHDRAWAL VERIFIED" }, HUMAN);
      expect(await withdrawDetachedGrants([grant!.id])).toEqual({ removed: 1, waiting: 0 });
    } finally { release(); await caller; }
    const [receipt] = await db().select().from(mailProviderGrants);
    expect(receipt?.email).toBe(""); expect(receipt?.redactedAt).toBeInstanceOf(Date);
    expect(receipt?.carrierOperations).toMatchObject([{ kind: "consent", state: "confirmed" }]);
    expect(receipt?.carrierOperations[0]?.responseDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(sends).toBe(1);
  });

  it.each(["intact", "missing", "corrupt", "prewithdrawn"] as const)("reopens completed erasure when a deferred original consent is physically created afterwards (%s original artifact)", async artifactState => {
    const { contact } = await reader(); let remoteGranted = false, sends = 0;
    let entered!: () => void, release!: () => void;
    const waiting = new Promise<void>(resolve => { entered = resolve; }), held = new Promise<void>(resolve => { release = resolve; });
    setParadiseFetchForTests(async url => {
      if (url.endsWith("/email/consent")) {
        entered(); await held;
        // This is a new physical grant after erasure, not an old ACK for a
        // grant that was already created and then withdrawn before erasure.
        remoteGranted = true;
        return new Response('{"id":76}', { status: 201 });
      }
      if (url.endsWith("/email/consent/withdraw")) { remoteGranted = false; return new Response('{"success":true}', { status: 200 }); }
      sends++; return new Response('{"code":"EMAIL_CONSENT_REQUIRED"}', { status: 409 });
    });
    const queued = await campaign(contact.id), caller = deliverQueuedMail(queued.id);
    let requestId: string | undefined;
    let originalArtifact: typeof dataRequestArtifacts.$inferSelect | undefined;
    try {
      await waiting; expect(remoteGranted).toBe(false);
      if (artifactState === "prewithdrawn") {
        const [prior] = await db().select().from(mailProviderGrants);
        await confirmCarrierWithdrawal.call({ id: prior!.id, expectedRevision: prior!.revision, expectedEmail: EMAIL, originalResourceEvidence: "Fictional original provider account and exact pending consent operation identified.", finalProviderEvidence: "Fictional provider final records currently confirm no grant exists for this original request.", stoppedCallerEvidence: "Fictional provider independently reports the original caller and pending remote operation stopped.", providerOperationRef: "fictional-pre-erasure-withdrawal-76", confirmation: "ORIGINAL CARRIER WITHDRAWAL VERIFIED" }, HUMAN);
      }
      const request = await createDataRequest.call({ contactId: contact.id, request: { kind: "erasure" } }, HUMAN); requestId = request.id;
      await verifyDataRequest.call({ id: request.id, method: "Fictional independent original subject identity verification." }, HUMAN);
      const fulfilled = await fulfillDataRequest.call({ id: request.id, confirmation: "ERASE" }, HUMAN);
      expect(fulfilled.request.status).toBe("in_progress");
      const [grant] = await db().select().from(mailProviderGrants);
      if (artifactState !== "prewithdrawn") await confirmCarrierWithdrawal.call({ id: grant!.id, expectedRevision: grant!.revision, expectedEmail: EMAIL, originalResourceEvidence: "Fictional original provider account and exact pending consent operation identified.", finalProviderEvidence: "Fictional provider final records currently confirm no grant exists for this original request.", stoppedCallerEvidence: "Fictional provider independently reports the original caller and pending remote operation stopped.", providerOperationRef: "fictional-original-stopped-consent-76", confirmation: "ORIGINAL CARRIER WITHDRAWAL VERIFIED" }, HUMAN);
      expect(await withdrawDetachedGrants([grant!.id])).toEqual({ removed: artifactState === "prewithdrawn" ? 0 : 1, waiting: 0 });
      const [dispatch] = await db().select().from(mailDispatches).where(eq(mailDispatches.deliveryId, queued.id));
      await reconcileMailDispatch.call({ deliveryId: queued.id, dispatchId: dispatch!.id, expectedAttempts: 1, expectedRecipient: EMAIL, expectedProviderRef: null, outcome: "not_submitted", providerOperationRef: "fictional-original-no-send-76", originalRouteEvidence: "Fictional original carrier account matches the frozen exact route.", finalProviderEvidence: "Fictional provider final record currently confirms no message was submitted.", stoppedCallerEvidence: "Fictional provider independently reports this exact original message caller stopped.", confirmation: "ORIGINAL PROVIDER OUTCOME VERIFIED" }, HUMAN);
      const receipt = fulfilled.artifact.body as { outcomes: Array<{ scope: string; pendingJobs?: string[] }> };
      const recordJobId = receipt.outcomes.find(outcome => outcome.scope === "mail.records")!.pendingJobs![0]!;
      const recordJob = await getJob("core.eraseMailRecords", recordJobId); expect(recordJob).toBeTruthy();
      await eraseMailRecords(recordJob!.data);
      expect((await db().select().from(dataRequests).where(eq(dataRequests.id, request.id)))[0]!.status).toBe("completed");
      expect(remoteGranted).toBe(false);
      [originalArtifact] = await db().select().from(dataRequestArtifacts).where(eq(dataRequestArtifacts.dataRequestId, request.id));
      if (artifactState === "missing") await db().delete(dataRequestArtifacts).where(eq(dataRequestArtifacts.id, originalArtifact!.id));
      if (artifactState === "corrupt") await db().update(dataRequestArtifacts).set({ sha256: "0".repeat(64) }).where(eq(dataRequestArtifacts.id, originalArtifact!.id));
    } finally { release(); await caller; }
    expect(remoteGranted).toBe(true); expect(sends).toBe(1);
    const [grant] = await db().select().from(mailProviderGrants);
    expect(grant).toMatchObject({ email: "", erasureRequestId: requestId });
    expect(grant!.carrierOperations[0]).toMatchObject({ kind: "consent", state: "confirmed" });
    expect((await db().select().from(dataRequests).where(eq(dataRequests.id, requestId)))[0]!.status).toBe("in_progress");
    const originalWithdrawal = grant!.withdrawnAt, originalReview = grant!.reviewDigest;
    expect(grant!.recoveryPending).toBe(true); expect(originalWithdrawal).toBeInstanceOf(Date);
    expect(await withdrawDetachedGrants([grant!.id])).toEqual({ removed: 0, waiting: 1 });
    expect(remoteGranted).toBe(true); expect(sends).toBe(1);
    const [current] = await db().select().from(mailProviderGrants);
    // Only independent new evidence can resolve the contradiction. The erased
    // address is never reconstructed or sent to the configured provider.
    remoteGranted = false;
    await confirmCarrierWithdrawal.call({ id: current!.id, expectedRevision: current!.revision, expectedEmail: "", originalResourceEvidence: "Fictional independently verified original account and exact operation 76.", finalProviderEvidence: "Fictional new provider final record confirms operation 76 grant is now absent.", stoppedCallerEvidence: "Fictional new provider record verifies every original operation and caller finally stopped.", providerOperationRef: "fictional-new-final-withdrawal-76", confirmation: "ORIGINAL CARRIER WITHDRAWAL VERIFIED" }, HUMAN);
    if (artifactState === "missing" || artifactState === "corrupt") {
      expect(await withdrawDetachedGrants([grant!.id])).toEqual({ removed: 0, waiting: 1 });
      expect((await db().select().from(dataRequests).where(eq(dataRequests.id, requestId)))[0]!.status).toBe("in_progress");
      const artifacts = await db().select().from(dataRequestArtifacts).where(eq(dataRequestArtifacts.dataRequestId, requestId));
      if (artifactState === "missing") { expect(artifacts).toHaveLength(0); await db().insert(dataRequestArtifacts).values(originalArtifact!); }
      else { expect(artifacts[0]!.sha256).toBe("0".repeat(64)); await db().update(dataRequestArtifacts).set({ body: originalArtifact!.body, sha256: originalArtifact!.sha256 }).where(eq(dataRequestArtifacts.id, originalArtifact!.id)); }
    }
    expect(await withdrawDetachedGrants([grant!.id])).toEqual({ removed: 0, waiting: 0 });
    const [settled] = await db().select().from(mailProviderGrants);
    expect(settled).toMatchObject({ email: "", withdrawnAt: originalWithdrawal, reviewDigest: originalReview, recoveryPending: false });
    expect(settled!.withdrawalReviews).toHaveLength(2);
    expect((await db().select().from(dataRequests).where(eq(dataRequests.id, requestId)))[0]!.status).toBe("completed");
  });

  it("fences the previous image's carrier read and new physical send before HTTP", async () => {
    const { contact } = await reader(), queued = await campaign(contact.id);
    let calls = 0;
    const oldWithdrawal = async () => { await db().execute(sql`select email from mail_provider_grants`); calls++; };
    await expect(oldWithdrawal()).rejects.toThrow(); expect(calls).toBe(0);
    const [request] = await db().select().from(mailDispatchRequests).where(eq(mailDispatchRequests.deliveryId, queued.id));
    await expect(db().transaction(async tx => {
      await tx.execute(sql`select set_config('freeholder.mail_dispatch_v1','1',true)`);
      await tx.execute(sql`select set_config('freeholder.mail_carrier_v1','',true)`);
      await tx.insert(mailDispatches).values({ deliveryId: queued.id, routeDigest: request!.routeDigest, payloadDigest: request!.payloadDigest, attempt: 1, state: "running" });
    })).rejects.toThrow();
    expect(await db().select().from(mailDispatches)).toHaveLength(0);
  });

  it("preserves a named held grant after erasure detaches its consent parent", async () => {
    const { contact, consent } = await reader();
    await db().transaction(async tx => rememberProviderGrant(tx, "paradise", { email: EMAIL, evidenceRef: `freeholder-consent:${consent.id}`, ...await carrierResource(tx) }));
    const [grant] = await db().select().from(mailProviderGrants);
    const request = await createDataRequest.call({ contactId: contact.id, request: { kind: "erasure" } }, HUMAN);
    await verifyDataRequest.call({ id: request.id, method: "Fictional identity independently verified" }, HUMAN);
    await addRetentionException.call({ dataRequestId: request.id, scope: "mail.provider_grants", reason: "legal_obligation", legalBasis: "Fictional named dispute requires preservation of this exact original grant." }, HUMAN);
    await fulfillDataRequest.call({ id: request.id, confirmation: "ERASE" }, HUMAN);
    setParadiseFetchForTests(async () => new Response('{"success":true}', { status: 200 }));
    await withdrawDetachedGrants([grant!.id]);
    const [held] = await db().select().from(mailProviderGrants).where(eq(mailProviderGrants.id, grant!.id));
    expect(held?.email).toBe(EMAIL);
  });
});
