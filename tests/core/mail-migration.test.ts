// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C1.14 migration: forward shape, N-1 compatibility and DB invariants.
import { readFileSync } from "node:fs";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { db } from "@/core/db";
import { mailDeliveries, mailOauthStates, mailSenders } from "@/core/mail/schema";
import {
  closeDb,
  hasDatabase,
  OWNER,
  truncateSpine,
} from "../helpers/spine";
import { users } from "@/core/auth/schema";
import { reviewMigration } from "../../scripts/schema-compat-gate.mjs";

const MIGRATION = "db/migrations/0031_lucky_maria_hill.sql";

describe("the C1.14 migration artifact", () => {
  const migration = readFileSync(MIGRATION, "utf8");

  it("creates the complete mail subsystem including provider occurrence time", () => {
    for (const table of [
      "mail_senders",
      "mail_oauth_states",
      "mail_deliveries",
      "mail_provider_events",
      "mail_suppressions",
    ]) {
      expect(migration).toContain(`CREATE TABLE "${table}"`);
    }
    expect(migration).toContain('"provider_status_at" timestamp with time zone');
    expect(migration).toContain('CREATE UNIQUE INDEX "mail_senders_default_idx"');
    expect(migration).toContain('CREATE UNIQUE INDEX "mail_deliveries_idempotency_idx"');
    expect(migration).toContain('CREATE UNIQUE INDEX "mail_provider_events_external_idx"');
  });

  it("is additive and readable by the previous release", () => {
    expect(reviewMigration(MIGRATION, migration)).toMatchObject({
      ok: true,
      breaking: [],
    });
  });

  it("contains no secret values or raw-payload column", () => {
    expect(migration).not.toMatch(/access_token|refresh_token|client_secret|api_key/i);
    expect(migration).not.toMatch(/raw_(?:body|payload)/i);
    expect(migration).toContain('"raw_digest" text NOT NULL');
  });
});

describe.runIf(hasDatabase)("the migrated mail constraints", () => {
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

  it("refuses invalid provider/purpose pairs and unsafe defaults", async () => {
    await expect(
      db().insert(mailSenders).values({
        purpose: "transactional",
        provider: "resend",
        email: "news@example.test",
        createdBy: OWNER.userId,
      }),
    ).rejects.toThrow();
    await expect(
      db().insert(mailSenders).values({
        purpose: "transactional",
        provider: "console",
        email: "owner@example.test",
        verificationStatus: "verified",
        status: "active",
        isDefault: true,
        createdBy: OWNER.userId,
      }),
    ).rejects.toThrow();
  });

  it("refuses unbounded or mixed-case addresses and invalid OAuth return paths", async () => {
    await expect(
      db().insert(mailDeliveries).values({
        purpose: "transactional",
        provider: "console",
        recipient: "Person@Example.Test",
        subject: "Subject",
        requestedBy: "system",
      }),
    ).rejects.toThrow();
    await expect(
      db().insert(mailOauthStates).values({
        tokenHash: "a".repeat(64),
        userId: OWNER.userId,
        provider: "google",
        returnTo: "https://attacker.example/collect",
        expiresAt: new Date(Date.now() + 60_000),
      }),
    ).rejects.toThrow();
  });

  it("has the expected constraints and indexes after forward migration", async () => {
    const rows = await db().execute<{ name: string }>(sql`
      select conname as name
      from pg_constraint
      where conrelid in (
        'mail_senders'::regclass,
        'mail_oauth_states'::regclass,
        'mail_deliveries'::regclass,
        'mail_provider_events'::regclass,
        'mail_suppressions'::regclass
      )
      union all
      select indexname as name
      from pg_indexes
      where schemaname = 'public' and tablename like 'mail_%'
    `);
    const names = rows.map((row) => row.name);
    for (const expected of [
      "mail_senders_default_ready",
      "mail_oauth_states_safe_return",
      "mail_deliveries_provider_purpose",
      "mail_provider_events_digest_format",
      "mail_suppressions_release_consistent",
      "mail_senders_default_idx",
      "mail_deliveries_idempotency_idx",
      "mail_provider_events_external_idx",
    ]) {
      expect(names).toContain(expected);
    }
  });
});
