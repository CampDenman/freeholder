// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Recipient-local quiet hours and frequency caps (MASTER.md §4.14, C7.13).
import { and, asc, eq, gte, inArray, lt, sql } from "drizzle-orm";
import { z } from "zod";
import { contacts } from "@/core/contacts/schema";
import { registerContactReference } from "@/core/contacts/service";
import { listed, row, timestamp, uuid } from "@/core/contract";
import { addDays, zonedDate, zonedInstant } from "@/core/i18n/zoned";
import { registerContactPrivacySource } from "@/core/privacy/service";
import {
  defineService,
  getService,
  ServiceError,
  type ServiceContext,
} from "@/core/service";
import { businessProfile } from "@/core/settings/schema";
import { segments } from "@/core/segments/schema";
import { messages } from "./schema";
import type { MESSAGE_CHANNELS } from "./schema";
import { MESSAGE_PURPOSES, type MessagePurpose } from "./purpose";
import {
  MESSAGING_WINDOW_PURPOSES,
  MESSAGING_WINDOW_SCOPES,
  MESSAGING_WINDOW_TIMEZONE_SOURCES,
  messagingWindows,
} from "./policy-schema";

export const SMS_POLICY_EXCEPTION_KINDS = [
  "security_code",
  "booking_update",
  "order_update",
  "customer_requested_reply",
] as const;

const policyException = z.object({
  kind: z.enum(SMS_POLICY_EXCEPTION_KINDS),
  referenceId: z.string().trim().min(1).max(300),
});
export type SmsPolicyException = z.infer<typeof policyException>;

const timeOfDay = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use a 24-hour time such as 21:00.");

interface PolicyWindow {
  id: string;
  code: string;
  name: string;
  scope: (typeof MESSAGING_WINDOW_SCOPES)[number];
  contactId: string | null;
  segmentId: string | null;
  quietFrom: string | null;
  quietTo: string | null;
  timezoneSource: (typeof MESSAGING_WINDOW_TIMEZONE_SOURCES)[number];
  maxPerDay: number | null;
  maxPerWeek: number | null;
  appliesTo: (typeof MESSAGING_WINDOW_PURPOSES)[number];
  active: boolean;
}

const DEFAULT_QUIET_CODE = "recipient-local-quiet-hours";
const DEFAULT_CAP_CODE = "marketing-frequency-cap";

const fallbackQuiet: PolicyWindow = {
  id: "00000000-0000-4000-8000-000000000713",
  code: DEFAULT_QUIET_CODE,
  name: "Recipient-local quiet hours",
  scope: "global",
  contactId: null,
  segmentId: null,
  quietFrom: "21:00",
  quietTo: "08:00",
  timezoneSource: "contact",
  maxPerDay: null,
  maxPerWeek: null,
  appliesTo: "all",
  active: true,
};

const fallbackCap: PolicyWindow = {
  id: "00000000-0000-4000-8000-000000000714",
  code: DEFAULT_CAP_CODE,
  name: "Marketing frequency cap",
  scope: "global",
  contactId: null,
  segmentId: null,
  quietFrom: null,
  quietTo: null,
  timezoneSource: "contact",
  maxPerDay: 3,
  maxPerWeek: 10,
  appliesTo: "marketing",
  active: true,
};

function parseMinutes(value: string): number {
  const [hour, minute] = value.slice(0, 5).split(":").map(Number);
  return hour! * 60 + minute!;
}

/** Handles both ordinary windows and overnight ones such as 21:00–08:00. */
export function isQuietLocalTime(
  localMinutes: number,
  quietFrom: string,
  quietTo: string,
): boolean {
  const from = parseMinutes(quietFrom);
  const to = parseMinutes(quietTo);
  return from < to
    ? localMinutes >= from && localMinutes < to
    : localMinutes >= from || localMinutes < to;
}

function validTimezone(value: string | null | undefined, fallback: string): string {
  if (!value) return fallback;
  try {
    new Intl.DateTimeFormat("en", { timeZone: value }).format();
    return value;
  } catch {
    return fallback;
  }
}

function localClock(at: Date, timezone: string): { minutes: number; display: string } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    hourCycle: "h23",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(at);
  const read = (kind: string): number =>
    Number(parts.find((part) => part.type === kind)?.value ?? "0");
  const hour = read("hour");
  const minute = read("minute");
  return {
    minutes: hour * 60 + minute,
    display: `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`,
  };
}

function appliesToPurpose(window: PolicyWindow, purpose: MessagePurpose): boolean {
  if (window.appliesTo === "all") return true;
  if (window.appliesTo === "marketing") return purpose === "marketing";
  return purpose === "transactional" || purpose === "support";
}

async function activeWindows(ctx: ServiceContext): Promise<PolicyWindow[]> {
  const stored = (await ctx.tx
    .select()
    .from(messagingWindows)
    .where(eq(messagingWindows.active, true))) as PolicyWindow[];
  const byCode = new Map(stored.map((window) => [window.code, window]));
  if (!byCode.has(DEFAULT_QUIET_CODE)) stored.push(fallbackQuiet);
  if (!byCode.has(DEFAULT_CAP_CODE)) stored.push(fallbackCap);
  return stored;
}

async function windowApplies(
  ctx: ServiceContext,
  window: PolicyWindow,
  contactId: string,
): Promise<boolean> {
  if (window.scope === "global") return true;
  if (window.scope === "contact") return window.contactId === contactId;
  if (!window.segmentId) return false;
  const result = (await ctx.call(getService("segments.contains"), {
    id: window.segmentId,
    contactId,
  })) as { member: boolean };
  return result.member;
}

function messagePurposeCondition(purpose: PolicyWindow["appliesTo"]) {
  if (purpose === "marketing") return eq(messages.purpose, "marketing");
  if (purpose === "transactional") {
    return inArray(messages.purpose, ["transactional", "support"]);
  }
  return undefined;
}

async function sentCount(
  ctx: ServiceContext,
  input: {
    contactId: string;
    appliesTo: PolicyWindow["appliesTo"];
    from: Date;
    to: Date;
  },
): Promise<number> {
  const [result] = await ctx.tx
    .select({ count: sql<number>`count(*)::int` })
    .from(messages)
    .where(
      and(
        eq(messages.contactId, input.contactId),
        eq(messages.direction, "outbound"),
        inArray(messages.channel, ["sms", "mms"] satisfies Array<(typeof MESSAGE_CHANNELS)[number]>),
        gte(messages.occurredAt, input.from),
        lt(messages.occurredAt, input.to),
        messagePurposeCondition(input.appliesTo),
      ),
    );
  return result?.count ?? 0;
}

const policyDecision = z.object({
  allowed: z.boolean(),
  reason: z.enum(["allowed", "quiet_hours", "daily_cap", "weekly_cap"]),
  timezone: z.string(),
  localTime: z.string(),
  blockedBy: z
    .object({ id: uuid, code: z.string(), name: z.string() })
    .nullable(),
  exceptionApplied: z.enum(SMS_POLICY_EXCEPTION_KINDS).nullable(),
});

const evaluatePolicyInput = z.object({
  contactId: z.string().uuid(),
  to: z.string().trim().min(4).max(40),
  purpose: z.enum(MESSAGE_PURPOSES),
  exception: policyException.optional(),
  /** Preview/testing only; sendSms never supplies it. */
  at: z.iso.datetime().optional(),
});

/** One answer for every current and future SMS sender. */
export const evaluateSmsPolicy = defineService({
  name: "messaging.evaluateSmsPolicy",
  summary: "Apply recipient-local quiet hours and frequency caps to one text.",
  kind: "query",
  permission: "scoped",
  input: evaluatePolicyInput,
  output: policyDecision,
  handler: async (input, ctx) => {
    const [contact] = await ctx.tx
      .select({ phone: contacts.phone, timezone: contacts.timezone })
      .from(contacts)
      .where(eq(contacts.id, input.contactId))
      .limit(1);
    if (!contact) throw new ServiceError("not_found", "That contact is not here.");
    const normalizePhone = (value: string) => value.replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "");
    if (!contact.phone || normalizePhone(contact.phone) !== normalizePhone(input.to)) {
      throw new ServiceError(
        "validation",
        "The destination does not match the contact whose local messaging policy is being checked.",
      );
    }

    if (input.exception) {
      if (input.purpose === "marketing") {
        throw new ServiceError(
          "validation",
          "Marketing messages never receive a quiet-hours exception.",
        );
      }
      if (ctx.actor.kind !== "system") {
        throw new ServiceError(
          "permission",
          "Only a trusted transactional workflow may name a quiet-hours exception.",
        );
      }
    }

    const [business] = await ctx.tx
      .select({ timezone: businessProfile.timezone, firstDayOfWeek: businessProfile.firstDayOfWeek })
      .from(businessProfile)
      .limit(1);
    const businessTimezone = validTimezone(business?.timezone, "UTC");
    const at = input.at ? new Date(input.at) : new Date();
    const all = await activeWindows(ctx);
    const applicable: PolicyWindow[] = [];
    for (const window of all) {
      if (
        appliesToPurpose(window, input.purpose) &&
        (await windowApplies(ctx, window, input.contactId))
      ) {
        applicable.push(window);
      }
    }

    for (const window of applicable) {
      if (!window.quietFrom || !window.quietTo) continue;
      const timezone =
        window.timezoneSource === "business"
          ? businessTimezone
          : validTimezone(contact.timezone, businessTimezone);
      const clock = localClock(at, timezone);
      if (isQuietLocalTime(clock.minutes, window.quietFrom, window.quietTo)) {
        if (input.exception) {
          return {
            allowed: true,
            reason: "allowed" as const,
            timezone,
            localTime: clock.display,
            blockedBy: null,
            exceptionApplied: input.exception.kind,
          };
        }
        return {
          allowed: false,
          reason: "quiet_hours" as const,
          timezone,
          localTime: clock.display,
          blockedBy: { id: window.id, code: window.code, name: window.name },
          exceptionApplied: null,
        };
      }
    }

    const timezone = validTimezone(contact.timezone, businessTimezone);
    const clock = localClock(at, timezone);
    const localDate = zonedDate(at, timezone);
    const dayStart = zonedInstant(timezone, localDate);
    const nextDay = zonedInstant(timezone, addDays(localDate, 1));
    const dayOfWeek = new Date(Date.UTC(localDate.year, localDate.month - 1, localDate.day)).getUTCDay();
    const firstDay = business?.firstDayOfWeek ?? 1;
    const sinceWeekStart = (dayOfWeek - firstDay + 7) % 7;
    const weekStart = zonedInstant(timezone, addDays(localDate, -sinceWeekStart));
    const nextWeek = zonedInstant(timezone, addDays(localDate, 7 - sinceWeekStart));

    for (const window of applicable) {
      if (window.maxPerDay !== null) {
        const count = await sentCount(ctx, {
          contactId: input.contactId,
          appliesTo: window.appliesTo,
          from: dayStart,
          to: nextDay,
        });
        if (count >= window.maxPerDay) {
          return {
            allowed: false,
            reason: "daily_cap" as const,
            timezone,
            localTime: clock.display,
            blockedBy: { id: window.id, code: window.code, name: window.name },
            exceptionApplied: null,
          };
        }
      }
      if (window.maxPerWeek !== null) {
        const count = await sentCount(ctx, {
          contactId: input.contactId,
          appliesTo: window.appliesTo,
          from: weekStart,
          to: nextWeek,
        });
        if (count >= window.maxPerWeek) {
          return {
            allowed: false,
            reason: "weekly_cap" as const,
            timezone,
            localTime: clock.display,
            blockedBy: { id: window.id, code: window.code, name: window.name },
            exceptionApplied: null,
          };
        }
      }
    }

    return {
      allowed: true,
      reason: "allowed" as const,
      timezone,
      localTime: clock.display,
      blockedBy: null,
      exceptionApplied: input.exception?.kind ?? null,
    };
  },
});

const windowRow = row({
  id: uuid,
  code: z.string(),
  name: z.string(),
  scope: z.enum(MESSAGING_WINDOW_SCOPES),
  contactId: uuid.nullable(),
  segmentId: uuid.nullable(),
  quietFrom: z.string().nullable(),
  quietTo: z.string().nullable(),
  timezoneSource: z.enum(MESSAGING_WINDOW_TIMEZONE_SOURCES),
  maxPerDay: z.number().int().nullable(),
  maxPerWeek: z.number().int().nullable(),
  appliesTo: z.enum(MESSAGING_WINDOW_PURPOSES),
  active: z.boolean(),
  createdAt: timestamp,
  updatedAt: timestamp,
});

export const listMessagingWindows = defineService({
  name: "messaging.windows",
  summary: "The recipient-local quiet hours and frequency caps.",
  kind: "query",
  permission: "scoped",
  input: z.object({}),
  output: listed(windowRow),
  handler: (_input, ctx) =>
    ctx.tx.select().from(messagingWindows).orderBy(asc(messagingWindows.name)),
});

const setWindowInput = z
  .object({
    id: z.string().uuid().optional(),
    code: z.string().trim().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(100).optional(),
    name: z.string().trim().min(1).max(200),
    scope: z.enum(MESSAGING_WINDOW_SCOPES),
    contactId: z.string().uuid().nullable().optional(),
    segmentId: z.string().uuid().nullable().optional(),
    quietFrom: timeOfDay.nullable().optional(),
    quietTo: timeOfDay.nullable().optional(),
    timezoneSource: z.enum(MESSAGING_WINDOW_TIMEZONE_SOURCES).default("contact"),
    maxPerDay: z.number().int().min(1).max(1_000).nullable().optional(),
    maxPerWeek: z.number().int().min(1).max(7_000).nullable().optional(),
    appliesTo: z.enum(MESSAGING_WINDOW_PURPOSES).default("all"),
    active: z.boolean().default(true),
  })
  .superRefine((input, ctx) => {
    const hasQuietFrom = input.quietFrom !== undefined && input.quietFrom !== null;
    const hasQuietTo = input.quietTo !== undefined && input.quietTo !== null;
    if (hasQuietFrom !== hasQuietTo) {
      ctx.addIssue({ code: "custom", path: ["quietTo"], message: "Set both quiet-hour times." });
    }
    if (input.quietFrom && input.quietFrom === input.quietTo) {
      ctx.addIssue({ code: "custom", path: ["quietTo"], message: "Quiet hours need two different times." });
    }
    if (!hasQuietFrom && input.maxPerDay == null && input.maxPerWeek == null) {
      ctx.addIssue({ code: "custom", path: ["maxPerDay"], message: "Add quiet hours or a frequency cap." });
    }
    const correctTarget =
      (input.scope === "global" && !input.contactId && !input.segmentId) ||
      (input.scope === "contact" && Boolean(input.contactId) && !input.segmentId) ||
      (input.scope === "segment" && Boolean(input.segmentId) && !input.contactId);
    if (!correctTarget) {
      ctx.addIssue({ code: "custom", path: ["scope"], message: "The scope needs exactly its own target." });
    }
  });

function slug(value: string): string {
  return value
    .toLocaleLowerCase("en")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 100);
}

export const setMessagingWindow = defineService({
  name: "messaging.setWindow",
  summary: "Create or update one quiet-hours or frequency-cap rule.",
  kind: "mutation",
  permission: "scoped",
  writeClass: "write",
  input: setWindowInput,
  output: windowRow,
  handler: async (input, ctx) => {
    const existing = input.id
      ? (
          await ctx.tx
            .select()
            .from(messagingWindows)
            .where(eq(messagingWindows.id, input.id))
            .limit(1)
        )[0]
      : null;
    if (input.id && !existing) throw new ServiceError("not_found", "That messaging rule is not here.");
    const code = existing?.code ?? input.code ?? slug(input.name);
    if ((code === DEFAULT_QUIET_CODE || code === DEFAULT_CAP_CODE) && !input.active) {
      throw new ServiceError(
        "validation",
        "The baseline protection can be changed, but it cannot be switched off.",
      );
    }
    if (input.contactId) {
      const [contact] = await ctx.tx
        .select({ id: contacts.id })
        .from(contacts)
        .where(eq(contacts.id, input.contactId))
        .limit(1);
      if (!contact) throw new ServiceError("not_found", "That contact is not here.");
    }
    if (input.segmentId) {
      const [segment] = await ctx.tx
        .select({ id: segments.id })
        .from(segments)
        .where(eq(segments.id, input.segmentId))
        .limit(1);
      if (!segment) throw new ServiceError("not_found", "That segment is not here.");
    }
    const values = {
      code,
      name: input.name,
      scope: input.scope,
      contactId: input.contactId ?? null,
      segmentId: input.segmentId ?? null,
      quietFrom: input.quietFrom ?? null,
      quietTo: input.quietTo ?? null,
      timezoneSource: input.timezoneSource,
      maxPerDay: input.maxPerDay ?? null,
      maxPerWeek: input.maxPerWeek ?? null,
      appliesTo: input.appliesTo,
      active: input.active,
      updatedAt: new Date(),
    };
    const [saved] = existing
      ? await ctx.tx
          .update(messagingWindows)
          .set(values)
          .where(eq(messagingWindows.id, existing.id))
          .returning()
      : await ctx.tx.insert(messagingWindows).values(values).returning();
    ctx.setSubject("messagingWindow", saved!.id);
    return saved!;
  },
});

const windowPointerState = z.array(
  z.object({ id: z.string().uuid(), contactId: z.string().uuid().nullable() }),
);

registerContactReference({
  table: "messaging_windows",
  repoint: (tx, duplicateId, survivingId) =>
    tx
      .update(messagingWindows)
      .set({ contactId: survivingId })
      .where(eq(messagingWindows.contactId, duplicateId)),
  captureForUndo: async (tx, duplicateId, survivingId) => ({
    state: await tx
      .select({ id: messagingWindows.id, contactId: messagingWindows.contactId })
      .from(messagingWindows)
      .where(inArray(messagingWindows.contactId, [duplicateId, survivingId])),
    undoable: true,
  }),
  restoreAfterUndo: async (tx, beforeState, _afterState, duplicateId) => {
    const moved = windowPointerState
      .parse(beforeState)
      .filter((window) => window.contactId === duplicateId);
    if (moved.length) {
      await tx
        .update(messagingWindows)
        .set({ contactId: duplicateId })
        .where(inArray(messagingWindows.id, moved.map((window) => window.id)));
    }
  },
});

registerContactPrivacySource({
  scope: "contact.messagingWindows",
  tables: ["messaging_windows"],
  exportData: (tx, contactId) =>
    tx
      .select()
      .from(messagingWindows)
      .where(eq(messagingWindows.contactId, contactId)),
  erase: async (tx, contactId) => {
    const removed = await tx
      .delete(messagingWindows)
      .where(eq(messagingWindows.contactId, contactId))
      .returning({ id: messagingWindows.id });
    return { affected: removed.length };
  },
});

export default [listMessagingWindows, setMessagingWindow, evaluateSmsPolicy];
