// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: AGPL-3.0-only
// Notification fanout, inbox ownership, preferences, digesting and escalation.
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { users } from "@/core/auth/schema";
import { contacts } from "@/core/contacts/schema";
import { createContact, mergeContacts, undoContactMerge } from "@/core/contacts/service";
import { db } from "@/core/db";
import {
  notificationDeliveries,
  notificationDigests,
  notificationPreferences,
  notificationReceipts,
  notificationSettings,
  notifications,
} from "@/core/notifications/schema";
import {
  archiveNotification,
  createNotification,
  deliverDueDigests,
  deliverDueNotifications,
  escalateUnreadNotifications,
  fanOutEventNotification,
  listNotifications,
  markNotificationRead,
  nextDigestAt,
  notificationPreferenceStatus,
  unreadNotificationCount,
  updateNotificationPreference,
  updateNotificationSettings,
} from "@/core/notifications/service";
import { createForm, submitForm } from "@/modules/forms/service";
import { issueStamp, STAMP_FIELD } from "@/modules/forms/antispam";
import { contactPrivacySources } from "@/core/privacy/service";
import { mailSuppressions } from "@/core/mail/schema";
import {
  closeDb,
  failure,
  hasDatabase,
  OWNER,
  STAFF,
  truncateSpine,
} from "../helpers/spine";

const SYSTEM = { kind: "system" } as const;

async function seedPeople() {
  await db().insert(users).values([
    { id: OWNER.userId, email: "owner@example.test", role: "owner" },
    { id: STAFF.userId, email: "staff@example.test", role: "staff" },
  ]);
}

function message(over: Record<string, unknown> = {}) {
  return {
    recipient: { kind: "user" as const, id: OWNER.userId },
    topic: "connections.attention",
    priority: "warning" as const,
    title: "A connection needs attention",
    body: "Reconnect the calendar.",
    href: "/admin",
    idempotencyKey: `test:${crypto.randomUUID()}`,
    ...over,
  };
}

describe("notification digest clock", () => {
  it("finds the next local daily and weekly delivery without using server time", () => {
    const now = new Date("2026-08-12T14:30:00.000Z"); // 07:30 Vancouver
    expect(nextDigestAt(now, {
      digestCadence: "daily",
      digestMinute: 8 * 60,
      digestWeekday: 1,
      timezone: "America/Vancouver",
      escalationMinutes: 60,
    }).toISOString()).toBe("2026-08-12T15:00:00.000Z");
    expect(nextDigestAt(now, {
      digestCadence: "weekly",
      digestMinute: 8 * 60,
      digestWeekday: 1,
      timezone: "America/Vancouver",
      escalationMinutes: 60,
    }).toISOString()).toBe("2026-08-17T15:00:00.000Z");
  });
});

describe.runIf(hasDatabase)("notifications", () => {
  beforeEach(async () => {
    await truncateSpine();
    await seedPeople();
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    await truncateSpine();
    await closeDb();
  });

  it("keeps creation system-only and every inbox personal", async () => {
    expect((await failure(createNotification.call(message(), OWNER))).code).toBe("permission");
    const created = await createNotification.call(message(), SYSTEM);
    expect(created.duplicate).toBe(false);

    expect(await unreadNotificationCount.call({}, OWNER)).toBe(1);
    expect(await unreadNotificationCount.call({}, STAFF)).toBe(0);
    const [item] = await listNotifications.call({}, OWNER);
    expect(item).toMatchObject({
      id: created.id,
      title: "A connection needs attention",
      occurrenceCount: 1,
      readAt: null,
    });
    expect(await listNotifications.call({}, STAFF)).toHaveLength(0);
    expect(
      (await failure(markNotificationRead.call({ id: created.id }, STAFF))).code,
    ).toBe("not_found");

    await markNotificationRead.call({ id: created.id }, OWNER);
    expect(await unreadNotificationCount.call({}, OWNER)).toBe(0);
    await archiveNotification.call({ id: created.id }, OWNER);
    expect(await listNotifications.call({}, OWNER)).toHaveLength(0);
  });

  it("records every replay key while coalescing a live condition", async () => {
    const first = await createNotification.call(message({
      idempotencyKey: "event:first",
      dedupeKey: "connection:calendar",
    }), SYSTEM);
    const second = await createNotification.call(message({
      idempotencyKey: "event:second",
      dedupeKey: "connection:calendar",
      body: "The calendar is still disconnected.",
    }), SYSTEM);
    const replay = await createNotification.call(message({
      idempotencyKey: "event:first",
      dedupeKey: "connection:calendar",
    }), SYSTEM);

    expect(second).toMatchObject({ id: first.id, coalesced: true });
    expect(replay).toMatchObject({ id: first.id, duplicate: true });
    const rows = await db().select().from(notifications);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ occurrenceCount: 2, body: "The calendar is still disconnected." });
    expect(await db().select().from(notificationReceipts)).toHaveLength(2);
    expect(await db().select().from(notificationDeliveries)).toHaveLength(2);
  });

  it("applies exact preferences and leaves unavailable carriers explicit", async () => {
    await updateNotificationPreference.call({
      topic: "connections.attention",
      channel: "email",
      mode: "digest",
    }, OWNER);
    await updateNotificationPreference.call({
      topic: "connections.attention",
      channel: "in_app",
      mode: "off",
    }, OWNER);
    expect(
      (await failure(updateNotificationPreference.call({
        topic: "connections.attention",
        channel: "sms",
        mode: "digest",
      }, OWNER))).code,
    ).toBe("validation");

    const created = await createNotification.call(message(), SYSTEM);
    expect(await unreadNotificationCount.call({}, OWNER)).toBe(0);
    const deliveries = await db().select().from(notificationDeliveries)
      .where(eq(notificationDeliveries.notificationId, created.id));
    expect(deliveries).toMatchObject([
      { channel: "email", kind: "digest", status: "deferred" },
    ]);
    const status = await notificationPreferenceStatus.call({}, OWNER);
    expect(status.email).toMatchObject({ provider: "console", ready: false });
    expect(status.adapters).toEqual(expect.arrayContaining([
      expect.objectContaining({ channel: "sms", available: false }),
      expect.objectContaining({ channel: "push", available: false }),
    ]));
  });

  it("delivers immediate email once and records a non-delivering console sink as skipped", async () => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    const created = await createNotification.call(message(), SYSTEM);
    expect((await deliverDueNotifications()).attempted).toBe(1);
    expect((await deliverDueNotifications()).attempted).toBe(0);
    const rows = await db().select().from(notificationDeliveries)
      .where(eq(notificationDeliveries.notificationId, created.id));
    expect(rows).toEqual(expect.arrayContaining([
      expect.objectContaining({ channel: "in_app", status: "delivered", provider: "core" }),
      expect.objectContaining({ channel: "email", status: "skipped", provider: "console", attempts: 1 }),
    ]));
    expect(JSON.stringify(rows)).not.toContain("Reconnect the calendar");
  });

  it("batches due digest rows into one durable digest", async () => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    await updateNotificationPreference.call({
      topic: "connections.attention",
      channel: "email",
      mode: "digest",
    }, OWNER);
    const first = await createNotification.call(message({ idempotencyKey: "digest:first" }), SYSTEM);
    const second = await createNotification.call(message({ idempotencyKey: "digest:second" }), SYSTEM);
    await db().update(notificationDeliveries).set({ availableAt: new Date(0) }).where(
      eq(notificationDeliveries.kind, "digest"),
    );

    expect((await deliverDueDigests()).digests).toBe(1);
    expect((await deliverDueDigests()).digests).toBe(0);
    const [digest] = await db().select().from(notificationDigests);
    expect(digest).toMatchObject({ itemCount: 2, status: "skipped", provider: "console" });
    const rows = await db().select().from(notificationDeliveries).where(
      sql`${notificationDeliveries.notificationId} in (${first.id}, ${second.id}) and ${notificationDeliveries.kind} = 'digest'`,
    );
    expect(rows).toHaveLength(2);
    expect(rows.every((row) => row.digestId === digest!.id && row.status === "skipped")).toBe(true);
  });

  it("reclaims a digest claim abandoned by a worker", async () => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    await updateNotificationPreference.call({
      topic: "connections.attention",
      channel: "email",
      mode: "digest",
    }, OWNER);
    const created = await createNotification.call(message({
      idempotencyKey: "digest:abandoned",
    }), SYSTEM);
    await db().update(notificationDeliveries).set({
      status: "processing",
      updatedAt: new Date(Date.now() - 11 * 60_000),
    }).where(and(
      eq(notificationDeliveries.notificationId, created.id),
      eq(notificationDeliveries.kind, "digest"),
    ));
    expect((await deliverDueDigests()).digests).toBe(1);
    const [row] = await db().select().from(notificationDeliveries).where(and(
      eq(notificationDeliveries.notificationId, created.id),
      eq(notificationDeliveries.kind, "digest"),
    ));
    expect(row).toMatchObject({ status: "skipped", attempts: 1 });
  });

  it("stops retrying a digest after its eighth failed provider attempt", async () => {
    await updateNotificationPreference.call({
      topic: "connections.attention",
      channel: "email",
      mode: "digest",
    }, OWNER);
    const created = await createNotification.call(message({
      idempotencyKey: "digest:terminal-failure",
    }), SYSTEM);
    await db().insert(mailSuppressions).values({
      email: "owner@example.test",
      reason: "manual",
      provider: "manual",
    });
    await db().update(notificationDeliveries).set({
      attempts: 7,
      availableAt: new Date(0),
    }).where(and(
      eq(notificationDeliveries.notificationId, created.id),
      eq(notificationDeliveries.kind, "digest"),
    ));
    expect((await deliverDueDigests()).digests).toBe(0);
    const [row] = await db().select().from(notificationDeliveries).where(and(
      eq(notificationDeliveries.notificationId, created.id),
      eq(notificationDeliveries.kind, "digest"),
    ));
    expect(row).toMatchObject({ status: "failed", attempts: 8 });
    expect((await deliverDueDigests()).digests).toBe(0);
  });

  it("escalates an unread critical condition once and stops after reading", async () => {
    const unread = await createNotification.call(message({
      priority: "critical",
      idempotencyKey: "critical:unread",
    }), SYSTEM);
    await db().update(notifications).set({ escalateAt: new Date(0) })
      .where(eq(notifications.id, unread.id));
    expect((await escalateUnreadNotifications()).escalated).toBe(1);
    expect((await escalateUnreadNotifications()).escalated).toBe(0);
    expect(
      await db().select().from(notificationDeliveries).where(
        eq(notificationDeliveries.notificationId, unread.id),
      ),
    ).toEqual(expect.arrayContaining([
      expect.objectContaining({ channel: "email", kind: "escalation", status: "pending" }),
    ]));

    const read = await createNotification.call(message({
      priority: "critical",
      idempotencyKey: "critical:read",
    }), SYSTEM);
    await markNotificationRead.call({ id: read.id }, OWNER);
    await db().update(notifications).set({ escalateAt: new Date(0) })
      .where(eq(notifications.id, read.id));
    expect((await escalateUnreadNotifications()).escalated).toBe(0);
  });

  it("fans a supported event only to staff whose stored grants cover it", async () => {
    await fanOutEventNotification(
      "connection.needsAttention",
      { id: "calendar", status: "needs_reconnect" },
      "outbox-one",
    );
    await fanOutEventNotification(
      "connection.needsAttention",
      { id: "calendar", status: "needs_reconnect" },
      "outbox-one",
    );
    const rows = await db().select().from(notifications);
    // Owner's wildcard and legacy staff's stored view grant both qualify.
    expect(rows).toHaveLength(2);
    expect(rows.every((row) => row.occurrenceCount === 1)).toBe(true);
    expect(await db().select().from(notificationReceipts)).toHaveLength(2);
  });

  it("routes form notification lists through fanout and preserves reply-to", async () => {
    const form = await createForm.call({
      slug: "notification-form",
      name: "Project enquiry",
      notify: ["owner@example.test"],
      fields: [
        { key: "email", label: "Email", kind: "email", required: true },
        { key: "message", label: "Message", kind: "multiline", required: true },
      ],
    }, OWNER);
    await submitForm.call({
      slug: form.slug,
      values: {
        email: "person@example.test",
        message: "Can we talk next week?",
        [STAMP_FIELD]: issueStamp(new Date(Date.now() - 20_000)),
      },
      sourceUrl: "/contact",
    }, { kind: "anonymous" });

    const [notification] = await db().select().from(notifications);
    expect(notification).toMatchObject({
      recipientUserId: OWNER.userId,
      externalRecipient: null,
      topic: "forms.submission",
      title: "Project enquiry: a new submission",
      replyTo: "person@example.test",
      href: `/admin/forms/${form.id}`,
    });
    expect(notification?.body).toContain("Can we talk next week?");
    expect(await db().select().from(notificationDeliveries)).toEqual(expect.arrayContaining([
      expect.objectContaining({ channel: "in_app", status: "delivered" }),
      expect.objectContaining({ channel: "email", status: "pending" }),
    ]));
  });

  it("stores personal scheduling values and validates timezones", async () => {
    await updateNotificationSettings.call({
      digestCadence: "weekly",
      digestMinute: 510,
      digestWeekday: 5,
      timezone: "America/Vancouver",
      escalationMinutes: 30,
    }, OWNER);
    const status = await notificationPreferenceStatus.call({}, OWNER);
    expect(status.settings).toMatchObject({
      digestCadence: "weekly",
      digestMinute: 510,
      digestWeekday: 5,
      timezone: "America/Vancouver",
      escalationMinutes: 30,
    });
    expect((await failure(updateNotificationSettings.call({
      digestCadence: "daily",
      digestMinute: 480,
      digestWeekday: 1,
      timezone: "Not/AZone",
      escalationMinutes: 60,
    }, OWNER))).code).toBe("validation");
  });

  it("repoints contact-owned notification state through a reversible merge", async () => {
    const survivor = await createContact.call({ name: "Survivor" }, OWNER);
    const duplicate = await createContact.call({ name: "Duplicate" }, OWNER);
    const notice = await createNotification.call(message({
      recipient: { kind: "contact", id: duplicate.id },
      idempotencyKey: "contact-merge-notice",
    }), SYSTEM);
    await db().insert(notificationPreferences).values({
      contactId: duplicate.id,
      topic: "connections.attention",
      channel: "email",
      mode: "digest",
    });
    await db().insert(notificationSettings).values({ contactId: duplicate.id });

    const merged = await mergeContacts.call({
      survivingId: survivor.id,
      duplicateId: duplicate.id,
    }, OWNER);
    expect((await db().select().from(notifications).where(eq(notifications.id, notice.id)))[0])
      .toMatchObject({ recipientContactId: survivor.id });
    expect((await db().select().from(notificationPreferences))[0])
      .toMatchObject({ contactId: survivor.id });
    expect((await db().select().from(notificationSettings))[0])
      .toMatchObject({ contactId: survivor.id });

    await undoContactMerge.call({ operationId: merged.mergeOperationId }, OWNER);
    expect((await db().select().from(notifications).where(eq(notifications.id, notice.id)))[0])
      .toMatchObject({ recipientContactId: duplicate.id });
    expect((await db().select().from(notificationPreferences))[0])
      .toMatchObject({ contactId: duplicate.id });
    expect((await db().select().from(notificationSettings))[0])
      .toMatchObject({ contactId: duplicate.id });
    expect(await db().select().from(contacts)).toHaveLength(2);
  });

  it("exports and erases contact-owned notification data through the privacy registry", async () => {
    const contact = await createContact.call({
      name: "Privacy contact",
      email: "privacy@example.test",
    }, OWNER);
    await createNotification.call(message({
      recipient: { kind: "contact", id: contact.id },
      idempotencyKey: "contact-privacy-notice",
    }), SYSTEM);
    await db().insert(notificationPreferences).values({
      contactId: contact.id,
      topic: "connections.attention",
      channel: "email",
      mode: "digest",
    });
    await db().insert(notificationSettings).values({ contactId: contact.id });
    const source = contactPrivacySources().find((item) => item.scope === "contact.notifications");
    expect(source).toBeDefined();
    const exported = await db().transaction((tx) => source!.exportData(tx, contact.id)) as {
      notifications: Array<{ body: string }>;
      deliveries: unknown[];
      receipts: Array<{ idempotencyKey: string }>;
      preferences: Array<{ mode: string }>;
      settings: Array<{ contactId: string | null }>;
    };
    expect(exported.notifications[0]?.body).toBe("Reconnect the calendar.");
    expect(exported.deliveries.length).toBeGreaterThan(0);
    expect(exported.receipts[0]?.idempotencyKey).toBe("contact-privacy-notice");
    expect(exported.preferences[0]?.mode).toBe("digest");
    expect(exported.settings[0]?.contactId).toBe(contact.id);
    await db().transaction((tx) => source!.erase(tx, contact.id, { requestId: crypto.randomUUID() }));
    expect(await db().select().from(notifications)).toHaveLength(0);
    expect(await db().select().from(notificationDeliveries)).toHaveLength(0);
    expect(await db().select().from(notificationReceipts)).toHaveLength(0);
    expect(await db().select().from(notificationPreferences)).toHaveLength(0);
    expect(await db().select().from(notificationSettings)).toHaveLength(0);
  });
});
