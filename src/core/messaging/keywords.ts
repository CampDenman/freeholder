// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Owner-defined inbound SMS actions, always downstream of mandatory carrier
// control words (MASTER.md §4.14, C7.14).
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { users } from "@/core/auth/schema";
import { contacts } from "@/core/contacts/schema";
import { registerContactReference } from "@/core/contacts/service";
import { listed, row, timestamp, uuid } from "@/core/contract";
import { registerContactPrivacySource } from "@/core/privacy/service";
import { bookings } from "@/core/scheduling/schema";
import { defineService, getService, ServiceError, type ServiceContext } from "@/core/service";
import { SMS_COMPLIANCE_KEYWORDS, normalizeComplianceKeyword } from "./consent";
import {
  conversations,
  KEYWORD_ACTIONS,
  KEYWORD_MATCH_KINDS,
  keywordRuleEvents,
  keywordRules,
  messages,
} from "./schema";

const id = z.string().uuid();
const matchKind = z.enum(KEYWORD_MATCH_KINDS);
const actionKind = z.enum(KEYWORD_ACTIONS);
const localeValue = z.union([
  z.literal("*"),
  z
    .string()
    .trim()
    .min(2)
    .max(35)
    .refine((value) => {
      try {
        return Intl.getCanonicalLocales(value).length === 1;
      } catch {
        return false;
      }
    }, "Enter a valid locale such as en, fr-CA, or es-MX.")
    .transform((value) => Intl.getCanonicalLocales(value)[0]!),
]);

const ruleRow = row({
  id: uuid,
  keyword: z.string(),
  normalizedKeyword: z.string(),
  match: matchKind,
  action: actionKind,
  actionValue: z.string().nullable(),
  replyBody: z.string().nullable(),
  locale: z.string(),
  active: z.boolean(),
  createdBy: uuid.nullable(),
  createdAt: timestamp,
  updatedAt: timestamp,
});

const eventRow = row({
  id: uuid,
  providerRef: z.string(),
  ruleId: uuid.nullable(),
  contactId: uuid,
  conversationId: uuid,
  action: actionKind,
  outcome: z.enum(["applied", "refused", "noop"]),
  detail: z.string().nullable(),
  bookingId: uuid.nullable(),
  createdAt: timestamp,
});

const ruleInput = z.object({
  keyword: z.string().trim().min(1).max(100),
  match: matchKind.default("exact"),
  action: actionKind,
  actionValue: z.string().trim().min(1).max(200).nullish(),
  replyBody: z.string().trim().min(1).max(4_000).nullish(),
  locale: localeValue.default("*"),
  active: z.boolean().default(true),
});

const RESERVED = Object.values(SMS_COMPLIANCE_KEYWORDS)
  .flatMap((intents) => [...intents.stop, ...intents.start, ...intents.help])
  .map(normalizeComplianceKeyword);

function assertNotReserved(keyword: string, match: (typeof KEYWORD_MATCH_KINDS)[number]): string {
  const normalized = normalizeComplianceKeyword(keyword);
  if (!normalized) throw new ServiceError("validation", "That keyword has no letters or numbers.");
  const overlaps = RESERVED.some((reserved) =>
    match === "exact"
      ? reserved === normalized
      : reserved.startsWith(normalized) || normalized.startsWith(reserved),
  );
  if (overlaps) {
    throw new ServiceError(
      "validation",
      "STOP, START, HELP, and their localized carrier words are protected and cannot be shadowed.",
    );
  }
  return normalized;
}

async function validateAction(
  ctx: ServiceContext,
  action: (typeof KEYWORD_ACTIONS)[number],
  actionValue: string | null | undefined,
  replyBody: string | null | undefined,
): Promise<string | null> {
  if ((action === "auto_reply" || action === "help") && !replyBody) {
    throw new ServiceError("validation", "That keyword action needs a reply message.");
  }
  if (action === "tag") {
    if (!actionValue) throw new ServiceError("validation", "A tag keyword needs a tag.");
    return actionValue.toLocaleLowerCase("en");
  }
  if (action === "route") {
    if (!actionValue || !z.string().uuid().safeParse(actionValue).success) {
      throw new ServiceError("validation", "A routing keyword needs a user id.");
    }
    const [user] = await ctx.tx
      .select({ id: users.id })
      .from(users)
      .where(eq(users.id, actionValue))
      .limit(1);
    if (!user) throw new ServiceError("not_found", "That routing user is not here.");
    return actionValue;
  }
  if (actionValue) {
    throw new ServiceError("validation", "That keyword action does not use an action value.");
  }
  return null;
}

async function ensureUnique(
  ctx: ServiceContext,
  input: { normalizedKeyword: string; match: (typeof KEYWORD_MATCH_KINDS)[number]; locale: string },
  excludeId?: string,
): Promise<void> {
  const [existing] = await ctx.tx
    .select({ id: keywordRules.id })
    .from(keywordRules)
    .where(
      and(
        eq(keywordRules.normalizedKeyword, input.normalizedKeyword),
        eq(keywordRules.match, input.match),
        eq(keywordRules.locale, input.locale),
        excludeId ? sql`${keywordRules.id} <> ${excludeId}` : undefined,
      ),
    )
    .limit(1);
  if (existing) throw new ServiceError("conflict", "That keyword rule already exists.");
}

export const listKeywordRules = defineService({
  name: "messaging.keywordRules",
  summary: "List owner keyword actions after protected carrier words.",
  kind: "query",
  permission: "scoped",
  input: z.object({ includeInactive: z.boolean().default(false) }),
  output: listed(ruleRow),
  handler: (input, ctx) =>
    ctx.tx
      .select()
      .from(keywordRules)
      .where(input.includeInactive ? undefined : eq(keywordRules.active, true))
      .orderBy(asc(keywordRules.locale), asc(keywordRules.keyword)),
});

export const createKeywordRule = defineService({
  name: "messaging.createKeywordRule",
  summary: "Teach one safe inbound keyword action.",
  kind: "mutation",
  permission: "scoped",
  writeClass: "write",
  input: ruleInput,
  output: ruleRow,
  handler: async (input, ctx) => {
    const normalizedKeyword = assertNotReserved(input.keyword, input.match);
    const actionValue = await validateAction(ctx, input.action, input.actionValue, input.replyBody);
    await ensureUnique(ctx, { normalizedKeyword, match: input.match, locale: input.locale });
    const [created] = await ctx.tx
      .insert(keywordRules)
      .values({
        ...input,
        normalizedKeyword,
        actionValue,
        replyBody: input.replyBody ?? null,
        createdBy: ctx.actor.kind === "user" ? ctx.actor.userId : null,
      })
      .returning();
    ctx.setSubject("keywordRule", created!.id);
    ctx.queueEvent("messaging.keywordRuleCreated", { id: created!.id });
    return created!;
  },
});

export const updateKeywordRule = defineService({
  name: "messaging.updateKeywordRule",
  summary: "Change an owner keyword action.",
  kind: "mutation",
  permission: "scoped",
  writeClass: "write",
  input: ruleInput.partial().extend({ id }),
  output: ruleRow,
  handler: async (input, ctx) => {
    const [existing] = await ctx.tx
      .select()
      .from(keywordRules)
      .where(eq(keywordRules.id, input.id))
      .limit(1);
    if (!existing) throw new ServiceError("not_found", "That keyword rule is not here.");
    const keyword = input.keyword ?? existing.keyword;
    const match = input.match ?? existing.match;
    const action = input.action ?? existing.action;
    const actionValueInput = input.actionValue === undefined ? existing.actionValue : input.actionValue;
    const replyBody = input.replyBody === undefined ? existing.replyBody : input.replyBody;
    const locale = input.locale ?? existing.locale;
    const normalizedKeyword = assertNotReserved(keyword, match);
    const actionValue = await validateAction(ctx, action, actionValueInput, replyBody);
    await ensureUnique(ctx, { normalizedKeyword, match, locale }, existing.id);
    const [updated] = await ctx.tx
      .update(keywordRules)
      .set({
        keyword,
        normalizedKeyword,
        match,
        action,
        actionValue,
        replyBody: replyBody ?? null,
        locale,
        active: input.active ?? existing.active,
        updatedAt: new Date(),
      })
      .where(eq(keywordRules.id, existing.id))
      .returning();
    ctx.setSubject("keywordRule", updated!.id);
    ctx.queueEvent("messaging.keywordRuleUpdated", { id: updated!.id });
    return updated!;
  },
});

export const deleteKeywordRule = defineService({
  name: "messaging.deleteKeywordRule",
  summary: "Remove an owner keyword action without deleting its evidence.",
  kind: "mutation",
  permission: "scoped",
  writeClass: "destructive",
  input: z.object({ id }),
  output: row({ ok: z.literal(true) }),
  handler: async (input, ctx) => {
    const removed = await ctx.tx
      .delete(keywordRules)
      .where(eq(keywordRules.id, input.id))
      .returning({ id: keywordRules.id });
    if (!removed[0]) throw new ServiceError("not_found", "That keyword rule is not here.");
    ctx.setSubject("keywordRule", input.id);
    ctx.queueEvent("messaging.keywordRuleDeleted", { id: input.id });
    return { ok: true as const };
  },
});

export const listKeywordRuleEvents = defineService({
  name: "messaging.keywordEvents",
  summary: "List the inbound keyword actions that actually ran.",
  kind: "query",
  permission: "scoped",
  input: z.object({ contactId: id.optional() }),
  output: listed(eventRow),
  handler: (input, ctx) =>
    ctx.tx
      .select()
      .from(keywordRuleEvents)
      .where(input.contactId ? eq(keywordRuleEvents.contactId, input.contactId) : undefined)
      .orderBy(desc(keywordRuleEvents.createdAt)),
});

function localizedLanguage(locale: string | null): string {
  return locale?.toLocaleLowerCase("en").split("-")[0] ?? "en";
}

function replyFor(body: string, contact: typeof contacts.$inferSelect): string {
  return body
    .replaceAll("{{contact.first_name}}", contact.name.trim().split(/\s+/u)[0] ?? contact.name)
    .replaceAll("{{contact.email}}", contact.email ?? "");
}

async function bookingToConfirm(
  ctx: ServiceContext,
  contactId: string,
  conversationId: string,
): Promise<typeof bookings.$inferSelect | null> {
  const [linked] = await ctx.tx
    .select({ reference: messages.policyExceptionRef })
    .from(messages)
    .where(
      and(
        eq(messages.conversationId, conversationId),
        eq(messages.direction, "outbound"),
        eq(messages.policyException, "booking_update"),
      ),
    )
    .orderBy(desc(messages.occurredAt))
    .limit(1);
  if (linked?.reference && z.string().uuid().safeParse(linked.reference).success) {
    const [booking] = await ctx.tx
      .select()
      .from(bookings)
      .where(
        and(
          eq(bookings.id, linked.reference),
          eq(bookings.contactId, contactId),
          eq(bookings.status, "requested"),
        ),
      )
      .limit(1);
    if (booking) return booking;
  }

  // No contextual reminder: confirm only when there is exactly one possible
  // future request. Guessing between two appointments is worse than routing it.
  const candidates = await ctx.tx
    .select()
    .from(bookings)
    .where(
      and(
        eq(bookings.contactId, contactId),
        eq(bookings.status, "requested"),
        sql`${bookings.startsAt} > now()`,
      ),
    )
    .orderBy(asc(bookings.startsAt))
    .limit(2);
  return candidates.length === 1 ? candidates[0]! : null;
}

/** Apply at most one owner rule to a newly-recorded inbound message. */
export async function applyInboundKeywordRule(
  ctx: ServiceContext,
  input: {
    providerRef: string;
    body: string;
    from: string;
    contactId: string;
    conversationId: string;
  },
): Promise<boolean> {
  const normalized = normalizeComplianceKeyword(input.body);
  if (!normalized) return false;
  const [contact] = await ctx.tx
    .select()
    .from(contacts)
    .where(eq(contacts.id, input.contactId))
    .limit(1);
  if (!contact) return false;
  const language = localizedLanguage(contact.preferredLocale);
  const rules = await ctx.tx
    .select()
    .from(keywordRules)
    .where(eq(keywordRules.active, true));
  const rule = rules
    .filter((candidate) => candidate.locale === "*" || localizedLanguage(candidate.locale) === language)
    .filter((candidate) =>
      candidate.match === "exact"
        ? normalized === candidate.normalizedKeyword
        : normalized.startsWith(candidate.normalizedKeyword),
    )
    .sort((left, right) => {
      const localeOrder = Number(right.locale !== "*") - Number(left.locale !== "*");
      if (localeOrder !== 0) return localeOrder;
      const matchOrder = Number(right.match === "exact") - Number(left.match === "exact");
      return matchOrder || right.normalizedKeyword.length - left.normalizedKeyword.length;
    })[0];
  if (!rule) return false;

  let outcome: "applied" | "refused" | "noop" = "applied";
  let detail: string | null = null;
  let bookingId: string | null = null;
  let replyBody = rule.replyBody;

  if (rule.action === "opt_out") {
    for (const channel of ["email", "sms", "push"] as const) {
      await ctx.call(getService("contacts.recordConsent"), {
        contactId: contact.id,
        purpose: "marketing",
        channel,
        state: "withdrawn",
        method: "system",
        termsVersion: "sms-keyword-v1",
        evidence: { ruleId: rule.id, providerRef: input.providerRef },
      });
    }
  } else if (rule.action === "opt_in") {
    await ctx.call(getService("contacts.recordConsent"), {
      contactId: contact.id,
      purpose: "marketing",
      channel: "sms",
      state: "granted",
      method: "system",
      termsVersion: "sms-keyword-v1",
      evidence: { ruleId: rule.id, providerRef: input.providerRef },
    });
  } else if (rule.action === "tag") {
    const tag = rule.actionValue!;
    if (!contact.tags.includes(tag)) {
      await ctx.tx
        .update(contacts)
        .set({ tags: [...contact.tags, tag], updatedAt: new Date() })
        .where(eq(contacts.id, contact.id));
    } else {
      outcome = "noop";
      detail = "The contact already had that tag.";
    }
  } else if (rule.action === "route") {
    await ctx.tx
      .update(conversations)
      .set({ assigneeUserId: rule.actionValue, updatedAt: new Date() })
      .where(eq(conversations.id, input.conversationId));
  } else if (rule.action === "booking_confirm") {
    const booking = await bookingToConfirm(ctx, contact.id, input.conversationId);
    if (!booking) {
      outcome = "refused";
      detail = "There was not exactly one requested booking to confirm.";
      replyBody = null;
    } else {
      bookingId = booking.id;
      try {
        await ctx.callAsSystem(getService("bookings.setStatus"), {
          id: booking.id,
          status: "confirmed",
        });
      } catch (error) {
        if (!(error instanceof ServiceError)) throw error;
        outcome = "refused";
        detail = error.message;
        replyBody = null;
      }
    }
  }

  const [event] = await ctx.tx
    .insert(keywordRuleEvents)
    .values({
      providerRef: input.providerRef,
      ruleId: rule.id,
      contactId: contact.id,
      conversationId: input.conversationId,
      action: rule.action,
      outcome,
      detail,
      bookingId,
    })
    .onConflictDoNothing({ target: keywordRuleEvents.providerRef })
    .returning();
  if (!event) return true;

  if (replyBody) {
    await ctx.queueJob(
      "core.sendSmsKeywordReply",
      {
        contactId: contact.id,
        to: input.from,
        body: replyFor(replyBody, contact),
        idempotencyKey: `sms-keyword:${input.providerRef}`,
        referenceId: event.id,
      },
      { idempotencyKey: `sms-keyword:${input.providerRef}` },
    );
  }
  await ctx.emitTimeline({
    contactId: contact.id,
    eventType: "messaging.keywordHandled",
    subjectType: "keywordRuleEvent",
    subjectId: event.id,
    payload: { ruleId: rule.id, action: rule.action, outcome, bookingId },
  });
  ctx.queueEvent("messaging.keywordHandled", {
    id: event.id,
    ruleId: rule.id,
    action: rule.action,
    outcome,
  });
  return true;
}

const pointerState = z.array(z.object({ id, contactId: id }));

registerContactReference({
  table: "keyword_rule_events",
  repoint: (tx, duplicateId, survivingId) =>
    tx
      .update(keywordRuleEvents)
      .set({ contactId: survivingId })
      .where(eq(keywordRuleEvents.contactId, duplicateId)),
  captureForUndo: async (tx, duplicateId, survivingId) => ({
    state: await tx
      .select({ id: keywordRuleEvents.id, contactId: keywordRuleEvents.contactId })
      .from(keywordRuleEvents)
      .where(inArray(keywordRuleEvents.contactId, [duplicateId, survivingId])),
    undoable: true,
  }),
  restoreAfterUndo: async (tx, beforeState, _afterState, duplicateId) => {
    const moved = pointerState.parse(beforeState).filter((event) => event.contactId === duplicateId);
    if (moved.length > 0) {
      await tx
        .update(keywordRuleEvents)
        .set({ contactId: duplicateId })
        .where(inArray(keywordRuleEvents.id, moved.map((event) => event.id)));
    }
  },
});

registerContactPrivacySource({
  scope: "contact.smsKeywordActions",
  tables: ["keyword_rule_events"],
  exportData: (tx, contactId) =>
    tx
      .select()
      .from(keywordRuleEvents)
      .where(eq(keywordRuleEvents.contactId, contactId))
      .orderBy(asc(keywordRuleEvents.createdAt)),
  erase: async (tx, contactId) => {
    const removed = await tx
      .delete(keywordRuleEvents)
      .where(eq(keywordRuleEvents.contactId, contactId))
      .returning({ id: keywordRuleEvents.id });
    return { affected: removed.length };
  },
});

export default [
  listKeywordRules,
  createKeywordRule,
  updateKeywordRule,
  deleteKeywordRule,
  listKeywordRuleEvents,
];
