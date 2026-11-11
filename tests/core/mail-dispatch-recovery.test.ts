// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C3.31/C11.08: each physical mail attempt needs its original outcome and route.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
const smtp = vi.hoisted(() => ({ send: vi.fn(), routes: [] as Array<Record<string, unknown>> }));
vi.mock("nodemailer", () => ({ createTransport: (route: Record<string, unknown>) => {
  smtp.routes.push(route);
  return { sendMail: smtp.send };
} }));
import { resetMailForTests } from "@/adapters/mail";
import { db } from "@/core/db";
import { resetEnvForTests } from "@/core/env";
import { startJobProducer, stopJobs } from "@/core/jobs";
import { mailDeliveries, mailDispatches, mailDispatchRequests, mailLegacyResolutions, mailOutbox } from "@/core/mail/schema";
import { deliverQueuedMail, sendMail } from "@/core/mail/service";
import { ready } from "@/core/runtime";
import { reconcileMailDispatch, retryReconciledMail, listMailDispatchRecovery } from "@/core/mail/dispatch-services";
import { users } from "@/core/auth/schema";
import { auditLog } from "@/core/events/schema";
import { closeDb, failure, hasDatabase, OWNER, truncateSpine } from "../helpers/spine";
import { historicalMailFixture } from "../helpers/mail-fixture";

const changed = new Map<string, string | undefined>();
function environment(values: Record<string, string | undefined>) {
  for (const [name, value] of Object.entries(values)) {
    if (!changed.has(name)) changed.set(name, process.env[name]);
    if (value === undefined) delete process.env[name]; else process.env[name] = value;
  }
  resetEnvForTests(); resetMailForTests();
}
async function stage() {
  return db().transaction(tx => sendMail(tx, {
    to: "fictional@example.test", subject: "Fictional original receipt", text: "Fictional private receipt body",
  }, { requireDelivery: true, idempotencyKey: "dispatch-original-request" }));
}
const HUMAN = { ...OWNER, security: { twoFactorRequired: false, twoFactorEnrolled: true, twoFactorVerified: true, stepUpValid: true } };
async function unknown() {
  smtp.send.mockRejectedValueOnce(new Error("Fictional missing original server reply"));
  const staged = await stage(); await deliverQueuedMail(staged.id);
  const [dispatch] = await db().select().from(mailDispatches).where(eq(mailDispatches.deliveryId, staged.id));
  return { staged, dispatch: dispatch! };
}
function proof(deliveryId: string, dispatchId?: string) {
  return { deliveryId, ...(dispatchId ? { dispatchId } : {}), expectedAttempts: 1, expectedRecipient: "fictional@example.test", expectedProviderRef: null,
    outcome: "not_submitted" as const, providerOperationRef: "original-server-audit-123",
    originalRouteEvidence: "Fictional original server and account independently matched to this exact request.",
    finalProviderEvidence: "Fictional original server log guarantees this physical request never submitted a message.",
    stoppedCallerEvidence: "Fictional original worker is positively stopped and its remote operation has ended.",
    confirmation: "ORIGINAL PROVIDER OUTCOME VERIFIED" as const };
}

describe.runIf(hasDatabase)("physical mail dispatch recovery (C3.31/C11.08)", () => {
  beforeAll(ready, 60_000);
  beforeEach(async () => {
    environment({ SESSION_SECRET: "mail-dispatch-synthetic-secret-material-32-bytes", MAIL_ADAPTER: "smtp", SMTP_HOST: "original-smtp.example.test", SMTP_PORT: "587", SMTP_USER: "original-account", SMTP_PASSWORD: "fictional-password", MAIL_FROM: "sender@example.test" });
    await truncateSpine(); await db().insert(users).values({ id: OWNER.userId, email: "owner@example.test", role: "owner" }); await startJobProducer(); smtp.send.mockReset(); smtp.routes.length = 0;
  });
  afterEach(() => {
    for (const [name, value] of changed) { if (value === undefined) delete process.env[name]; else process.env[name] = value; }
    changed.clear(); resetEnvForTests(); resetMailForTests(); vi.restoreAllMocks();
  });
  afterAll(async () => { await truncateSpine(); await stopJobs(); await closeDb(); });

  it("never repeats a physical SMTP send after the first server reply is lost", async () => {
    smtp.send.mockRejectedValueOnce(new Error("Fictional connection lost after remote acceptance"))
      .mockResolvedValue({ messageId: "fictional-later-send", accepted: ["fictional@example.test"], rejected: [], response: "250 queued" });
    const staged = await stage();
    await deliverQueuedMail(staged.id).catch(() => undefined);
    await deliverQueuedMail(staged.id).catch(() => undefined);
    expect(smtp.send).toHaveBeenCalledTimes(1);
    const [delivery] = await db().select().from(mailDeliveries).where(eq(mailDeliveries.id, staged.id));
    expect(delivery?.attempts).toBe(1);
    expect(await db().select().from(mailOutbox).where(eq(mailOutbox.deliveryId, staged.id))).toHaveLength(1);
  });

  it("does not send an already staged message through a replacement SMTP server/account", async () => {
    smtp.send.mockResolvedValue({ messageId: "fictional-replacement-send", accepted: ["fictional@example.test"], rejected: [], response: "250 queued" });
    const staged = await stage();
    environment({ SMTP_HOST: "replacement-smtp.example.test", SMTP_USER: "replacement-account" });
    await deliverQueuedMail(staged.id).catch(() => undefined);
    expect(smtp.send).not.toHaveBeenCalled();
    const [delivery] = await db().select().from(mailDeliveries).where(eq(mailDeliveries.id, staged.id));
    expect(delivery?.attempts).toBe(0);
  });

  it("lets only one worker enter a physical send while its original caller is still running", async () => {
    let reached!: () => void;
    const entered = new Promise<void>(resolve => { reached = resolve; });
    let release!: () => void;
    const hold = new Promise<void>(resolve => { release = resolve; });
    smtp.send.mockImplementationOnce(async () => { reached(); await hold; return { messageId: "fictional-original-send", accepted: ["fictional@example.test"], rejected: [], response: "250 queued" }; })
      .mockResolvedValue({ messageId: "fictional-duplicate-send", accepted: ["fictional@example.test"], rejected: [], response: "250 queued" });
    const staged = await stage();
    const first = deliverQueuedMail(staged.id);
    try { await entered; await deliverQueuedMail(staged.id).catch(() => undefined); expect(smtp.send).toHaveBeenCalledTimes(1); }
    finally { release(); await first; }
  });
  it("requires a fresh person and keeps raw recovery evidence out of the original actor's audit", async () => {
    const { staged, dispatch } = await unknown(), input = proof(staged.id, dispatch.id);
    for (const actor of [{ kind: "system" as const }, { kind: "agent" as const, keyName: "fixture", scopes: ["*"] }, { kind: "plugin" as const, name: "fixture", grants: HUMAN.grants }, { ...HUMAN, keyScopes: ["mail.reconcileDispatch"] }]) expect((await failure(reconcileMailDispatch.call(input, actor))).code).toBe("permission");
    expect((await failure(reconcileMailDispatch.call(input, { ...HUMAN, security: { ...HUMAN.security, stepUpValid: false } }))).code).toBe("step_up_required");
    expect((await db().select().from(mailDispatches))[0]?.state).toBe("unknown");
    await reconcileMailDispatch.call(input, HUMAN);
    const [audit] = await db().select().from(auditLog).where(eq(auditLog.action, "mail.reconcileDispatch"));
    expect(audit?.actor).toBe(`user:${OWNER.userId}`);
    expect(audit?.diff).toEqual({ deliveryId: staged.id, dispatchId: dispatch.id, outcome: "not_submitted" });
    expect(JSON.stringify(audit)).not.toContain(input.finalProviderEvidence);
    expect((await db().select().from(mailDispatches))[0]).toMatchObject({ state: "not_submitted", resolutionSource: "human_provider_confirmation", resolvedBy: OWNER.userId });
  });
  it("allows one explicitly authorized retry only after the original caller has guaranteed no submission", async () => {
    const { staged, dispatch } = await unknown();
    expect((await failure(retryReconciledMail.call({ deliveryId: staged.id, confirmation: "RETRY THE ORIGINAL MESSAGE" }, HUMAN))).code).toBe("conflict");
    await reconcileMailDispatch.call(proof(staged.id, dispatch.id), HUMAN);
    smtp.send.mockResolvedValue({ messageId: "fictional-recovered-send", accepted: ["fictional@example.test"], rejected: [], response: "250 queued" });
    await deliverQueuedMail(staged.id); expect(smtp.send).toHaveBeenCalledTimes(1);
    await retryReconciledMail.call({ deliveryId: staged.id, confirmation: "RETRY THE ORIGINAL MESSAGE" }, HUMAN);
    await deliverQueuedMail(staged.id);
    expect(smtp.send).toHaveBeenCalledTimes(2);
    expect((await db().select().from(mailDispatches).orderBy(mailDispatches.attempt)).map(row => row.state)).toEqual(["not_submitted", "submitted"]);
    expect((await db().select().from(mailDispatchRequests))[0]?.admittedAttempt).toBe(2);
    await deliverQueuedMail(staged.id); expect(smtp.send).toHaveBeenCalledTimes(2);
  });
  it("does not invent per-attempt or account facts while resolving an old unknown send", async () => {
    const [legacy] = await historicalMailFixture(tx => tx.insert(mailDeliveries).values({ provider: "smtp", purpose: "transactional", recipient: "fictional@example.test", subject: "Fictional old receipt", attempts: 3, status: "submitted", providerRef: "only-original-legacy-reference", requestedBy: "system" }).returning());
    const input = { ...proof(legacy!.id), expectedAttempts: 3, expectedProviderRef: "only-original-legacy-reference" };
    const rows = await listMailDispatchRecovery.call({}, HUMAN);
    expect(rows.rows.find(row => row.deliveryId === legacy!.id)).toMatchObject({ legacy: true, originalRoute: null, dispatches: [] });
    await reconcileMailDispatch.call(input, HUMAN);
    expect(await db().select().from(mailDispatches)).toHaveLength(0);
    expect(await db().select().from(mailDispatchRequests)).toHaveLength(0);
    expect((await db().select().from(mailLegacyResolutions))[0]).toMatchObject({ deliveryId: legacy!.id, outcome: "not_submitted" });
    expect((await db().select().from(mailDeliveries))[0]?.providerRef).toBe("only-original-legacy-reference");
  });
  it("retains a late positive reply which contradicts an earlier human no-submission claim", async () => {
    let entered!: () => void, release!: () => void;
    const begun = new Promise<void>(resolve => { entered = resolve; });
    const held = new Promise<void>(resolve => { release = resolve; });
    smtp.send.mockImplementationOnce(async () => { entered(); await held; return { messageId: "actual-late-original-reference", accepted: ["fictional@example.test"], rejected: [], response: "250 queued original message" }; });
    const staged = await stage(), caller = deliverQueuedMail(staged.id);
    try {
      await begun;
      const [dispatch] = await db().select().from(mailDispatches).where(eq(mailDispatches.deliveryId, staged.id));
      await reconcileMailDispatch.call(proof(staged.id, dispatch!.id), HUMAN);
    } finally { release(); await caller; }
    const [result] = await db().select().from(mailDispatches).where(eq(mailDispatches.deliveryId, staged.id));
    expect(result?.state).toBe("unknown");
    expect(result).toHaveProperty("replyProviderRef", "actual-late-original-reference");
    expect(await db().select().from(mailOutbox)).toHaveLength(1);
    expect((await failure(retryReconciledMail.call({ deliveryId: staged.id, confirmation: "RETRY THE ORIGINAL MESSAGE" }, HUMAN))).code).toBe("conflict");
  });
  it("never relabels an existing positive adapter receipt as new human proof", async () => {
    smtp.send.mockResolvedValue({ messageId: "original-adapter-reference", accepted: ["fictional@example.test"], rejected: [], response: "250 queued" });
    const staged = await stage(); await deliverQueuedMail(staged.id);
    const [dispatch] = await db().select().from(mailDispatches).where(eq(mailDispatches.deliveryId, staged.id));
    const result = await reconcileMailDispatch.call({ ...proof(staged.id, dispatch!.id), outcome: "submitted", expectedProviderRef: "original-adapter-reference" }, HUMAN);
    expect(result.source).toBe("adapter");
    expect((await db().select().from(mailDispatches))[0]?.resolutionSource).toBe("adapter");
    expect((await db().select().from(mailDispatches))[0]?.initialReviewDigest).toBeNull();
  });
});
