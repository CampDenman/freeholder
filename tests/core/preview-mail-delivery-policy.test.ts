// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C3.36: physical delivery rechecks the current private-preview boundary.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { resetMailForTests } from "@/adapters/mail";
import { setParadiseFetchForTests } from "@/adapters/paradise/http";
import { eq } from "drizzle-orm";
import { mailDeliveries, mailOutbox, mailSenders } from "@/core/mail/schema";
import { db } from "@/core/db";
import { resetEnvForTests } from "@/core/env";
import { startJobProducer, stopJobs } from "@/core/jobs";
import { deliverQueuedMail, sendMail } from "@/core/mail/service";
import { ready } from "@/core/runtime";
import { closeDb, hasDatabase, truncateSpine } from "../helpers/spine";

const PREVIEW_KEY = "fictional-preview-key-with-32-or-more-characters";
const saved = new Map<string, string | undefined>();
function environment(values: Record<string, string | undefined>) {
  for (const [key, value] of Object.entries(values)) {
    if (!saved.has(key)) saved.set(key, process.env[key]);
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
  resetEnvForTests();
  resetMailForTests();
}

describe.runIf(hasDatabase)("preview policy at physical delivery (C3.36)", () => {
  beforeAll(ready, 60_000);
  beforeEach(async () => {
    environment({
      APP_URL: "https://preview.example.test",
      FREEHOLDER_PREVIEW_KEY: PREVIEW_KEY,
      FREEHOLDER_PREVIEW_MAIL_ALLOW: "reader@example.test",
      FREEHOLDER_PREVIEW_MAIL_DAILY_CAP: "1",
      MAIL_ADAPTER: "paradise",
      MAIL_FROM: "owner@example.test",
      PARADISEMODERN_API_KEY: "fictional-preview-provider-key",
      PARADISEMODERN_URL: "https://preview-carrier.example.test",
    });
    await truncateSpine();
    await startJobProducer();
  });
  afterEach(() => {
    for (const [key, value] of saved) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    saved.clear();
    resetEnvForTests();
    resetMailForTests();
    setParadiseFetchForTests(undefined);
  });
  afterAll(async () => { await stopJobs(); await closeDb(); });

  it("durably holds mail queued to a stranger before the site became private", async () => {
    environment({ FREEHOLDER_PREVIEW_KEY: undefined });
    const staged = await db().transaction(tx => sendMail(tx, {
      to: "stranger@example.test",
      subject: "Fictional pre-preview message",
      text: "This recipient was never involved in the preview.",
    }, { idempotencyKey: "pre-preview-stranger", requireDelivery: true }));
    expect(staged.delivers).toBe(true);

    environment({ FREEHOLDER_PREVIEW_KEY: PREVIEW_KEY });
    let providerCalls = 0;
    setParadiseFetchForTests(async () => {
      providerCalls++;
      return new Response(JSON.stringify({ messageId: "forbidden-preview-send" }), { status: 200 });
    });
    await expect(deliverQueuedMail(staged.id)).resolves.toEqual({ status: "held" });
    expect(providerCalls).toBe(0);
    expect((await db().select().from(mailDeliveries).where(eq(mailDeliveries.id, staged.id)))[0]).toMatchObject({ status: "held", holdReason: "recipient", attempts: 0 });
    expect((await db().select().from(mailOutbox).where(eq(mailOutbox.deliveryId, staged.id)))).toHaveLength(1);
    await expect(deliverQueuedMail(staged.id)).resolves.toEqual({ status: "held" });
    expect(providerCalls).toBe(0);
  });

  it("holds a pre-preview console message instead of reporting a failed delivery", async () => {
    environment({ FREEHOLDER_PREVIEW_KEY: undefined, MAIL_ADAPTER: "console" });
    const staged = await db().transaction(tx => sendMail(tx, {
      to: "reader@example.test",
      subject: "Fictional non-delivering route",
      text: "This body remains available to the preview owner.",
    }, { idempotencyKey: "pre-preview-console" }));
    environment({ FREEHOLDER_PREVIEW_KEY: PREVIEW_KEY });
    await expect(deliverQueuedMail(staged.id)).resolves.toEqual({ status: "held" });
    expect((await db().select().from(mailDeliveries).where(eq(mailDeliveries.id, staged.id)))[0]).toMatchObject({ status: "held", holdReason: "no_adapter", attempts: 0 });
    expect((await db().select().from(mailOutbox).where(eq(mailOutbox.deliveryId, staged.id)))).toHaveLength(1);
  });

  it("refuses bulk work queued before the site became private", async () => {
    environment({
      FREEHOLDER_PREVIEW_KEY: undefined,
      MAIL_BULK_ADAPTER: "paradise",
      MAIL_BULK_FROM: "owner@example.test",
    });
    await db().insert(mailSenders).values({
      purpose: "bulk",
      provider: "paradise",
      email: "owner@example.test",
      verificationStatus: "verified",
      status: "active",
      isDefault: true,
    });
    const staged = await db().transaction(tx => sendMail(tx, {
      to: "stranger@example.test",
      subject: "Fictional pre-preview campaign",
      text: "Campaign mail cannot be sent by a private preview.",
    }, { idempotencyKey: "pre-preview-bulk", purpose: "bulk", requireDelivery: true }));
    environment({ FREEHOLDER_PREVIEW_KEY: PREVIEW_KEY });
    let providerCalls = 0;
    setParadiseFetchForTests(async () => {
      providerCalls++;
      return new Response(JSON.stringify({ messageId: "forbidden-bulk-send" }), { status: 200 });
    });
    await expect(deliverQueuedMail(staged.id)).resolves.toEqual({ status: "failed" });
    expect(providerCalls).toBe(0);
    expect((await db().select().from(mailDeliveries).where(eq(mailDeliveries.id, staged.id)))[0]).toMatchObject({ status: "failed", attempts: 0 });
  });
});
