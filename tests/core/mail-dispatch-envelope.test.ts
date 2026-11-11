// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C3.31/C11.08: preserve original private evidence when it cannot be dispatched.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
const smtp = vi.hoisted(() => ({ send: vi.fn() }));
vi.mock("nodemailer", () => ({ createTransport: () => ({ sendMail: smtp.send }) }));
import { resetMailForTests } from "@/adapters/mail";
import { db } from "@/core/db";
import { resetEnvForTests } from "@/core/env";
import { startJobProducer, stopJobs } from "@/core/jobs";
import { encryptMailOutbox } from "@/core/mail/outbox-crypto";
import { mailReceipts } from "@/core/mail/receipts";
import { mailDeliveries, mailDispatchRequests, mailDispatches, mailOutbox } from "@/core/mail/schema";
import { deliverQueuedMail, sendMail } from "@/core/mail/service";
import { ready } from "@/core/runtime";
import { historicalMailFixture } from "../helpers/mail-fixture";
import { closeDb, hasDatabase, truncateSpine } from "../helpers/spine";

const saved = new Map<string, string | undefined>();
const message = { to: "fictional@example.test", subject: "Original fictional receipt", text: "Original fictional body" };
describe.runIf(hasDatabase)("original private mail envelopes (C3.31/C11.08)", () => {
  beforeAll(ready, 60_000);
  beforeEach(async () => {
    for (const [name, value] of Object.entries({ SESSION_SECRET: "envelope-fixture-only-secret-material", MAIL_ADAPTER: "smtp", SMTP_HOST: "smtp.example.test", SMTP_PORT: "587", MAIL_FROM: "sender@example.test" })) { if (!saved.has(name)) saved.set(name, process.env[name]); process.env[name] = value; }
    resetEnvForTests(); resetMailForTests(); await truncateSpine(); await startJobProducer(); smtp.send.mockReset();
  });
  afterEach(() => { for (const [name, value] of saved) { if (value === undefined) delete process.env[name]; else process.env[name] = value; } saved.clear(); resetEnvForTests(); resetMailForTests(); vi.restoreAllMocks(); });
  afterAll(async () => { await stopJobs(); await closeDb(); });
  for (const malformed of [true, false]) it(malformed ? "retains unreadable original ciphertext for exact-backup recovery" : "refuses an authenticated different body without rebinding the original intent", async () => {
    const queued = await db().transaction(tx => sendMail(tx, message, { requireDelivery: true }));
    const original = (await db().select().from(mailDispatchRequests))[0]!;
    const cipher = malformed ? "v1.fixture-nonce.invalid-original-payload" : encryptMailOutbox(JSON.stringify({ ...message, text: "A different fictional body" }), queued.id);
    await db().transaction(async tx => { await mailReceipts(tx); await tx.update(mailOutbox).set({ encryptedMessage: cipher }).where(eq(mailOutbox.deliveryId, queued.id)); });
    await deliverQueuedMail(queued.id);
    expect(smtp.send).not.toHaveBeenCalled();
    expect((await db().select().from(mailOutbox))[0]?.encryptedMessage).toBe(cipher);
    expect((await db().select().from(mailDispatchRequests))[0]?.payloadDigest).toBe(original.payloadDigest);
    expect((await db().select().from(mailDeliveries))[0]?.attempts).toBe(0);
    expect(await db().select().from(mailDispatches)).toHaveLength(0);
  });
  it("keeps an older unclaimed body read-only without inventing its original route", async () => {
    const [legacy] = await historicalMailFixture(tx => tx.insert(mailDeliveries).values({ purpose: "transactional", provider: "smtp", recipient: message.to, subject: message.subject, requestedBy: "system" }).returning());
    const cipher = encryptMailOutbox(JSON.stringify(message), legacy!.id);
    await historicalMailFixture(tx => tx.insert(mailOutbox).values({ deliveryId: legacy!.id, encryptedMessage: cipher }));
    await deliverQueuedMail(legacy!.id);
    expect(smtp.send).not.toHaveBeenCalled();
    expect((await db().select().from(mailOutbox))[0]?.encryptedMessage).toBe(cipher);
    expect(await db().select().from(mailDispatchRequests)).toHaveLength(0);
    expect(await db().select().from(mailDispatches)).toHaveLength(0);
  });
});
