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
import { mailDeliveries, mailOutbox } from "@/core/mail/schema";
import { deliverQueuedMail, sendMail } from "@/core/mail/service";
import { ready } from "@/core/runtime";
import { closeDb, hasDatabase, truncateSpine } from "../helpers/spine";

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

describe.runIf(hasDatabase)("physical mail dispatch recovery (C3.31/C11.08)", () => {
  beforeAll(ready, 60_000);
  beforeEach(async () => {
    environment({ SESSION_SECRET: "mail-dispatch-synthetic-secret-material-32-bytes", MAIL_ADAPTER: "smtp", SMTP_HOST: "original-smtp.example.test", SMTP_PORT: "587", SMTP_USER: "original-account", SMTP_PASSWORD: "fictional-password", MAIL_FROM: "sender@example.test" });
    await truncateSpine(); await startJobProducer(); smtp.send.mockReset(); smtp.routes.length = 0;
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
});
