// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C3.36: a physical send with a lost reply still consumes preview quota.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { resetMailForTests } from "@/adapters/mail";
import { setParadiseFetchForTests } from "@/adapters/paradise/http";
import { eq } from "drizzle-orm";
import { mailDeliveries } from "@/core/mail/schema";
import { db } from "@/core/db";
import { resetEnvForTests } from "@/core/env";
import { startJobProducer, stopJobs } from "@/core/jobs";
import { deliverQueuedMail, sendMail } from "@/core/mail/service";
import { ready } from "@/core/runtime";
import { closeDb, hasDatabase, truncateSpine } from "../helpers/spine";
const saved = new Map<string, string | undefined>();
describe.runIf(hasDatabase)("preview quota after unknown physical sends (C3.36)", () => {
  beforeAll(ready, 60_000);
  beforeEach(async () => {
    for (const [key, value] of Object.entries({ APP_URL: "https://preview.example.test", FREEHOLDER_PREVIEW_KEY: "fictional-preview-key-with-32-or-more-characters", FREEHOLDER_PREVIEW_MAIL_ALLOW: "reader@example.test", FREEHOLDER_PREVIEW_MAIL_DAILY_CAP: "1", MAIL_ADAPTER: "paradise", MAIL_FROM: "owner@example.test", PARADISEMODERN_API_KEY: "fictional-preview-provider-key", PARADISEMODERN_URL: "https://preview-carrier.example.test" })) { saved.set(key, process.env[key]); process.env[key] = value; }
    resetEnvForTests(); resetMailForTests(); await truncateSpine(); await startJobProducer();
  });
  afterEach(() => { for (const [key, value] of saved) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } saved.clear(); resetEnvForTests(); resetMailForTests(); setParadiseFetchForTests(undefined); });
  afterAll(async () => { await stopJobs(); await closeDb(); });
  it("holds the next preview message when the cap was consumed by a lost-ACK send", async () => {
    setParadiseFetchForTests(async () => { throw new Error("Fictional remote send may have accepted before reply was lost"); });
    const first = await db().transaction(tx => sendMail(tx, { to: "reader@example.test", subject: "Fictional first", text: "Fictional original preview message" }, { idempotencyKey: "preview-quota-first", requireDelivery: true }));
    expect(await deliverQueuedMail(first.id)).toEqual({ status: "unknown" });
    const next = await db().transaction(tx => sendMail(tx, { to: "reader@example.test", subject: "Fictional second", text: "Fictional next preview message" }, { idempotencyKey: "preview-quota-second", requireDelivery: true }));
    const [stored] = await db().select().from(mailDeliveries).where(eq(mailDeliveries.id, next.id));
    expect(stored?.status).toBe("held"); expect(stored?.holdReason).toBe("cap");
  });
});
