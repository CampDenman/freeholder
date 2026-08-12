// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: AGPL-3.0-only
// C1.15 migration: additive forward shape and database-enforced invariants.
import { readFileSync } from "node:fs";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { users } from "@/core/auth/schema";
import { db } from "@/core/db";
import {
  notificationDeliveries,
  notificationPreferences,
  notificationReceipts,
  notifications,
} from "@/core/notifications/schema";
import { reviewMigration } from "../../scripts/schema-compat-gate.mjs";
import { closeDb, hasDatabase, OWNER, truncateSpine } from "../helpers/spine";

const MIGRATIONS = [
  "db/migrations/0032_fancy_namora.sql",
  "db/migrations/0033_thin_lady_bullseye.sql",
] as const;

describe("the C1.15 migration artifacts", () => {
  const migrations = MIGRATIONS.map((path) => [path, readFileSync(path, "utf8")] as const);

  it("creates the notification, channel, preference, digest and receipt facts", () => {
    const all = migrations.map(([, migration]) => migration).join("\n");
    for (const table of [
      "notifications",
      "notification_deliveries",
      "notification_preferences",
      "notification_settings",
      "notification_digests",
      "notification_receipts",
    ]) {
      expect(all).toContain(`CREATE TABLE "${table}"`);
    }
    expect(all).toContain('CREATE UNIQUE INDEX "notification_deliveries_once_idx"');
    expect(all).toContain('CREATE INDEX "notifications_escalation_idx"');
  });

  it("is additive and readable by the previous release", () => {
    for (const [path, migration] of migrations) {
      expect(reviewMigration(path, migration)).toMatchObject({ ok: true, breaking: [] });
    }
  });

  it("stores bounded delivery evidence rather than secrets or provider payloads", () => {
    const all = migrations.map(([, migration]) => migration).join("\n");
    expect(all).not.toMatch(/access_token|refresh_token|client_secret|api_key|raw_(?:body|payload)/i);
    expect(all).not.toContain('"html"');
  });
});

describe.runIf(hasDatabase)("the migrated notification constraints", () => {
  beforeEach(async () => {
    await truncateSpine();
    await db().insert(users).values({
      id: OWNER.userId,
      email: "owner@example.test",
      role: "owner",
    });
  });

  afterAll(async () => {
    await truncateSpine();
    await closeDb();
  });

  it("requires one recipient and internal action links", async () => {
    await expect(db().insert(notifications).values({
      recipientUserId: OWNER.userId,
      externalRecipient: "owner@example.test",
      topic: "test.notice",
      title: "Test",
      body: "Body",
      idempotencyKey: "mixed-recipient",
    })).rejects.toThrow();
    await expect(db().insert(notifications).values({
      recipientUserId: OWNER.userId,
      topic: "test.notice",
      title: "Test",
      body: "Body",
      href: "https://attacker.example/collect",
      idempotencyKey: "external-link",
    })).rejects.toThrow();
  });

  it("refuses nonsensical digest preferences and inconsistent delivery rows", async () => {
    await expect(db().insert(notificationPreferences).values({
      userId: OWNER.userId,
      topic: "test.notice",
      channel: "sms",
      mode: "digest",
    })).rejects.toThrow();
    const [notification] = await db().insert(notifications).values({
      recipientUserId: OWNER.userId,
      topic: "test.notice",
      title: "Test",
      body: "Body",
      idempotencyKey: "delivery-test",
    }).returning();
    await expect(db().insert(notificationDeliveries).values({
      notificationId: notification!.id,
      channel: "email",
      kind: "digest",
      status: "pending",
    })).rejects.toThrow();
  });

  it("cascades personal notification state when its user is erased", async () => {
    const [notification] = await db().insert(notifications).values({
      recipientUserId: OWNER.userId,
      topic: "test.notice",
      title: "Test",
      body: "Body",
      idempotencyKey: "cascade-test",
    }).returning();
    await db().insert(notificationReceipts).values({
      idempotencyKey: "cascade-test",
      notificationId: notification!.id,
    });
    await db().insert(notificationDeliveries).values({
      notificationId: notification!.id,
      channel: "in_app",
      status: "delivered",
      provider: "core",
      deliveredAt: new Date(),
    });
    await db().delete(users).where(eq(users.id, OWNER.userId));
    expect(await db().select().from(notifications)).toHaveLength(0);
    expect(await db().select().from(notificationReceipts)).toHaveLength(0);
    expect(await db().select().from(notificationDeliveries)).toHaveLength(0);
  });

  it("has the expected constraints and indexes after forward migration", async () => {
    const rows = await db().execute<{ name: string }>(sql`
      select conname as name
      from pg_constraint
      where conrelid in (
        'notifications'::regclass,
        'notification_deliveries'::regclass,
        'notification_preferences'::regclass,
        'notification_settings'::regclass,
        'notification_digests'::regclass,
        'notification_receipts'::regclass
      )
      union all
      select indexname as name
      from pg_indexes
      where schemaname = 'public' and tablename like 'notification_%'
    `);
    const names = rows.map((row) => row.name);
    for (const expected of [
      "notifications_one_recipient",
      "notifications_href_internal",
      "notification_deliveries_digest_consistent",
      "notification_preferences_digest_email_only",
      "notification_settings_escalation_allowed",
      "notification_deliveries_once_idx",
      "notifications_escalation_idx",
      "notification_receipts_notification_idx",
    ]) {
      expect(names).toContain(expected);
    }
  });
});
