// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C3.31: retention removes personal fields without reopening send/event receipts.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/core/db";
import { ready } from "@/core/runtime";
import { mailDeliveries, mailProviderEvents, mailSuppressions } from "@/core/mail/schema";
import { recordMailProviderEvent, sendMail } from "@/core/mail/service";
import { applyRetentionPolicies, listRetentionPolicies } from "@/core/retention/service";
import { retentionPolicies } from "@/core/retention/schema";
import { closeDb, hasDatabase, OWNER, truncateSpine } from "../helpers/spine";

const EMAIL = "retention-subject@example.test";
const PAST = new Date("2020-01-01T00:00:00Z");
describe.runIf(hasDatabase)("legacy mail-record retention (C3.31)", { timeout: 60_000 }, () => {
  beforeAll(ready, 60_000);
  beforeEach(truncateSpine);
  afterAll(closeDb);
  it("offers explicit retention policies for all three address-bearing stores", async () => {
    const result = await listRetentionPolicies.call({}, OWNER);
    expect(result.kinds.map(item => item.kind)).toEqual(expect.arrayContaining(["mail_deliveries", "mail_provider_events", "mail_suppressions"]));
  });
  it("removes old terminal personal fields while preserving send and webhook idempotency", async () => {
    const sendKey = `fixture-mail:${randomUUID()}`;
    const [oneOff] = await db().insert(mailDeliveries).values({ purpose: "transactional", provider: "console", recipient: EMAIL, subject: "Private source subject", status: "failed", requestedBy: "system", idempotencyKey: sendKey, attempts: 0, createdAt: PAST, updatedAt: PAST }).returning();
    const [delivery] = await db().insert(mailDeliveries).values({ purpose: "bulk", provider: "resend", recipient: EMAIL, subject: "Private source subject", status: "bounced", requestedBy: "system", providerRef: "fixture-provider-reference", attempts: 1, providerStatusAt: PAST, createdAt: PAST, updatedAt: PAST }).returning();
    const eventInput = { provider: "resend" as const, externalEventId: `fixture-event:${randomUUID()}`, providerRef: "fixture-provider-reference", recipient: EMAIL, eventType: "hard_bounce" as const, detail: "Private source detail", rawDigest: "a".repeat(64), occurredAt: PAST.toISOString() };
    const [event] = await db().insert(mailProviderEvents).values({ ...eventInput, deliveryId: delivery!.id, occurredAt: PAST, createdAt: PAST }).returning();
    await db().insert(mailSuppressions).values({ email: EMAIL, reason: "hard_bounce", provider: "resend", sourceEventId: event!.id, detail: "Private source detail", active: false, releasedAt: PAST, createdAt: PAST, updatedAt: PAST });
    await db().insert(retentionPolicies).values(["mail_deliveries", "mail_provider_events", "mail_suppressions"].map(kind => ({ kind, ttlDays: 1 })));
    await applyRetentionPolicies();
    const current = { deliveries: await db().select().from(mailDeliveries), events: await db().select().from(mailProviderEvents), suppressions: await db().select().from(mailSuppressions) };
    expect(JSON.stringify(current)).not.toContain(EMAIL);
    expect(JSON.stringify(current)).not.toContain("Private source");
    const replay = await db().transaction(tx => sendMail(tx, { to: EMAIL, subject: "Retry", text: "Synthetic retry" }, { idempotencyKey: sendKey }));
    expect(replay).toMatchObject({ id: oneOff!.id, duplicate: true });
    expect(await recordMailProviderEvent.call(eventInput, { kind: "system" })).toEqual({ duplicate: true });
    expect((await db().select().from(mailSuppressions)).some(row => row.active)).toBe(false);
  });
  it("keeps active suppressions and unresolved queued/submitted records off the retention clock", async () => {
    await db().insert(mailDeliveries).values(["queued", "submitted"].map(status => ({ purpose: "transactional" as const, provider: "smtp" as const, recipient: EMAIL, subject: "Still owed", status: status as "queued" | "submitted", requestedBy: "system", attempts: 1, createdAt: PAST, updatedAt: PAST })));
    await db().insert(mailSuppressions).values({ email: EMAIL, reason: "manual", provider: "manual", active: true, createdAt: PAST, updatedAt: PAST });
    await db().insert(retentionPolicies).values(["mail_deliveries", "mail_suppressions"].map(kind => ({ kind, ttlDays: 1 })));
    await applyRetentionPolicies();
    expect((await db().select().from(mailDeliveries)).map(row => row.recipient)).toEqual([EMAIL, EMAIL]);
    expect((await db().select().from(mailSuppressions))[0]).toMatchObject({ email: EMAIL, active: true });
  });
});
