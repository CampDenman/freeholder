// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C3.31/C11.08: a failed local apply must not discard an observed server reply.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
const smtp = vi.hoisted(() => ({ send: vi.fn() }));
vi.mock("nodemailer", () => ({ createTransport: () => ({ sendMail: smtp.send }) }));
import { resetMailForTests } from "@/adapters/mail";
import { users } from "@/core/auth/schema";
import { lockContactIdentity } from "@/core/contacts/identity-lock";
import { db } from "@/core/db";
import { resetEnvForTests } from "@/core/env";
import { startJobProducer, stopJobs } from "@/core/jobs";
import { mailDispatches, mailOutbox } from "@/core/mail/schema";
import { reconcileMailDispatch } from "@/core/mail/dispatch-services";
import { deliverQueuedMail, sendMail } from "@/core/mail/service";
import { ready } from "@/core/runtime";
import { closeDb, hasDatabase, OWNER, truncateSpine } from "../helpers/spine";

const saved = new Map<string, string | undefined>();
const HUMAN = { ...OWNER, security: { twoFactorRequired: false, twoFactorEnrolled: true, twoFactorVerified: true, stepUpValid: true } };
describe.runIf(hasDatabase)("observed physical mail outcome recovery (C3.31/C11.08)", () => {
  beforeAll(ready, 60_000);
  beforeEach(async () => {
    for (const [name, value] of Object.entries({ SESSION_SECRET: "outcome-fixture-only-secret-material", MAIL_ADAPTER: "smtp", SMTP_HOST: "smtp.example.test", SMTP_PORT: "587", MAIL_FROM: "sender@example.test" })) { if (!saved.has(name)) saved.set(name, process.env[name]); process.env[name] = value; }
    resetEnvForTests(); resetMailForTests(); await truncateSpine(); await db().insert(users).values({ id: OWNER.userId, email: "owner@example.test", role: "owner" }); await startJobProducer(); smtp.send.mockReset();
  });
  afterEach(() => { for (const [name, value] of saved) { if (value === undefined) delete process.env[name]; else process.env[name] = value; } saved.clear(); resetEnvForTests(); resetMailForTests(); vi.restoreAllMocks(); });
  afterAll(async () => { await stopJobs(); await closeDb(); });
  it("keeps a positive reply when an identity operation refuses its ordinary local apply", async () => {
    let entered!: () => void, releaseReply!: () => void, blocked!: () => void, releaseIdentity!: () => void;
    const sending = new Promise<void>(resolve => { entered = resolve; });
    const reply = new Promise<void>(resolve => { releaseReply = resolve; });
    const identityHeld = new Promise<void>(resolve => { blocked = resolve; });
    const identityDone = new Promise<void>(resolve => { releaseIdentity = resolve; });
    smtp.send.mockImplementationOnce(async () => { entered(); await reply; return { messageId: "observed-original-server-reference", accepted: ["fictional@example.test"], rejected: [], response: "250 original message accepted" }; });
    const queued = await db().transaction(tx => sendMail(tx, { to: "fictional@example.test", subject: "Fictional original receipt", text: "Fictional private body" }, { requireDelivery: true }));
    const caller = deliverQueuedMail(queued.id);
    await sending;
    const identity = db().transaction(async tx => { await lockContactIdentity(tx); blocked(); await identityDone; });
    try {
      await identityHeld; releaseReply(); await caller;
      releaseIdentity(); await identity;
      const [dispatch] = await db().select().from(mailDispatches).where(eq(mailDispatches.deliveryId, queued.id));
      expect(dispatch?.state).toBe("unknown");
      expect(dispatch?.replyProviderRef).toBe("observed-original-server-reference");
      expect(dispatch?.replyEvidenceDigest).toMatch(/^[a-f0-9]{64}$/);
      expect(await db().select().from(mailOutbox)).toHaveLength(1);
      await deliverQueuedMail(queued.id);
      expect(smtp.send).toHaveBeenCalledTimes(1);
      const evidence = { deliveryId: queued.id, dispatchId: dispatch!.id, expectedAttempts: 1, expectedRecipient: "fictional@example.test", expectedProviderRef: null, providerOperationRef: "observed-original-server-reference", originalRouteEvidence: "Fictional original server and account independently match the frozen route.", finalProviderEvidence: "Fictional final server log positively confirms the original accepted message.", stoppedCallerEvidence: "Fictional original caller has stopped and no provider operation remains running.", confirmation: "ORIGINAL PROVIDER OUTCOME VERIFIED" as const };
      await expect(reconcileMailDispatch.call({ ...evidence, outcome: "not_submitted" }, HUMAN)).rejects.toMatchObject({ code: "conflict" });
      expect(await reconcileMailDispatch.call({ ...evidence, outcome: "submitted" }, HUMAN)).toMatchObject({ outcome: "submitted", source: "human_provider_confirmation" });
      expect(await db().select().from(mailOutbox)).toHaveLength(0);
      expect(smtp.send).toHaveBeenCalledTimes(1);
    } finally { releaseReply(); releaseIdentity(); await identity; await caller; }
  });
});
