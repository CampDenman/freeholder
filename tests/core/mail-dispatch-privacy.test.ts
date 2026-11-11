// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C3.31/C11.08: original dispatch evidence participates in real erasure and holds.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
const smtp = vi.hoisted(() => ({ send: vi.fn() }));
vi.mock("nodemailer", () => ({ createTransport: () => ({ sendMail: smtp.send }) }));
import { resetMailForTests } from "@/adapters/mail";
import { users } from "@/core/auth/schema";
import { resolveContact } from "@/core/contacts/service";
import { db } from "@/core/db";
import { resetEnvForTests } from "@/core/env";
import { getJob, startJobProducer, stopJobs } from "@/core/jobs";
import { reconcileMailDispatch } from "@/core/mail/dispatch-services";
import { eraseMailRecords } from "@/core/mail/record-privacy";
import { mailReceipts } from "@/core/mail/receipts";
import { mailDeliveries, mailDispatches, mailDispatchRequests, mailOutbox } from "@/core/mail/schema";
import { deliverQueuedMail, pruneExpiredMailOutbox, sendMail } from "@/core/mail/service";
import { addRetentionException, contactPrivacySources, createDataRequest, fulfillDataRequest, removeRetentionException, verifyDataRequest } from "@/core/privacy/service";
import { ready } from "@/core/runtime";
import { closeDb, hasDatabase, OWNER, truncateSpine } from "../helpers/spine";

const HUMAN = { ...OWNER, security: { twoFactorRequired: false, twoFactorEnrolled: true, twoFactorVerified: true, stepUpValid: true } };
const ADDRESS = "fictional@example.test", PAST = new Date("2020-01-01T00:00:00Z");
const originalEnv = new Map<string, string | undefined>();
function environment(values: Record<string, string>) { for (const [name, value] of Object.entries(values)) { if (!originalEnv.has(name)) originalEnv.set(name, process.env[name]); process.env[name] = value; } resetEnvForTests(); resetMailForTests(); }
async function prepare() {
  const { contact } = await resolveContact.call({ email: ADDRESS }, HUMAN);
  const queued = await db().transaction(tx => sendMail(tx, { to: ADDRESS, subject: "Fictional private receipt", text: "Fictional original body" }, { requireDelivery: true }));
  return { contact, queued };
}
async function erase(contactId: string, hold = false) {
  const request = await createDataRequest.call({ contactId, request: { kind: "erasure" } }, HUMAN);
  await verifyDataRequest.call({ id: request.id, method: "Fictional identity verified independently" }, HUMAN);
  const exception = hold ? await addRetentionException.call({ dataRequestId: request.id, scope: "mail.records", reason: "legal_obligation", legalBasis: "Fictional legal dispute requiring the exact original mail evidence" }, HUMAN) : null;
  return { result: await fulfillDataRequest.call({ id: request.id, confirmation: "ERASE" }, HUMAN), exception };
}
async function confirmSubmitted(deliveryId: string) {
  const [dispatch] = await db().select().from(mailDispatches).where(eq(mailDispatches.deliveryId, deliveryId));
  return reconcileMailDispatch.call({ deliveryId, dispatchId: dispatch!.id, expectedAttempts: 1, expectedRecipient: ADDRESS, expectedProviderRef: null, outcome: "submitted", providerOperationRef: "original-server-log-confirmed", originalRouteEvidence: "Fictional original server and account match the frozen route.", finalProviderEvidence: "Fictional server record positively confirms this exact original send was accepted.", stoppedCallerEvidence: "Fictional original caller is stopped and the remote operation has definitively ended.", confirmation: "ORIGINAL PROVIDER OUTCOME VERIFIED" }, HUMAN);
}
describe.runIf(hasDatabase)("mail dispatch privacy and holds (C3.31/C11.08)", () => {
  beforeAll(ready, 60_000);
  beforeEach(async () => {
    environment({ SESSION_SECRET: "mail-privacy-fixture-only-secret-material", MAIL_ADAPTER: "smtp", SMTP_HOST: "original.example.test", SMTP_PORT: "587", SMTP_USER: "fixture-account", SMTP_PASSWORD: "fixture-password", MAIL_FROM: "sender@example.test" });
    await truncateSpine(); await db().insert(users).values({ id: OWNER.userId, email: "owner@example.test", role: "owner" }); await startJobProducer(); smtp.send.mockReset();
  });
  afterEach(() => { for (const [name, value] of originalEnv) { if (value === undefined) delete process.env[name]; else process.env[name] = value; } originalEnv.clear(); resetEnvForTests(); resetMailForTests(); vi.restoreAllMocks(); });
  afterAll(async () => { await stopJobs(); await closeDb(); });

  it("keeps legally held unsent evidence without sending it after its original recipient was erased", async () => {
    const { contact, queued } = await prepare();
    await erase(contact.id, true);
    smtp.send.mockResolvedValue({ messageId: "late-held-send", accepted: [ADDRESS], rejected: [], response: "250 queued" });
    await deliverQueuedMail(queued.id);
    expect(smtp.send).not.toHaveBeenCalled();
    expect(await db().select().from(mailOutbox)).toHaveLength(1);
    expect((await db().select().from(mailDeliveries))[0]?.attempts).toBe(0);
  });
  it("preserves a held original body after a human confirms the old physical outcome", async () => {
    const { contact, queued } = await prepare();
    smtp.send.mockRejectedValueOnce(new Error("Fictional lost original reply")); await deliverQueuedMail(queued.id);
    const { exception } = await erase(contact.id, true);
    await confirmSubmitted(queued.id);
    await db().transaction(async tx => { await mailReceipts(tx); await tx.update(mailOutbox).set({ createdAt: PAST }).where(eq(mailOutbox.deliveryId, queued.id)); });
    expect(await pruneExpiredMailOutbox()).toBe(0);
    expect(await db().select().from(mailOutbox)).toHaveLength(1);
    await removeRetentionException.call({ id: exception!.id }, HUMAN);
    expect(await pruneExpiredMailOutbox()).toBe(1);
    expect((await db().select().from(mailDeliveries))[0]?.status).toBe("submitted");
  });
  it("keeps erasure pending until the original outcome settles and exports only public receipt fields", async () => {
    const { contact, queued } = await prepare();
    smtp.send.mockRejectedValueOnce(new Error("Fictional lost original reply")); await deliverQueuedMail(queued.id);
    const scope = contactPrivacySources().find(item => item.scope === "mail.records")!;
    const exported = await db().transaction(tx => scope.exportData(tx, contact.id));
    for (const key of ["routeDigest", "payloadDigest", "authorizationDigest", "resolutionDigest", "initialReviewDigest", "encryptedRoute"]) expect(JSON.stringify(exported)).not.toContain(key);
    const { result } = await erase(contact.id);
    expect(result.request.status).toBe("in_progress");
    const body = result.artifact.body as { outcomes: Array<{ scope: string; pendingJobs?: string[] }> };
    const id = body.outcomes.find(item => item.scope === "mail.records")!.pendingJobs![0]!;
    const job = await getJob("core.eraseMailRecords", id);
    await expect(eraseMailRecords(job!.data)).rejects.toThrow(/Unresolved/);
    await confirmSubmitted(queued.id); await eraseMailRecords(job!.data);
    const [request] = await db().select().from(mailDispatchRequests);
    expect(request?.encryptedRoute).toBeNull();
    expect((await db().select().from(mailDispatches))[0]?.providerRef).toBeNull();
    expect((await db().select().from(mailDeliveries))[0]?.redactedAt).not.toBeNull();
  });
});
