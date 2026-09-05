// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Database-backed mail routing, permissions, idempotency and suppression.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { resetMailForTests } from "@/adapters/mail";
import { users } from "@/core/auth/schema";
import { connectedAccounts, connectionCapabilities } from "@/core/connections/schema";
import { db } from "@/core/db";
import { resetEnvForTests } from "@/core/env";
import { startJobProducer } from "@/core/jobs";
import { ready } from "@/core/runtime";
import {
  mailDeliveries,
  mailOutbox,
  mailProviderEvents,
  mailSenders,
  mailSuppressions,
} from "@/core/mail/schema";
import {
  mailStatus,
  deliverQueuedMail,
  runMailSenderVerification,
  recordMailProviderEvent,
  registerMailSender,
  releaseMailSuppression,
  sendMail,
  setDefaultMailSender,
  updateMailSender,
  verifyMailSender,
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
  beforeAll(ready, 60_000);

  beforeEach(async () => {
    environment({ SESSION_SECRET: "mail-outbox-test-secret-material-32-bytes" });
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
    await truncateSpine();
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

  it("checks sender verification only after the settings transaction commits", async () => {
    environment({
      MAIL_BULK_ADAPTER: "resend",
      MAIL_BULK_FROM: "news@example.test",
      RESEND_API_KEY: "test-key",
      RESEND_WEBHOOK_SECRET: "whsec_test",
    });
    const [sender] = await db()
      .insert(mailSenders)
      .values({
        purpose: "bulk",
        provider: "resend",
        email: "news@example.test",
        verificationStatus: "pending",
        status: "active",
        createdBy: OWNER.userId,
      })
      .returning();
    const providerCall = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          data: [{ id: "domain-1", name: "example.test", status: "verified" }],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );

    const queued = await verifyMailSender.call({ id: sender!.id }, OWNER);
    expect(queued.verificationStatus).toBe("pending");
    expect(providerCall).not.toHaveBeenCalled();
    const requestId = (queued.verificationDetail as { requestId?: string }).requestId;
    expect(requestId).toMatch(/^[0-9a-f-]{36}$/);

    await expect(
      runMailSenderVerification(sender!.id, requestId!),
    ).resolves.toEqual({ applied: true });
    expect(providerCall).toHaveBeenCalledTimes(1);
    const [verified] = await db()
      .select()
      .from(mailSenders)
      .where(eq(mailSenders.id, sender!.id));
    expect(verified).toMatchObject({
      verificationStatus: "verified",
      verificationDetail: {
        id: "domain-1",
        domain: "example.test",
        providerStatus: "verified",
      },
      status: "active",
      lastError: null,
    });
    expect(verified!.lastVerifiedAt).toBeInstanceOf(Date);
  });

  it("queues stable send keys idempotently without exposing a message body", async () => {
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
      status: "queued",
      attempts: 0,
    });
    expect(JSON.stringify(rows[0])).not.toContain("private reset body");
    const [outbox] = await db().select().from(mailOutbox);
    expect(outbox?.encryptedMessage).not.toContain("private reset body");
    const queuedJobs = await (await startJobProducer())?.findJobs("core.deliverMail");
    const queuedJob = queuedJobs?.find(
      (job) => (job.data as { deliveryId?: string }).deliveryId === first.id,
    );
    expect(queuedJob?.data).toEqual({ deliveryId: first.id });
    expect(JSON.stringify(queuedJob?.data)).not.toContain("private reset body");

    await expect(deliverQueuedMail(first.id)).resolves.toEqual({ status: "failed" });
    expect(await db().select().from(mailOutbox)).toEqual([]);
    const [delivered] = await db().select().from(mailDeliveries);
    expect(delivered).toMatchObject({ status: "failed", attempts: 1 });
    expect(log).toHaveBeenCalled();
    log.mockRestore();
  });

  it("refuses to reroute a queued message after deployment mail settings change", async () => {
    const queued = await db().transaction((tx) =>
      sendMail(tx, {
        to: "person@example.test",
        subject: "Configuration boundary",
        text: "This was queued for the console only.",
      }),
    );
    environment({
      MAIL_ADAPTER: "smtp",
      SMTP_HOST: "smtp.example.test",
      MAIL_FROM: "hello@example.test",
    });

    await expect(deliverQueuedMail(queued.id)).resolves.toEqual({ status: "failed" });
    const [delivery] = await db()
      .select()
      .from(mailDeliveries)
      .where(eq(mailDeliveries.id, queued.id));
    expect(delivery).toMatchObject({
      provider: "console",
      status: "failed",
      attempts: 1,
      lastError: "The configured mail route changed after this message was queued.",
    });
    expect(await db().select().from(mailOutbox)).toEqual([]);
  });

  it("keeps ciphertext and queued status while a retryable provider failure recovers", async () => {
    environment({
      MAIL_BULK_ADAPTER: "resend",
      MAIL_BULK_FROM: "news@example.test",
      RESEND_API_KEY: "test-key",
      RESEND_WEBHOOK_SECRET: "whsec_test",
    });
    const [sender] = await db()
      .insert(mailSenders)
      .values({
        purpose: "bulk",
        provider: "resend",
        email: "news@example.test",
        verificationStatus: "verified",
        status: "active",
        isDefault: true,
        createdBy: OWNER.userId,
      })
      .returning();
    const providerCall = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValueOnce(new Error("temporary network failure"))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: "provider-message-1" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
    const queued = await db().transaction((tx) =>
      sendMail(
        tx,
        { to: "person@example.test", subject: "Campaign", text: "Body" },
        { purpose: "bulk", senderId: sender!.id },
      ),
    );

    await expect(deliverQueuedMail(queued.id)).rejects.toThrow(
      "mail provider could not be reached",
    );
    let [delivery] = await db()
      .select()
      .from(mailDeliveries)
      .where(eq(mailDeliveries.id, queued.id));
    expect(delivery).toMatchObject({ status: "queued", attempts: 1 });
    expect(await db().select().from(mailOutbox)).toHaveLength(1);

    await expect(deliverQueuedMail(queued.id)).resolves.toEqual({ status: "submitted" });
    [delivery] = await db()
      .select()
      .from(mailDeliveries)
      .where(eq(mailDeliveries.id, queued.id));
    expect(delivery).toMatchObject({
      status: "submitted",
      attempts: 2,
      providerRef: "provider-message-1",
      lastError: null,
    });
    expect(providerCall).toHaveBeenCalledTimes(2);
    expect(await db().select().from(mailOutbox)).toEqual([]);
  });

  it("refuses bulk mail without a verified default and refuses suppressed recipients before sending", async () => {
    await expect(
      db().transaction((tx) =>
        sendMail(
          tx,
          { to: "private-link@example.test", subject: "Private link", text: "secret" },
          { requireDelivery: true },
        ),
      ),
    ).rejects.toThrow("no delivering mail adapter");
    expect(await db().select().from(mailDeliveries)).toHaveLength(0);
    expect(await db().select().from(mailOutbox)).toHaveLength(0);

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
