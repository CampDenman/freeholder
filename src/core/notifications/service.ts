// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Notification fanout, personal inbox, preferences and delivery machinery
// (MASTER.md §43 C1.15).
import { createHash } from "node:crypto";
import {
  and,
  asc,
  desc,
  eq,
  inArray,
  isNull,
  lt,
  lte,
  ne,
  or,
  sql,
} from "drizzle-orm";
import { z } from "zod";
import { notificationAdapterStatus, pushNotifications, smsNotifications } from "@/adapters/notifications";
import { users, roleGrants } from "@/core/auth/schema";
import { contacts } from "@/core/contacts/schema";
import { registerContactReference } from "@/core/contacts/service";
import { db } from "@/core/db";
import { env } from "@/core/env";
import { enqueueJob } from "@/core/jobs";
import { mailStatus, sendMail } from "@/core/mail/service";
import {
  notificationDeliveries,
  notificationDigests,
  notificationPreferences,
  notificationReceipts,
  notificationSettings,
  notifications,
} from "@/core/notifications/schema";
import { businessProfile } from "@/core/settings/schema";
import { registerContactPrivacySource } from "@/core/privacy/service";
import { translator } from "@/core/i18n";
import {
  localeForRecipient,
  localizeCustomerHref,
} from "@/core/i18n/customer";
import {
  defineService,
  ServiceError,
  type Actor,
  type Tx,
} from "@/core/service";

export const NOTIFICATION_TOPICS = [
  "forms.submission",
  "connections.attention",
  "agents.failed",
  "mail.delivery",
  "contribute.ingested",
  "contribute.status",
] as const;

export type NotificationTopic = (typeof NOTIFICATION_TOPICS)[number];
export type NotificationChannel = "in_app" | "email" | "sms" | "push";
export type NotificationMode = "immediate" | "digest" | "off";

const contactPointer = z.array(z.object({
  id: z.string().uuid(),
  contactId: z.string().uuid().nullable(),
}));

async function restoreContactPointers(
  tx: Tx,
  label: string,
  before: unknown,
  after: unknown,
  duplicateId: string,
  currentRows: (ids: string[]) => Promise<Array<{ id: string; contactId: string | null }>>,
  restoreRows: (ids: string[], duplicateId: string) => Promise<unknown>,
) {
  const expected = contactPointer.parse(after);
  const ids = expected.map((row) => row.id);
  const current = ids.length ? await currentRows(ids) : [];
  const expectedById = new Map(expected.map((row) => [row.id, row.contactId]));
  if (
    current.length !== expected.length ||
    current.some((row) => expectedById.get(row.id) !== row.contactId)
  ) {
    throw new ServiceError(
      "conflict",
      `${label} changed after this merge. Restore that record first or leave the merge in place.`,
    );
  }
  const moved = contactPointer.parse(before).filter((row) => row.contactId === duplicateId);
  if (moved.length === 0) return;
  await restoreRows(moved.map((row) => row.id), duplicateId);
}

registerContactReference({
  table: "notifications",
  repoint: (tx, duplicateId, survivingId) =>
    tx.update(notifications).set({ recipientContactId: survivingId })
      .where(eq(notifications.recipientContactId, duplicateId)),
  captureForUndo: async (tx, duplicateId, survivingId) => ({
    state: await tx.select({ id: notifications.id, contactId: notifications.recipientContactId })
      .from(notifications)
      .where(inArray(notifications.recipientContactId, [duplicateId, survivingId])),
    undoable: true,
  }),
  restoreAfterUndo: (tx, before, after, duplicateId) =>
    restoreContactPointers(
      tx,
      "Notifications",
      before,
      after,
      duplicateId,
      (ids) => tx.select({ id: notifications.id, contactId: notifications.recipientContactId })
        .from(notifications).where(inArray(notifications.id, ids)),
      (ids, id) => tx.update(notifications).set({ recipientContactId: id })
        .where(inArray(notifications.id, ids)),
    ),
});

registerContactReference({
  table: "notification_digests",
  repoint: (tx, duplicateId, survivingId) =>
    tx.update(notificationDigests).set({ recipientContactId: survivingId })
      .where(eq(notificationDigests.recipientContactId, duplicateId)),
  captureForUndo: async (tx, duplicateId, survivingId) => ({
    state: await tx.select({ id: notificationDigests.id, contactId: notificationDigests.recipientContactId })
      .from(notificationDigests)
      .where(inArray(notificationDigests.recipientContactId, [duplicateId, survivingId])),
    undoable: true,
  }),
  restoreAfterUndo: (tx, before, after, duplicateId) =>
    restoreContactPointers(
      tx,
      "Notification digests",
      before,
      after,
      duplicateId,
      (ids) => tx.select({ id: notificationDigests.id, contactId: notificationDigests.recipientContactId })
        .from(notificationDigests).where(inArray(notificationDigests.id, ids)),
      (ids, id) => tx.update(notificationDigests).set({ recipientContactId: id })
        .where(inArray(notificationDigests.id, ids)),
    ),
});

registerContactReference({
  table: "notification_preferences",
  repoint: async (tx, duplicateId, survivingId) => {
    const [duplicate, survivor] = await Promise.all([
      tx.select().from(notificationPreferences).where(eq(notificationPreferences.contactId, duplicateId)),
      tx.select().from(notificationPreferences).where(eq(notificationPreferences.contactId, survivingId)),
    ]);
    const survivorKeys = new Set(survivor.map((row) => `${row.topic}:${row.channel}`));
    const conflicts = duplicate.filter((row) => survivorKeys.has(`${row.topic}:${row.channel}`));
    if (conflicts.length > 0) {
      await tx.delete(notificationPreferences).where(
        inArray(notificationPreferences.id, conflicts.map((row) => row.id)),
      );
    }
    const remaining = duplicate.filter((row) => !survivorKeys.has(`${row.topic}:${row.channel}`));
    if (remaining.length > 0) {
      await tx.update(notificationPreferences).set({ contactId: survivingId })
        .where(inArray(notificationPreferences.id, remaining.map((row) => row.id)));
    }
  },
  captureForUndo: async (tx, duplicateId, survivingId) => {
    const rows = await tx.select({
      id: notificationPreferences.id,
      contactId: notificationPreferences.contactId,
      topic: notificationPreferences.topic,
      channel: notificationPreferences.channel,
    }).from(notificationPreferences)
      .where(inArray(notificationPreferences.contactId, [duplicateId, survivingId]));
    const duplicate = rows.filter((row) => row.contactId === duplicateId);
    const survivorKeys = new Set(rows.filter((row) => row.contactId === survivingId)
      .map((row) => `${row.topic}:${row.channel}`));
    const collision = duplicate.some((row) => survivorKeys.has(`${row.topic}:${row.channel}`));
    return {
      state: rows.map(({ id, contactId }) => ({ id, contactId })),
      undoable: !collision,
      blocker: collision
        ? "Both contacts had a preference for the same notification channel; the survivor's preference was kept."
        : undefined,
    };
  },
  restoreAfterUndo: (tx, before, after, duplicateId) =>
    restoreContactPointers(
      tx,
      "Notification preferences",
      before,
      after,
      duplicateId,
      (ids) => tx.select({ id: notificationPreferences.id, contactId: notificationPreferences.contactId })
        .from(notificationPreferences).where(inArray(notificationPreferences.id, ids)),
      (ids, id) => tx.update(notificationPreferences).set({ contactId: id })
        .where(inArray(notificationPreferences.id, ids)),
    ),
});

registerContactReference({
  table: "notification_settings",
  repoint: async (tx, duplicateId, survivingId) => {
    const rows = await tx.select({ id: notificationSettings.id, contactId: notificationSettings.contactId })
      .from(notificationSettings)
      .where(inArray(notificationSettings.contactId, [duplicateId, survivingId]));
    const duplicate = rows.find((row) => row.contactId === duplicateId);
    if (!duplicate) return;
    if (rows.some((row) => row.contactId === survivingId)) {
      await tx.delete(notificationSettings).where(eq(notificationSettings.id, duplicate.id));
    } else {
      await tx.update(notificationSettings).set({ contactId: survivingId })
        .where(eq(notificationSettings.id, duplicate.id));
    }
  },
  captureForUndo: async (tx, duplicateId, survivingId) => {
    const rows = await tx.select({ id: notificationSettings.id, contactId: notificationSettings.contactId })
      .from(notificationSettings)
      .where(inArray(notificationSettings.contactId, [duplicateId, survivingId]));
    const collision = rows.some((row) => row.contactId === duplicateId) &&
      rows.some((row) => row.contactId === survivingId);
    return {
      state: rows,
      undoable: !collision,
      blocker: collision
        ? "Both contacts had notification scheduling settings; the survivor's settings were kept."
        : undefined,
    };
  },
  restoreAfterUndo: (tx, before, after, duplicateId) =>
    restoreContactPointers(
      tx,
      "Notification settings",
      before,
      after,
      duplicateId,
      (ids) => tx.select({ id: notificationSettings.id, contactId: notificationSettings.contactId })
        .from(notificationSettings).where(inArray(notificationSettings.id, ids)),
      (ids, id) => tx.update(notificationSettings).set({ contactId: id })
        .where(inArray(notificationSettings.id, ids)),
    ),
});

registerContactPrivacySource({
  scope: "contact.notifications",
  tables: [
    "notifications",
    "notification_deliveries",
    "notification_receipts",
    "notification_preferences",
    "notification_settings",
    "notification_digests",
  ],
  exportData: async (tx, contactId) => {
    const noticeRows = await tx.select().from(notifications)
      .where(eq(notifications.recipientContactId, contactId));
    const ids = noticeRows.map((row) => row.id);
    return {
      notifications: noticeRows,
      deliveries: ids.length
        ? await tx.select().from(notificationDeliveries)
            .where(inArray(notificationDeliveries.notificationId, ids))
        : [],
      receipts: ids.length
        ? await tx.select().from(notificationReceipts)
            .where(inArray(notificationReceipts.notificationId, ids))
        : [],
      preferences: await tx.select().from(notificationPreferences)
        .where(eq(notificationPreferences.contactId, contactId)),
      settings: await tx.select().from(notificationSettings)
        .where(eq(notificationSettings.contactId, contactId)),
      digests: await tx.select().from(notificationDigests)
        .where(eq(notificationDigests.recipientContactId, contactId)),
    };
  },
  erase: async (tx, contactId) => {
    const digests = await tx.delete(notificationDigests)
      .where(eq(notificationDigests.recipientContactId, contactId))
      .returning({ id: notificationDigests.id });
    const preferences = await tx.delete(notificationPreferences)
      .where(eq(notificationPreferences.contactId, contactId))
      .returning({ id: notificationPreferences.id });
    const settings = await tx.delete(notificationSettings)
      .where(eq(notificationSettings.contactId, contactId))
      .returning({ id: notificationSettings.id });
    const noticeRows = await tx.delete(notifications)
      .where(eq(notifications.recipientContactId, contactId))
      .returning({ id: notifications.id });
    return { affected: digests.length + preferences.length + settings.length + noticeRows.length };
  },
});

const email = z.string().trim().toLowerCase().email().max(320);
const topic = z.string().trim().min(1).max(100).regex(/^(?:\*|[a-z][a-z0-9]*(?:[._-][a-z0-9]+)+)$/);
const recipient = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("user"), id: z.uuid() }),
  z.object({ kind: z.literal("contact"), id: z.uuid() }),
  z.object({ kind: z.literal("email"), address: email }),
]);

const notificationTitle = z.string().trim().min(1).max(240);
const notificationBody = z.string().trim().min(1).max(4000);
const messageParams = z.record(
  z.string(),
  z.union([z.string().max(4000), z.number().finite()]),
);

const createInput = z.object({
  recipient,
  topic,
  priority: z.enum(["information", "warning", "critical"]).default("information"),
  /** Literal owner/domain content, or a catalog key for platform boilerplate. */
  title: notificationTitle.optional(),
  titleKey: z.string().trim().min(1).max(200).optional(),
  body: notificationBody.optional(),
  bodyKey: z.string().trim().min(1).max(200).optional(),
  messageParams: messageParams.optional().default({}),
  href: z.string().trim().regex(/^\/(?!\/)/).max(1000).optional(),
  replyTo: email.optional(),
  sourceEventId: z.string().trim().min(1).max(200).optional(),
  sourceEventName: z.string().trim().min(1).max(100).optional(),
  idempotencyKey: z.string().trim().min(1).max(500),
  dedupeKey: z.string().trim().min(1).max(500).optional(),
  occurredAt: z.coerce.date().optional(),
}).superRefine((input, issue) => {
  if (Boolean(input.title) === Boolean(input.titleKey)) {
    issue.addIssue({
      code: "custom",
      path: ["title"],
      message: "Provide exactly one of title or titleKey.",
    });
  }
  if (Boolean(input.body) === Boolean(input.bodyKey)) {
    issue.addIssue({
      code: "custom",
      path: ["body"],
      message: "Provide exactly one of body or bodyKey.",
    });
  }
});

export type CreateNotificationInput = z.output<typeof createInput>;

function localizedMessage(input: CreateNotificationInput, locale: string) {
  const t = translator(locale);
  return {
    title: notificationTitle.parse(
      input.titleKey ? t(input.titleKey, input.messageParams) : input.title,
    ),
    body: notificationBody.parse(
      input.bodyKey ? t(input.bodyKey, input.messageParams) : input.body,
    ),
  };
}

function requirePerson(actor: Actor): asserts actor is Extract<Actor, { kind: "user" }> {
  if (actor.kind !== "user") {
    throw new ServiceError("permission", "A personal notification inbox requires a signed-in person.");
  }
}

function recipientCondition(userId: string) {
  return or(
    eq(notifications.recipientUserId, userId),
    inArray(
      notifications.recipientContactId,
      db().select({ id: contacts.id }).from(contacts).where(eq(contacts.userId, userId)),
    ),
  );
}

function inboxVisible() {
  return inArray(
    notifications.id,
    db()
      .select({ id: notificationDeliveries.notificationId })
      .from(notificationDeliveries)
      .where(eq(notificationDeliveries.channel, "in_app")),
  );
}

function recipientKey(input: CreateNotificationInput["recipient"]): string {
  return input.kind === "email" ? `email:${input.address}` : `${input.kind}:${input.id}`;
}

async function normalizeRecipient(tx: Tx, input: CreateNotificationInput["recipient"]) {
  if (input.kind !== "email") return input;
  const [staff] = await tx
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, input.address))
    .limit(1);
  return staff ? ({ kind: "user", id: staff.id } as const) : input;
}

async function fallbackTimezone(tx: Tx, input: CreateNotificationInput["recipient"]): Promise<string> {
  if (input.kind === "contact") {
    const [contact] = await tx
      .select({ timezone: contacts.timezone })
      .from(contacts)
      .where(eq(contacts.id, input.id))
      .limit(1);
    if (contact?.timezone) return contact.timezone;
  }
  const [business] = await tx
    .select({ timezone: businessProfile.timezone })
    .from(businessProfile)
    .limit(1);
  return business?.timezone ?? "UTC";
}

interface EffectiveSettings {
  digestCadence: "daily" | "weekly";
  digestMinute: number;
  digestWeekday: number;
  timezone: string;
  escalationMinutes: number;
}

async function effectiveSettings(
  tx: Tx,
  input: CreateNotificationInput["recipient"],
): Promise<EffectiveSettings> {
  if (input.kind === "email") {
    return {
      digestCadence: "daily",
      digestMinute: 480,
      digestWeekday: 1,
      timezone: await fallbackTimezone(tx, input),
      escalationMinutes: 60,
    };
  }
  const condition = input.kind === "user"
    ? eq(notificationSettings.userId, input.id)
    : eq(notificationSettings.contactId, input.id);
  const [stored] = await tx
    .select()
    .from(notificationSettings)
    .where(condition)
    .limit(1);
  return {
    digestCadence: stored?.digestCadence ?? "daily",
    digestMinute: stored?.digestMinute ?? 480,
    digestWeekday: stored?.digestWeekday ?? 1,
    timezone: stored?.timezone ?? (await fallbackTimezone(tx, input)),
    escalationMinutes: stored?.escalationMinutes ?? 60,
  };
}

function localDateParts(date: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";
  const weekdays: Record<string, number> = {
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
    Sun: 7,
  };
  return {
    year: Number(value("year")),
    month: Number(value("month")),
    day: Number(value("day")),
    hour: Number(value("hour")),
    minute: Number(value("minute")),
    weekday: weekdays[value("weekday")] ?? 1,
  };
}

/** Convert a local wall-clock time to UTC, correcting once across DST edges. */
function localToUtc(
  year: number,
  month: number,
  day: number,
  minute: number,
  timezone: string,
): Date {
  const nominal = Date.UTC(year, month - 1, day, Math.floor(minute / 60), minute % 60);
  let candidate = new Date(nominal);
  for (let pass = 0; pass < 2; pass += 1) {
    const seen = localDateParts(candidate, timezone);
    const seenNominal = Date.UTC(seen.year, seen.month - 1, seen.day, seen.hour, seen.minute);
    candidate = new Date(candidate.getTime() + nominal - seenNominal);
  }
  return candidate;
}

export function nextDigestAt(now: Date, settings: EffectiveSettings): Date {
  // Invalid owner-entered timezone data must degrade to UTC, never strand work.
  let timezone = settings.timezone;
  try {
    new Intl.DateTimeFormat("en", { timeZone: timezone }).format(now);
  } catch {
    timezone = "UTC";
  }
  const local = localDateParts(now, timezone);
  for (let add = 0; add <= 8; add += 1) {
    const day = new Date(Date.UTC(local.year, local.month - 1, local.day + add));
    const weekday = day.getUTCDay() === 0 ? 7 : day.getUTCDay();
    if (settings.digestCadence === "weekly" && weekday !== settings.digestWeekday) continue;
    const candidate = localToUtc(
      day.getUTCFullYear(),
      day.getUTCMonth() + 1,
      day.getUTCDate(),
      settings.digestMinute,
      timezone,
    );
    if (candidate.getTime() > now.getTime()) return candidate;
  }
  return new Date(now.getTime() + 24 * 60 * 60 * 1000);
}

async function effectiveModes(
  tx: Tx,
  input: CreateNotificationInput["recipient"],
  notificationTopic: string,
): Promise<Record<NotificationChannel, NotificationMode>> {
  const defaults: Record<NotificationChannel, NotificationMode> = {
    in_app: input.kind === "email" ? "off" : "immediate",
    email: "immediate",
    sms: "off",
    push: "off",
  };
  if (input.kind === "email") return defaults;
  const condition = input.kind === "user"
    ? eq(notificationPreferences.userId, input.id)
    : eq(notificationPreferences.contactId, input.id);
  const rows = await tx
    .select({
      topic: notificationPreferences.topic,
      channel: notificationPreferences.channel,
      mode: notificationPreferences.mode,
    })
    .from(notificationPreferences)
    .where(
      and(
        condition,
        inArray(notificationPreferences.topic, ["*", notificationTopic]),
      ),
    );
  for (const channel of Object.keys(defaults) as NotificationChannel[]) {
    const exact = rows.find((row) => row.channel === channel && row.topic === notificationTopic);
    const wildcard = rows.find((row) => row.channel === channel && row.topic === "*");
    defaults[channel] = exact?.mode ?? wildcard?.mode ?? defaults[channel];
  }
  return defaults;
}

async function findDedupeMatch(
  tx: Tx,
  input: CreateNotificationInput,
  normalized: CreateNotificationInput["recipient"],
) {
  if (!input.dedupeKey) return undefined;
  const identity = recipientKey(normalized);
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${`${identity}:${input.dedupeKey}`}, 0))`,
  );
  const condition = normalized.kind === "user"
    ? eq(notifications.recipientUserId, normalized.id)
    : normalized.kind === "contact"
      ? eq(notifications.recipientContactId, normalized.id)
      : eq(notifications.externalRecipient, normalized.address);
  const [row] = await tx
    .select({ id: notifications.id })
    .from(notifications)
    .where(
      and(
        condition,
        eq(notifications.dedupeKey, input.dedupeKey),
        isNull(notifications.archivedAt),
      ),
    )
    .orderBy(desc(notifications.lastOccurredAt))
    .limit(1);
  return row;
}

export async function createNotificationTx(
  tx: Tx,
  rawInput: CreateNotificationInput,
) {
  const input = createInput.parse(rawInput);
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${`notification-receipt:${input.idempotencyKey}`}, 0))`,
  );
  const [receipt] = await tx
    .select({ id: notifications.id })
    .from(notificationReceipts)
    .innerJoin(notifications, eq(notifications.id, notificationReceipts.notificationId))
    .where(eq(notificationReceipts.idempotencyKey, input.idempotencyKey))
    .limit(1);
  if (receipt) return { id: receipt.id, duplicate: true, coalesced: false } as const;

  const normalized = await normalizeRecipient(tx, input.recipient);
  const localePolicy = await localeForRecipient(tx, normalized);
  const message = localizedMessage(input, localePolicy.locale);
  const href = input.href
    ? localizeCustomerHref(input.href, localePolicy.locale, localePolicy)
    : undefined;
  const occurredAt = input.occurredAt ?? new Date();
  const match = await findDedupeMatch(tx, input, normalized);
  if (match) {
    const settings = await effectiveSettings(tx, normalized);
    const [updated] = await tx
      .update(notifications)
      .set({
        locale: localePolicy.locale,
        title: message.title,
        body: message.body,
        href,
        replyTo: input.replyTo,
        priority: input.priority,
        sourceEventId: input.sourceEventId,
        sourceEventName: input.sourceEventName,
        occurrenceCount: sql`${notifications.occurrenceCount} + 1`,
        lastOccurredAt: occurredAt,
        readAt: null,
        escalatedAt: null,
        escalateAt:
          input.priority === "critical"
            ? new Date(occurredAt.getTime() + settings.escalationMinutes * 60_000)
            : null,
        updatedAt: new Date(),
      })
      .where(eq(notifications.id, match.id))
      .returning({ id: notifications.id });
    await tx.insert(notificationReceipts).values({
      idempotencyKey: input.idempotencyKey,
      notificationId: updated!.id,
    });
    return { id: updated!.id, duplicate: false, coalesced: true } as const;
  }

  const settings = await effectiveSettings(tx, normalized);
  const [created] = await tx
    .insert(notifications)
    .values({
      recipientUserId: normalized.kind === "user" ? normalized.id : null,
      recipientContactId: normalized.kind === "contact" ? normalized.id : null,
      externalRecipient: normalized.kind === "email" ? normalized.address : null,
      topic: input.topic,
      priority: input.priority,
      locale: localePolicy.locale,
      title: message.title,
      body: message.body,
      href,
      replyTo: input.replyTo,
      sourceEventId: input.sourceEventId,
      sourceEventName: input.sourceEventName,
      idempotencyKey: input.idempotencyKey,
      dedupeKey: input.dedupeKey,
      firstOccurredAt: occurredAt,
      lastOccurredAt: occurredAt,
      escalateAt:
        input.priority === "critical"
          ? new Date(occurredAt.getTime() + settings.escalationMinutes * 60_000)
          : null,
    })
    .returning({ id: notifications.id });
  await tx.insert(notificationReceipts).values({
    idempotencyKey: input.idempotencyKey,
    notificationId: created!.id,
  });

  const modes = await effectiveModes(tx, normalized, input.topic);
  const rows = (Object.entries(modes) as Array<[NotificationChannel, NotificationMode]>)
    .filter(([, mode]) => mode !== "off")
    .map(([channel, mode]) => ({
      notificationId: created!.id,
      channel,
      kind: mode === "digest" ? ("digest" as const) : ("immediate" as const),
      status:
        channel === "in_app"
          ? ("delivered" as const)
          : mode === "digest"
            ? ("deferred" as const)
            : ("pending" as const),
      availableAt: mode === "digest" ? nextDigestAt(occurredAt, settings) : occurredAt,
      provider: channel === "in_app" ? "core" : null,
      deliveredAt: channel === "in_app" ? occurredAt : null,
    }));
  if (rows.length > 0) await tx.insert(notificationDeliveries).values(rows);
  if (rows.some((row) => row.status === "pending")) {
    await enqueueJob(tx, "core.deliverNotifications", {}, {
      idempotencyKey: `notification:${created!.id}`,
      idempotencyTtlSeconds: 7 * 24 * 60 * 60,
    });
  }
  return { id: created!.id, duplicate: false, coalesced: false } as const;
}

export const createNotification = defineService({
  name: "notifications.create",
  summary: "Create one deduplicated notification and its channel work.",
  kind: "mutation",
  permission: "scoped",
  agentCallable: false,
  input: createInput,
  handler: async (input, ctx) => {
    if (ctx.actor.kind !== "system") {
      throw new ServiceError("permission", "Only trusted platform work may create a notification.");
    }
    const result = await createNotificationTx(ctx.tx, input);
    ctx.setSubject("notification", result.id);
    return result;
  },
});

export const listNotifications = defineService({
  name: "notifications.list",
  summary: "List the signed-in person's notification inbox.",
  kind: "query",
  permission: "authenticated",
  input: z.object({
    state: z.enum(["all", "unread", "critical"]).default("all"),
    limit: z.number().int().min(1).max(100).default(50),
    before: z.coerce.date().optional(),
  }),
  handler: async (input, ctx) => {
    requirePerson(ctx.actor);
    const state = input.state === "unread"
      ? isNull(notifications.readAt)
      : input.state === "critical"
        ? eq(notifications.priority, "critical")
        : undefined;
    return ctx.tx
      .select({
        id: notifications.id,
        topic: notifications.topic,
        priority: notifications.priority,
        locale: notifications.locale,
        title: notifications.title,
        body: notifications.body,
        href: notifications.href,
        occurrenceCount: notifications.occurrenceCount,
        firstOccurredAt: notifications.firstOccurredAt,
        lastOccurredAt: notifications.lastOccurredAt,
        readAt: notifications.readAt,
        escalatedAt: notifications.escalatedAt,
      })
      .from(notifications)
      .where(
        and(
          recipientCondition(ctx.actor.userId),
          inboxVisible(),
          isNull(notifications.archivedAt),
          state,
          input.before ? lt(notifications.lastOccurredAt, input.before) : undefined,
        ),
      )
      .orderBy(
        sql`case ${notifications.priority} when 'critical' then 0 when 'warning' then 1 else 2 end`,
        sql`case when ${notifications.readAt} is null then 0 else 1 end`,
        desc(notifications.lastOccurredAt),
      )
      .limit(input.limit);
  },
});

export const unreadNotificationCount = defineService({
  name: "notifications.unreadCount",
  summary: "Count unread items in the signed-in person's inbox.",
  kind: "query",
  permission: "authenticated",
  input: z.object({}),
  handler: async (_input, ctx) => {
    requirePerson(ctx.actor);
    const [row] = await ctx.tx
      .select({ count: sql<number>`count(*)::int` })
      .from(notifications)
      .where(
        and(
          recipientCondition(ctx.actor.userId),
          inboxVisible(),
          isNull(notifications.readAt),
          isNull(notifications.archivedAt),
        ),
      );
    return row?.count ?? 0;
  },
});

async function ownedNotification(tx: Tx, userId: string, id: string) {
  const [row] = await tx
    .select({ id: notifications.id })
    .from(notifications)
    .where(and(eq(notifications.id, id), recipientCondition(userId), inboxVisible()))
    .limit(1);
  if (!row) throw new ServiceError("not_found", "That notification is not in your inbox.");
  return row;
}

export const markNotificationRead = defineService({
  name: "notifications.markRead",
  summary: "Mark one personal notification read or unread.",
  kind: "mutation",
  permission: "authenticated",
  input: z.object({ id: z.uuid(), read: z.boolean().default(true) }),
  handler: async (input, ctx) => {
    requirePerson(ctx.actor);
    await ownedNotification(ctx.tx, ctx.actor.userId, input.id);
    const [row] = await ctx.tx
      .update(notifications)
      .set({ readAt: input.read ? new Date() : null, updatedAt: new Date() })
      .where(eq(notifications.id, input.id))
      .returning({ id: notifications.id, readAt: notifications.readAt });
    ctx.setSubject("notification", input.id);
    return row!;
  },
});

export const archiveNotification = defineService({
  name: "notifications.archive",
  summary: "Archive one personal notification.",
  kind: "mutation",
  permission: "authenticated",
  input: z.object({ id: z.uuid() }),
  handler: async (input, ctx) => {
    requirePerson(ctx.actor);
    await ownedNotification(ctx.tx, ctx.actor.userId, input.id);
    await ctx.tx
      .update(notifications)
      .set({ archivedAt: new Date(), readAt: new Date(), updatedAt: new Date() })
      .where(eq(notifications.id, input.id));
    ctx.setSubject("notification", input.id);
    return { archived: true } as const;
  },
});

export const markAllNotificationsRead = defineService({
  name: "notifications.markAllRead",
  summary: "Mark every visible personal notification read.",
  kind: "mutation",
  permission: "authenticated",
  input: z.object({}),
  handler: async (_input, ctx) => {
    requirePerson(ctx.actor);
    const rows = await ctx.tx
      .update(notifications)
      .set({ readAt: new Date(), updatedAt: new Date() })
      .where(
        and(
          recipientCondition(ctx.actor.userId),
          inboxVisible(),
          isNull(notifications.readAt),
          isNull(notifications.archivedAt),
        ),
      )
      .returning({ id: notifications.id });
    ctx.setSubject("notification_inbox", ctx.actor.userId);
    return { changed: rows.length };
  },
});

export const notificationPreferenceStatus = defineService({
  name: "notifications.preferences",
  summary: "Personal notification preferences, digest schedule, and adapter readiness.",
  kind: "query",
  permission: "authenticated",
  input: z.object({}),
  handler: async (_input, ctx) => {
    requirePerson(ctx.actor);
    const [preferences, settings, business, mail] = await Promise.all([
      ctx.tx
        .select({
          topic: notificationPreferences.topic,
          channel: notificationPreferences.channel,
          mode: notificationPreferences.mode,
        })
        .from(notificationPreferences)
        .where(eq(notificationPreferences.userId, ctx.actor.userId)),
      ctx.tx
        .select()
        .from(notificationSettings)
        .where(eq(notificationSettings.userId, ctx.actor.userId))
        .limit(1),
      ctx.tx
        .select({ timezone: businessProfile.timezone })
        .from(businessProfile)
        .limit(1),
      ctx.callAsSystem(mailStatus, { limit: 1 }),
    ]);
    const emailReady =
      mail.configuration.transactional.delivers ||
      mail.senders.some((sender) =>
        sender.purpose === "transactional" &&
        sender.isDefault &&
        sender.status === "active" &&
        sender.verificationStatus === "verified" &&
        sender.provider !== "console" &&
        sender.accountStatus !== "needs_reconnect" &&
        sender.accountStatus !== "revoked" &&
        sender.capabilityEnabled !== false,
      );
    return {
      topics: NOTIFICATION_TOPICS,
      preferences,
      settings: settings[0] ?? {
        digestCadence: "daily" as const,
        digestMinute: 480,
        digestWeekday: 1,
        timezone: business[0]?.timezone ?? "UTC",
        escalationMinutes: 60,
      },
      email: {
        provider: mail.configuration.transactional.provider,
        ready: emailReady,
      },
      adapters: notificationAdapterStatus(),
    };
  },
});

export const updateNotificationPreference = defineService({
  name: "notifications.updatePreference",
  summary: "Set one personal topic and channel preference.",
  kind: "mutation",
  permission: "authenticated",
  input: z.object({
    topic,
    channel: z.enum(["in_app", "email", "sms", "push"]),
    mode: z.enum(["immediate", "digest", "off"]),
  }).superRefine((input, issue) => {
    if (input.channel === "in_app" && input.mode === "digest") {
      issue.addIssue({ code: "custom", message: "In-app notifications are immediate or off.", path: ["mode"] });
    }
    if (input.mode === "digest" && input.channel !== "email") {
      issue.addIssue({ code: "custom", message: "Only email can be delivered as a digest.", path: ["mode"] });
    }
  }),
  handler: async (input, ctx) => {
    requirePerson(ctx.actor);
    const [row] = await ctx.tx
      .insert(notificationPreferences)
      .values({ userId: ctx.actor.userId, ...input })
      .onConflictDoUpdate({
        target: [
          notificationPreferences.userId,
          notificationPreferences.topic,
          notificationPreferences.channel,
        ],
        targetWhere: sql`${notificationPreferences.userId} is not null`,
        set: { mode: input.mode, updatedAt: new Date() },
      })
      .returning();
    ctx.setSubject("notification_preference", row!.id);
    return row!;
  },
});

export const updateNotificationPreferences = defineService({
  name: "notifications.updatePreferences",
  summary: "Replace a set of personal topic and channel preferences.",
  kind: "mutation",
  permission: "authenticated",
  input: z.object({
    preferences: z.array(z.object({
      topic,
      channel: z.enum(["in_app", "email", "sms", "push"]),
      mode: z.enum(["immediate", "digest", "off"]),
    })).min(1).max(100),
  }),
  handler: async (input, ctx) => {
    requirePerson(ctx.actor);
    const seen = new Set<string>();
    for (const preference of input.preferences) {
      const key = `${preference.topic}:${preference.channel}`;
      if (seen.has(key)) {
        throw new ServiceError("validation", `Preference ${key} was supplied twice.`);
      }
      seen.add(key);
      if (preference.channel === "in_app" && preference.mode === "digest") {
        throw new ServiceError("validation", "In-app notifications are immediate or off.");
      }
      if (preference.mode === "digest" && preference.channel !== "email") {
        throw new ServiceError("validation", "Only email can be delivered as a digest.");
      }
      await ctx.tx
        .insert(notificationPreferences)
        .values({ userId: ctx.actor.userId, ...preference })
        .onConflictDoUpdate({
          target: [
            notificationPreferences.userId,
            notificationPreferences.topic,
            notificationPreferences.channel,
          ],
          targetWhere: sql`${notificationPreferences.userId} is not null`,
          set: { mode: preference.mode, updatedAt: new Date() },
        });
    }
    ctx.setSubject("notification_preferences", ctx.actor.userId);
    return { saved: input.preferences.length };
  },
});

export const updateNotificationSettings = defineService({
  name: "notifications.updateSettings",
  summary: "Set the personal digest clock and unread escalation delay.",
  kind: "mutation",
  permission: "authenticated",
  input: z.object({
    digestCadence: z.enum(["daily", "weekly"]),
    digestMinute: z.number().int().min(0).max(1439),
    digestWeekday: z.number().int().min(1).max(7),
    timezone: z.string().trim().min(1).max(100),
    escalationMinutes: z.number().int().min(5).max(10080),
  }).superRefine((input, issue) => {
    try {
      new Intl.DateTimeFormat("en", { timeZone: input.timezone });
    } catch {
      issue.addIssue({ code: "custom", message: "Use an IANA timezone such as America/Vancouver.", path: ["timezone"] });
    }
  }),
  handler: async (input, ctx) => {
    requirePerson(ctx.actor);
    const [row] = await ctx.tx
      .insert(notificationSettings)
      .values({ userId: ctx.actor.userId, ...input })
      .onConflictDoUpdate({
        target: notificationSettings.userId,
        targetWhere: sql`${notificationSettings.userId} is not null`,
        set: { ...input, updatedAt: new Date() },
      })
      .returning();
    ctx.setSubject("notification_settings", row!.id);
    return row!;
  },
});

async function addressFor(notification: typeof notifications.$inferSelect) {
  if (notification.externalRecipient) {
    return { email: notification.externalRecipient, phone: null, key: `email:${notification.externalRecipient}` };
  }
  if (notification.recipientUserId) {
    const [row] = await db()
      .select({ email: users.email, phone: contacts.phone })
      .from(users)
      .leftJoin(contacts, eq(contacts.userId, users.id))
      .where(eq(users.id, notification.recipientUserId))
      .limit(1);
    return { email: row?.email ?? null, phone: row?.phone ?? null, key: `user:${notification.recipientUserId}` };
  }
  const [row] = await db()
    .select({ email: contacts.email, phone: contacts.phone })
    .from(contacts)
    .where(eq(contacts.id, notification.recipientContactId!))
    .limit(1);
  return { email: row?.email ?? null, phone: row?.phone ?? null, key: `contact:${notification.recipientContactId}` };
}

function absoluteHref(href: string | null): string | undefined {
  return href ? new URL(href, env().APP_URL).toString() : undefined;
}

async function claimDelivery(id: string) {
  const [row] = await db()
    .update(notificationDeliveries)
    .set({ status: "processing", updatedAt: new Date() })
    .where(
      and(
        eq(notificationDeliveries.id, id),
        or(
          inArray(notificationDeliveries.status, ["pending", "failed"]),
          and(
            eq(notificationDeliveries.status, "processing"),
            lt(notificationDeliveries.updatedAt, sql`now() - interval '10 minutes'`),
          ),
        ),
      ),
    )
    .returning();
  return row;
}

function retryAt(attempts: number): Date {
  return new Date(Date.now() + Math.min(3600, 15 * 2 ** Math.min(attempts, 8)) * 1000);
}

export async function deliverDueNotifications(limit = 50) {
  const candidates = await db()
    .select({ id: notificationDeliveries.id })
    .from(notificationDeliveries)
    .where(
      and(
        ne(notificationDeliveries.kind, "digest"),
        or(
          and(
            inArray(notificationDeliveries.status, ["pending", "failed"]),
            lte(notificationDeliveries.availableAt, sql`now()`),
          ),
          and(
            eq(notificationDeliveries.status, "processing"),
            lt(notificationDeliveries.updatedAt, sql`now() - interval '10 minutes'`),
          ),
        ),
        lt(notificationDeliveries.attempts, 8),
      ),
    )
    .orderBy(asc(notificationDeliveries.availableAt))
    .limit(limit);
  let attempted = 0;
  for (const candidate of candidates) {
    const delivery = await claimDelivery(candidate.id);
    if (!delivery) continue;
    attempted += 1;
    const [notification] = await db()
      .select()
      .from(notifications)
      .where(eq(notifications.id, delivery.notificationId))
      .limit(1);
    if (!notification || notification.archivedAt) {
      await db().update(notificationDeliveries).set({
        status: "skipped",
        attempts: sql`${notificationDeliveries.attempts} + 1`,
        lastError: "The notification was archived before delivery.",
        updatedAt: new Date(),
      }).where(eq(notificationDeliveries.id, delivery.id));
      continue;
    }
    const address = await addressFor(notification);
    const t = translator(notification.locale);
    try {
      let outcome: { provider: string; providerRef: string | null; delivers: boolean; reason?: string };
      if (delivery.channel === "email") {
        if (!address.email) {
          outcome = { provider: "none", providerRef: null, delivers: false, reason: "This recipient has no email address." };
        } else {
          const result = await db().transaction((tx) => sendMail(
            tx,
            {
              to: address.email!,
              subject: notification.title,
              text: [
                notification.body,
                notification.occurrenceCount > 1
                  ? t("notifications.email.repeated", { count: notification.occurrenceCount })
                  : "",
                absoluteHref(notification.href)
                  ? t("notifications.email.open", { url: absoluteHref(notification.href)! })
                  : "",
              ].filter(Boolean).join("\n\n"),
              replyTo: notification.replyTo ?? undefined,
            },
            {
              requestedBy: "system:notifications",
              idempotencyKey: `notification-delivery:${delivery.id}`,
            },
          ));
          outcome = {
            provider: result.provider,
            providerRef: result.providerRef,
            delivers: result.delivers,
            reason: result.delivers ? undefined : "The configured mail adapter does not deliver.",
          };
        }
      } else {
        const adapter = delivery.channel === "sms" ? smsNotifications : pushNotifications;
        const to = delivery.channel === "sms" ? address.phone : address.key;
        if (!to) {
          outcome = { provider: adapter.id, providerRef: null, delivers: false, reason: "This recipient has no phone number." };
        } else {
          const result = await adapter.send({
            to,
            title: notification.title,
            body: notification.body,
            href: absoluteHref(notification.href),
            deliveryId: delivery.id,
          });
          outcome = { provider: adapter.id, ...result };
        }
      }
      await db().update(notificationDeliveries).set({
        status: outcome.delivers ? "delivered" : "skipped",
        provider: outcome.provider,
        providerRef: outcome.providerRef,
        lastError: outcome.reason?.slice(0, 500) ?? null,
        attempts: sql`${notificationDeliveries.attempts} + 1`,
        deliveredAt: outcome.delivers ? new Date() : null,
        updatedAt: new Date(),
      }).where(eq(notificationDeliveries.id, delivery.id));
    } catch {
      await db().update(notificationDeliveries).set({
        status: "failed",
        lastError: "The notification provider could not submit this message.",
        attempts: sql`${notificationDeliveries.attempts} + 1`,
        availableAt: retryAt(delivery.attempts + 1),
        updatedAt: new Date(),
      }).where(eq(notificationDeliveries.id, delivery.id));
    }
  }
  return { attempted };
}

function digestKey(ids: string[]): string {
  return createHash("sha256").update([...ids].sort().join("\n")).digest("hex");
}

export async function deliverDueDigests(limit = 100) {
  const due = await db()
    .select({ delivery: notificationDeliveries, notification: notifications })
    .from(notificationDeliveries)
    .innerJoin(notifications, eq(notifications.id, notificationDeliveries.notificationId))
    .where(
      and(
        eq(notificationDeliveries.kind, "digest"),
        or(
          and(
            eq(notificationDeliveries.status, "deferred"),
            lte(notificationDeliveries.availableAt, sql`now()`),
          ),
          and(
            eq(notificationDeliveries.status, "processing"),
            lt(notificationDeliveries.updatedAt, sql`now() - interval '10 minutes'`),
          ),
        ),
        isNull(notifications.archivedAt),
        lt(notificationDeliveries.attempts, 8),
      ),
    )
    .orderBy(asc(notificationDeliveries.availableAt))
    .limit(limit);
  const groups = new Map<string, typeof due>();
  for (const row of due) {
    const identity = row.notification.recipientUserId
      ? `user:${row.notification.recipientUserId}`
      : `contact:${row.notification.recipientContactId}`;
    const localizedIdentity = `${identity}:${row.notification.locale}`;
    groups.set(localizedIdentity, [...(groups.get(localizedIdentity) ?? []), row]);
  }
  let digests = 0;
  for (const rows of groups.values()) {
    const address = await addressFor(rows[0]!.notification);
    if (!address.email) {
      await db().update(notificationDeliveries).set({
        status: "skipped",
        lastError: "This recipient has no email address.",
        attempts: sql`${notificationDeliveries.attempts} + 1`,
        updatedAt: new Date(),
      }).where(inArray(notificationDeliveries.id, rows.map((row) => row.delivery.id)));
      continue;
    }
    const ids = rows.map((row) => row.delivery.id);
    const key = `digest:${digestKey(ids)}`;
    const claimed = await db().update(notificationDeliveries).set({
      status: "processing",
      updatedAt: new Date(),
    }).where(and(
      inArray(notificationDeliveries.id, ids),
      or(
        eq(notificationDeliveries.status, "deferred"),
        and(
          eq(notificationDeliveries.status, "processing"),
          lt(notificationDeliveries.updatedAt, sql`now() - interval '10 minutes'`),
        ),
      ),
    )).returning({ id: notificationDeliveries.id });
    if (claimed.length !== ids.length) {
      await db().update(notificationDeliveries).set({ status: "deferred", updatedAt: new Date() })
        .where(inArray(notificationDeliveries.id, claimed.map((row) => row.id)));
      continue;
    }
    const [digest] = await db().insert(notificationDigests).values({
      recipientUserId: rows[0]!.notification.recipientUserId,
      recipientContactId: rows[0]!.notification.recipientContactId,
      recipient: address.email,
      locale: rows[0]!.notification.locale,
      idempotencyKey: key,
      itemCount: rows.length,
    }).onConflictDoUpdate({
      target: notificationDigests.idempotencyKey,
      set: { status: "processing", lastError: null, updatedAt: new Date() },
    }).returning();
    await db().update(notificationDeliveries).set({ digestId: digest!.id })
      .where(inArray(notificationDeliveries.id, ids));
    try {
      const t = translator(rows[0]!.notification.locale);
      const result = await db().transaction((tx) => sendMail(tx, {
        to: address.email!,
        subject: t("notifications.digest.subject", { count: rows.length }),
        text: [
          t("notifications.digest.intro"),
          "",
          ...rows.flatMap(({ notification }) => [
            `• ${notification.title}${notification.occurrenceCount > 1 ? ` (${notification.occurrenceCount}×)` : ""}`,
            `  ${notification.body.replace(/\s+/g, " ").slice(0, 500)}`,
            notification.href ? `  ${absoluteHref(notification.href)}` : "",
          ]).filter(Boolean),
        ].join("\n"),
      }, {
        requestedBy: "system:notifications",
        idempotencyKey: `notification-digest:${digest!.id}`,
      }));
      const status = result.delivers ? "delivered" : "skipped";
      await db().transaction(async (tx) => {
        await tx.update(notificationDigests).set({
          status,
          provider: result.provider,
          providerRef: result.providerRef,
          lastError: result.delivers ? null : "The configured mail adapter does not deliver.",
          deliveredAt: result.delivers ? new Date() : null,
          updatedAt: new Date(),
        }).where(eq(notificationDigests.id, digest!.id));
        await tx.update(notificationDeliveries).set({
          status,
          provider: result.provider,
          providerRef: result.providerRef,
          lastError: result.delivers ? null : "The configured mail adapter does not deliver.",
          attempts: sql`${notificationDeliveries.attempts} + 1`,
          deliveredAt: result.delivers ? new Date() : null,
          updatedAt: new Date(),
        }).where(inArray(notificationDeliveries.id, ids));
      });
      digests += 1;
    } catch {
      const attempts = Math.max(...rows.map((row) => row.delivery.attempts)) + 1;
      const terminal = attempts >= 8;
      await db().transaction(async (tx) => {
        await tx.update(notificationDigests).set({
          status: "failed",
          lastError: "The mail provider could not submit this digest.",
          updatedAt: new Date(),
        }).where(eq(notificationDigests.id, digest!.id));
        await tx.update(notificationDeliveries).set({
          status: terminal ? "failed" : "deferred",
          lastError: "The mail provider could not submit this digest.",
          attempts: sql`${notificationDeliveries.attempts} + 1`,
          availableAt: terminal ? new Date() : retryAt(attempts),
          updatedAt: new Date(),
        }).where(inArray(notificationDeliveries.id, ids));
      });
    }
  }
  return { digests };
}

export async function escalateUnreadNotifications(limit = 100) {
  const due = await db().select().from(notifications).where(and(
    eq(notifications.priority, "critical"),
    isNull(notifications.readAt),
    isNull(notifications.archivedAt),
    isNull(notifications.escalatedAt),
    lte(notifications.escalateAt, sql`now()`),
  )).orderBy(asc(notifications.escalateAt)).limit(limit);
  let escalated = 0;
  for (const notification of due) {
    await db().transaction(async (tx) => {
      const [claimed] = await tx.update(notifications).set({
        escalatedAt: new Date(),
        updatedAt: new Date(),
      }).where(and(
        eq(notifications.id, notification.id),
        isNull(notifications.readAt),
        isNull(notifications.archivedAt),
        isNull(notifications.escalatedAt),
      )).returning({ id: notifications.id });
      if (!claimed) return;
      const identity: CreateNotificationInput["recipient"] = notification.recipientUserId
        ? { kind: "user", id: notification.recipientUserId }
        : notification.recipientContactId
          ? { kind: "contact", id: notification.recipientContactId }
          : { kind: "email", address: notification.externalRecipient! };
      const modes = await effectiveModes(tx, identity, notification.topic);
      const channels = (Object.entries(modes) as Array<[NotificationChannel, NotificationMode]>)
        .filter(([channel, mode]) => channel !== "in_app" && mode !== "off")
        .map(([channel]) => ({
          notificationId: notification.id,
          channel,
          kind: "escalation" as const,
          status: "pending" as const,
          availableAt: new Date(),
        }));
      if (channels.length > 0) {
        await tx.insert(notificationDeliveries).values(channels).onConflictDoNothing();
        await enqueueJob(tx, "core.deliverNotifications", {}, {
          idempotencyKey: `notification-escalation:${notification.id}`,
          idempotencyTtlSeconds: 7 * 24 * 60 * 60,
        });
      }
      escalated += 1;
    });
  }
  return { escalated };
}

export async function pruneNotifications() {
  const deleted = await db().delete(notifications).where(and(
    lte(notifications.archivedAt, sql`now() - interval '1 year'`),
    lt(notifications.updatedAt, sql`now() - interval '1 year'`),
  )).returning({ id: notifications.id });
  return { deleted: deleted.length };
}

interface EventTemplate {
  module: string;
  topic: NotificationTopic;
  priority: "information" | "warning" | "critical";
  titleKey: string;
  body?: string;
  bodyKey?: string;
  messageParams?: Record<string, string | number>;
  href: string;
  dedupeKey: string;
}

function eventTemplate(eventName: string, payload: Record<string, unknown>): EventTemplate | undefined {
  if (eventName === "connection.needsAttention" && typeof payload.id === "string") {
    return {
      module: "connections",
      topic: "connections.attention",
      priority: "critical",
      titleKey: "notifications.event.connection.title",
      bodyKey: "notifications.event.connection.body",
      href: "/admin/settings",
      dedupeKey: `connection:${payload.id}`,
    };
  }
  if (eventName === "agentTask.failed" && typeof payload.id === "string") {
    return {
      module: "agents",
      topic: "agents.failed",
      priority: "warning",
      titleKey: "notifications.event.agent.title",
      ...(typeof payload.outcome === "string"
        ? { body: payload.outcome.slice(0, 4000) }
        : { bodyKey: "notifications.event.agent.body" }),
      href: "/admin/jobs",
      dedupeKey: `agent-task:${payload.id}`,
    };
  }
  if (eventName === "contribute.statusUpdated" && typeof payload.id === "string") {
    return {
      module: "contribute",
      topic: "contribute.status",
      priority: "information",
      titleKey: "notifications.event.contributeStatus.title",
      bodyKey: "notifications.event.contributeStatus.body",
      messageParams: {
        status: typeof payload.status === "string" ? payload.status : "updated",
        title: typeof payload.title === "string" ? payload.title.slice(0, 120) : "",
      },
      href: `/admin/contribute/${payload.id}`,
      dedupeKey: `contribute-status:${payload.id}:${typeof payload.status === "string" ? payload.status : ""}`,
    };
  }
  if (eventName === "contribute.ingested" && typeof payload.id === "string") {
    return {
      module: "contribute",
      topic: "contribute.ingested",
      priority: "information",
      titleKey: "notifications.event.contribute.title",
      bodyKey: "notifications.event.contribute.body",
      messageParams: {
        kind: typeof payload.kind === "string" ? payload.kind : "report",
        title: typeof payload.title === "string" ? payload.title.slice(0, 120) : "",
      },
      href: "/admin/contribute",
      dedupeKey: `contribute:${payload.id}`,
    };
  }
  if (
    eventName === "mail.deliveryUpdated" &&
    typeof payload.eventId === "string" &&
    ["hard_bounce", "complaint", "suppressed"].includes(String(payload.type))
  ) {
    return {
      module: "mail",
      topic: "mail.delivery",
      priority: payload.type === "complaint" ? "critical" : "warning",
      titleKey: "notifications.event.mail.title",
      bodyKey: typeof payload.recipient === "string"
        ? "notifications.event.mail.bodyWithRecipient"
        : "notifications.event.mail.body",
      messageParams: {
        type: String(payload.type),
        ...(typeof payload.recipient === "string"
          ? { recipient: payload.recipient }
          : {}),
      },
      href: "/admin/settings?section=mail",
      dedupeKey: `mail:${typeof payload.recipient === "string" ? payload.recipient : payload.eventId}:${String(payload.type)}`,
    };
  }
  return undefined;
}

async function staffForModule(module: string): Promise<string[]> {
  const rows = await db()
    .selectDistinct({ id: users.id })
    .from(users)
    .innerJoin(roleGrants, eq(roleGrants.roleKey, users.role))
    .where(inArray(roleGrants.module, ["*", module]));
  return rows.map((row) => row.id);
}

export async function fanOutEventNotification(
  eventName: string,
  payload: unknown,
  eventId?: string,
) {
  const record = payload && typeof payload === "object" ? payload as Record<string, unknown> : {};
  const template = eventTemplate(eventName, record);
  if (!template) return { created: 0 };
  const stableEvent = eventId ?? createHash("sha256")
    .update(`${eventName}:${JSON.stringify(record)}`)
    .digest("hex");
  const recipients = await staffForModule(template.module);
  for (const userId of recipients) {
    await createNotification.call({
      recipient: { kind: "user", id: userId },
      ...template,
      sourceEventId: eventId,
      sourceEventName: eventName,
      idempotencyKey: `event:${stableEvent}:user:${userId}`,
    }, { kind: "system" });
  }
  return { created: recipients.length };
}

export default [
  createNotification,
  listNotifications,
  unreadNotificationCount,
  markNotificationRead,
  archiveNotification,
  markAllNotificationsRead,
  notificationPreferenceStatus,
  updateNotificationPreference,
  updateNotificationPreferences,
  updateNotificationSettings,
];
