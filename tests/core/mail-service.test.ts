// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: AGPL-3.0-only
// Database-backed mail routing, permissions, idempotency and suppression.
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { resetMailForTests } from "@/adapters/mail";
import { users } from "@/core/auth/schema";
import { connectedAccounts, connectionCapabilities } from "@/core/connections/schema";
import { db } from "@/core/db";
import { resetEnvForTests } from "@/core/env";
import {
  mailDeliveries,
  mailProviderEvents,
  mailSenders,
  mailSuppressions,
} from "@/core/mail/schema";
import {
  mailStatus,
  recordMailProviderEvent,
  registerMailSender,
  releaseMailSuppression,
  sendMail,
  setDefaultMailSender,
  updateMailSender,
} from "@/core/mail/service";
import {
  closeDb,
  failure,
  hasDatabase,
  OWNER,
  STAFF,
  truncateSpine,
} from "../helpers/spine";

const changedEnvironment = new Map<string, string | undefined>();

function environment(values: Record<string, string | undefined>): void {
  for (const [name, value] of Object.entries(values)) {
    if (!changedEnvironment.has(name)) changedEnvironment.set(name, process.env[name]);
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  resetEnvForTests();
  resetMailForTests();
}

async function seedOwner(): Promise<void> {
  await db().insert(users).values({
    id: OWNER.userId,
    email: "owner@example.test",
    role: "owner",
  });
}

describe.runIf(hasDatabase)("mail services", () => {
  beforeEach(async () => {
    await truncateSpine();
    await seedOwner();
  });

  afterEach(() => {
    for (const [name, value] of changedEnvironment) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    changedEnvironment.clear();
    resetEnvForTests();
    resetMailForTests();
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    await closeDb();
  });

  it("requires mail grants and keeps provider-event recording system-only", async () => {
    expect((await failure(mailStatus.call({}, { ...STAFF, grants: [] }))).code).toBe(
      "permission",
    );
    await expect(
      mailStatus.call(
        {},
        { ...STAFF, grants: [{ module: "mail", access: "view" }] },
      ),
    ).resolves.toHaveProperty("configuration");

    const event = {
      provider: "resend" as const,
      externalEventId: "provider-event-permission",
      providerRef: "provider-message",
      recipient: "person@example.test",
      eventType: "delivered" as const,
      rawDigest: "a".repeat(64),
      occurredAt: "2026-08-12T16:00:00.000Z",
    };
    expect((await failure(recordMailProviderEvent.call(event, OWNER))).code).toBe(
      "permission",
    );
    await expect(
      recordMailProviderEvent.call(event, { kind: "system" }),
    ).resolves.toMatchObject({ duplicate: false });
  });

  it("registers only the exact configured SMTP address and makes the first ready sender default", async () => {
    environment({
      MAIL_ADAPTER: "smtp",
      SMTP_HOST: "smtp.example.test",
      MAIL_FROM: "Business <HELLO@Example.Test>",
    });
    const wrong = await failure(
      registerMailSender.call(
        {
          purpose: "transactional",
          provider: "smtp",
          email: "other@example.test",
        },
        OWNER,
      ),
    );
    expect(wrong.code).toBe("validation");
    expect(wrong.message).toContain("MAIL_FROM");

    const sender = await registerMailSender.call(
      {
        purpose: "transactional",
        provider: "smtp",
        email: "HELLO@example.test",
        displayName: "Business",
      },
      OWNER,
    );
    expect(sender).toMatchObject({
      email: "hello@example.test",
      provider: "smtp",
      purpose: "transactional",
      status: "active",
      verificationStatus: "verified",
      isDefault: true,
      verificationDetail: {
        transportConfigured: true,
        dnsOwnershipVerified: false,
      },
    });
  });

  it("serializes concurrent default switches and leaves exactly one ready default", async () => {
    environment({
      MAIL_BULK_ADAPTER: "resend",
      MAIL_BULK_FROM: "news@example.test",
      RESEND_API_KEY: "test-key",
      RESEND_WEBHOOK_SECRET: "whsec_test",
    });
    const ids = [crypto.randomUUID(), crypto.randomUUID()];
    await db().insert(mailSenders).values(
      ids.map((id, index) => ({
        id,
        purpose: "bulk" as const,
        provider: "resend" as const,
        email: `news${index}@example.test`,
        verificationStatus: "verified" as const,
        status: "active" as const,
        createdBy: OWNER.userId,
      })),
    );

    await Promise.all(
      ids.map((id) => setDefaultMailSender.call({ id }, OWNER)),
    );
    const defaults = await db()
      .select()
      .from(mailSenders)
      .where(eq(mailSenders.isDefault, true));
    expect(defaults).toHaveLength(1);
    expect(ids).toContain(defaults[0]!.id);

    await updateMailSender.call(
      { id: defaults[0]!.id, status: "paused" },
      OWNER,
    );
    expect(
      await db().select().from(mailSenders).where(eq(mailSenders.isDefault, true)),
    ).toHaveLength(0);
  });

  it("makes stable send keys idempotent without storing a message body", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const message = {
      to: "person@example.test",
      subject: "Password reset",
      text: "private reset body and token",
    };
    const first = await db().transaction((tx) =>
      sendMail(tx, message, { idempotencyKey: "reset:user:one" }),
    );
    const replay = await db().transaction((tx) =>
      sendMail(tx, message, { idempotencyKey: "reset:user:one" }),
    );
    expect(first).toMatchObject({ provider: "console", delivers: false, duplicate: false });
    expect(replay).toEqual({ ...first, duplicate: true });
    const rows = await db().select().from(mailDeliveries);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      recipient: "person@example.test",
      subject: "Password reset",
      status: "failed",
      attempts: 1,
    });
    expect(JSON.stringify(rows[0])).not.toContain("private reset body");
    log.mockRestore();
  });

  it("refuses bulk mail without a verified default and refuses suppressed recipients before sending", async () => {
    await expect(
      db().transaction((tx) =>
        sendMail(
          tx,
          { to: "person@example.test", subject: "Campaign", text: "Text" },
          { purpose: "bulk" },
        ),
      ),
    ).rejects.toThrow("default bulk sender");

    await db().insert(mailSuppressions).values({
      email: "person@example.test",
      reason: "manual",
      provider: "manual",
    });
    await expect(
      db().transaction((tx) =>
        sendMail(tx, {
          to: "PERSON@example.test",
          subject: "Receipt",
          text: "Text",
        }),
      ),
    ).rejects.toThrow("is suppressed");
    expect(await db().select().from(mailDeliveries)).toHaveLength(0);
  });

  it("refuses a verified bulk sender until authenticated feedback is configured", async () => {
    environment({
      MAIL_BULK_ADAPTER: "resend",
      MAIL_BULK_FROM: "news@example.test",
      RESEND_API_KEY: "test-key",
      RESEND_WEBHOOK_SECRET: undefined,
    });
    await db().insert(mailSenders).values({
      purpose: "bulk",
      provider: "resend",
      email: "news@example.test",
      verificationStatus: "verified",
      status: "active",
      isDefault: true,
      createdBy: OWNER.userId,
    });
    const providerCall = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(new Error("provider must not be called"));
    await expect(
      db().transaction((tx) =>
        sendMail(
          tx,
          { to: "person@example.test", subject: "Campaign", text: "Text" },
          { purpose: "bulk" },
        ),
      ),
    ).rejects.toThrow("authenticated delivery-feedback");
    expect(providerCall).not.toHaveBeenCalled();
    expect(await db().select().from(mailDeliveries)).toHaveLength(0);
  });

  it("records provider effects once and prevents late status regression", async () => {
    const deliveryId = crypto.randomUUID();
    await db().insert(mailDeliveries).values({
      id: deliveryId,
      purpose: "bulk",
      provider: "resend",
      recipient: "person@example.test",
      subject: "Campaign",
      status: "submitted",
      providerRef: "provider-message",
      requestedBy: "system",
      attempts: 1,
      submittedAt: new Date("2026-08-12T15:59:00.000Z"),
    });
    const delivered = {
      provider: "resend" as const,
      externalEventId: "event-delivered",
      providerRef: "provider-message",
      recipient: "person@example.test",
      eventType: "delivered" as const,
      detail: "Resend delivered",
      rawDigest: "b".repeat(64),
      occurredAt: "2026-08-12T16:00:00.000Z",
    };
    await recordMailProviderEvent.call(delivered, { kind: "system" });
    await expect(
      recordMailProviderEvent.call(delivered, { kind: "system" }),
    ).resolves.toEqual({ duplicate: true });
    expect(await db().select().from(mailProviderEvents)).toHaveLength(1);

    await recordMailProviderEvent.call(
      {
        ...delivered,
        externalEventId: "event-late-failure",
        eventType: "failed",
        occurredAt: "2026-08-12T15:58:00.000Z",
      },
      { kind: "system" },
    );
    let [delivery] = await db()
      .select()
      .from(mailDeliveries)
      .where(eq(mailDeliveries.id, deliveryId));
    expect(delivery).toMatchObject({
      status: "delivered",
      providerStatusAt: new Date("2026-08-12T16:00:00.000Z"),
    });

    await recordMailProviderEvent.call(
      {
        ...delivered,
        externalEventId: "event-complaint",
        eventType: "complaint",
        detail: "Resend complaint",
        occurredAt: "2026-08-12T16:02:00.000Z",
      },
      { kind: "system" },
    );
    [delivery] = await db()
      .select()
      .from(mailDeliveries)
      .where(eq(mailDeliveries.id, deliveryId));
    expect(delivery).toMatchObject({ status: "complained" });
    expect(
      await db()
        .select()
        .from(mailSuppressions)
        .where(eq(mailSuppressions.email, "person@example.test")),
    ).toMatchObject([
      { active: true, reason: "complaint", provider: "resend" },
    ]);

    await recordMailProviderEvent.call(
      {
        ...delivered,
        externalEventId: "event-even-later-delivered",
        occurredAt: "2026-08-12T16:03:00.000Z",
      },
      { kind: "system" },
    );
    [delivery] = await db()
      .select()
      .from(mailDeliveries)
      .where(eq(mailDeliveries.id, deliveryId));
    expect(delivery?.status).toBe("complained");
  });

  it("requires an exact typed address before releasing a suppression", async () => {
    await db().insert(mailSuppressions).values({
      email: "blocked@example.test",
      reason: "manual",
      provider: "manual",
    });
    expect(
      (
        await failure(
          releaseMailSuppression.call(
            { email: "blocked@example.test", confirmation: "other@example.test" },
            OWNER,
          ),
        )
      ).code,
    ).toBe("validation");
    await releaseMailSuppression.call(
      {
        email: "blocked@example.test",
        confirmation: "blocked@example.test",
      },
      OWNER,
    );
    const [row] = await db()
      .select()
      .from(mailSuppressions)
      .where(eq(mailSuppressions.email, "blocked@example.test"));
    expect(row).toMatchObject({ active: false, releasedBy: OWNER.userId });
    expect(row?.releasedAt).toBeInstanceOf(Date);

    const releasedAt = row!.releasedAt!;
    const providerEvent = {
      provider: "resend" as const,
      providerRef: "message-after-release",
      recipient: "blocked@example.test",
      eventType: "hard_bounce" as const,
      rawDigest: "c".repeat(64),
    };
    await recordMailProviderEvent.call(
      {
        ...providerEvent,
        externalEventId: "late-event-before-release",
        occurredAt: new Date(releasedAt.getTime() - 1_000).toISOString(),
      },
      { kind: "system" },
    );
    let [suppression] = await db()
      .select()
      .from(mailSuppressions)
      .where(eq(mailSuppressions.email, "blocked@example.test"));
    expect(suppression).toMatchObject({ active: false, reason: "manual" });

    await recordMailProviderEvent.call(
      {
        ...providerEvent,
        externalEventId: "new-event-after-release",
        occurredAt: new Date(releasedAt.getTime() + 1_000).toISOString(),
      },
      { kind: "system" },
    );
    [suppression] = await db()
      .select()
      .from(mailSuppressions)
      .where(eq(mailSuppressions.email, "blocked@example.test"));
    expect(suppression).toMatchObject({
      active: true,
      reason: "hard_bounce",
      provider: "resend",
    });
  });

  it("reports connected sender health and never returns encrypted credentials", async () => {
    const accountId = crypto.randomUUID();
    await db().insert(connectedAccounts).values({
      id: accountId,
      userId: OWNER.userId,
      provider: "google",
      providerAccountId: "google-account",
      email: "owner@example.test",
      credentials: "encrypted-secret-value",
      status: "needs_reconnect",
    });
    await db().insert(connectionCapabilities).values({
      connectedAccountId: accountId,
      capability: "mail_send",
      enabled: true,
    });
    await db().insert(mailSenders).values({
      purpose: "transactional",
      provider: "gmail",
      connectedAccountId: accountId,
      email: "owner@example.test",
      verificationStatus: "verified",
      status: "active",
      isDefault: true,
      createdBy: OWNER.userId,
    });
    const status = await mailStatus.call({}, OWNER);
    expect(status.senders).toMatchObject([
      { accountStatus: "needs_reconnect", capabilityEnabled: true },
    ]);
    expect(JSON.stringify(status)).not.toContain("encrypted-secret-value");
    await expect(
      setDefaultMailSender.call({ id: status.senders[0]!.id }, OWNER),
    ).rejects.toThrow("Reconnect this mailbox");
  });
});
