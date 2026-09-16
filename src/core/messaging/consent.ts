// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Consent and mandatory carrier control words (MASTER.md §4.14, C7.12).
//
// This file is deliberately in core, before the adapter. A carrier transports
// bytes; it cannot decide whether a person may be contacted. Every SMS send and
// every inbound STOP/START/HELP therefore crosses this boundary regardless of
// which provider delivered it.
import { asc, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { contacts } from "@/core/contacts/schema";
import { registerContactReference } from "@/core/contacts/service";
import { listed, row, timestamp, uuid } from "@/core/contract";
import { registerContactPrivacySource } from "@/core/privacy/service";
import {
  defineService,
  getService,
  ServiceError,
  type ServiceContext,
} from "@/core/service";
import { SMS_COMPLIANCE_INTENTS, smsComplianceEvents } from "./schema";
import { resolveMessageContact } from "./service";
import type { MessagePurpose } from "./purpose";

export type SmsComplianceIntent = (typeof SMS_COMPLIANCE_INTENTS)[number];

interface KeywordMatch {
  intent: SmsComplianceIntent;
  locale: "en" | "es" | "fr";
  keyword: string;
}

/**
 * The three production UI locales all carry the non-configurable compliance
 * vocabulary. Owners may add ordinary KeywordRules later; they may never edit
 * or shadow these words.
 */
export const SMS_COMPLIANCE_KEYWORDS = {
  en: {
    stop: ["STOP", "STOPALL", "UNSUBSCRIBE", "CANCEL", "END", "QUIT"],
    start: ["START", "YES", "UNSTOP"],
    help: ["HELP", "INFO"],
  },
  es: {
    stop: ["ALTO", "PARAR", "BAJA", "CANCELAR", "TERMINAR"],
    start: ["INICIAR", "EMPEZAR", "SI"],
    help: ["AYUDA", "INFORMACION"],
  },
  fr: {
    stop: ["ARRET", "DESABONNER", "ANNULER", "FIN"],
    start: ["COMMENCER", "REPRENDRE", "OUI"],
    help: ["AIDE", "INFORMATION"],
  },
} as const;

const COMPLIANCE_REPLIES: Record<
  KeywordMatch["locale"],
  Record<SmsComplianceIntent, string>
> = {
  en: {
    stop: "You are opted out of marketing messages on every channel. Reply START to opt back into texts.",
    start: "You are opted back into marketing texts. Reply STOP at any time to opt out.",
    help: "Reply STOP to opt out of marketing messages or START to opt back into texts.",
  },
  es: {
    stop: "Ya no recibirá mensajes de marketing por ningún canal. Responda INICIAR para volver a recibir mensajes de texto.",
    start: "Volverá a recibir mensajes de texto de marketing. Responda ALTO en cualquier momento para dejar de recibirlos.",
    help: "Responda ALTO para dejar de recibir mensajes de marketing o INICIAR para volver a recibir mensajes de texto.",
  },
  fr: {
    stop: "Vous ne recevrez plus de messages marketing sur aucun canal. Répondez COMMENCER pour recevoir de nouveau les textos.",
    start: "Vous recevrez de nouveau les textos marketing. Répondez ARRÊT à tout moment pour vous désabonner.",
    help: "Répondez ARRÊT pour refuser les messages marketing ou COMMENCER pour recevoir de nouveau les textos.",
  },
};

/** Accent-, case-, whitespace-, and punctuation-insensitive; still exact. */
export function normalizeComplianceKeyword(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLocaleUpperCase("en")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/** A sentence containing a word is not a control command; the whole body must match. */
export function classifySmsComplianceKeyword(value: string): KeywordMatch | null {
  const keyword = normalizeComplianceKeyword(value);
  if (!keyword) return null;
  for (const [locale, intents] of Object.entries(SMS_COMPLIANCE_KEYWORDS) as Array<
    [KeywordMatch["locale"], (typeof SMS_COMPLIANCE_KEYWORDS)[KeywordMatch["locale"]]]
  >) {
    for (const intent of SMS_COMPLIANCE_INTENTS) {
      if ((intents[intent] as readonly string[]).includes(keyword)) {
        return { intent, locale, keyword };
      }
    }
  }
  return null;
}

function supportedReplyLocale(preferred: string | null, detected: KeywordMatch["locale"]): KeywordMatch["locale"] {
  const language = preferred?.toLocaleLowerCase("en").split("-")[0];
  return language === "en" || language === "es" || language === "fr"
    ? language
    : detected;
}

export function smsComplianceReply(
  intent: SmsComplianceIntent,
  locale: string,
): string {
  const language = locale.toLocaleLowerCase("en").split("-")[0];
  const supported = language === "es" || language === "fr" ? language : "en";
  return COMPLIANCE_REPLIES[supported][intent];
}

function normalizedPhone(value: string): string {
  const digits = value.replace(/\D/g, "");
  return digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
}

/**
 * The one outbound consent gate.
 *
 * Marketing requires affirmative, unexpired SMS evidence and the evidence must
 * belong to the number being sent to. Transactional and support messages ride
 * the existing relationship as §4.14 specifies; C7.13 applies their explicit
 * quiet-hour exceptions at the same boundary.
 */
export async function assertSmsPurposeAllowed(
  ctx: ServiceContext,
  input: { contactId?: string; to: string; purpose: MessagePurpose },
): Promise<void> {
  if (input.purpose !== "marketing") return;
  if (!input.contactId) {
    throw new ServiceError(
      "validation",
      "A marketing text needs the contact whose express SMS consent will be checked.",
    );
  }
  const [contact] = await ctx.tx
    .select({ phone: contacts.phone })
    .from(contacts)
    .where(eq(contacts.id, input.contactId))
    .limit(1);
  if (!contact) throw new ServiceError("not_found", "That contact is not here.");
  if (!contact.phone || normalizedPhone(contact.phone) !== normalizedPhone(input.to)) {
    throw new ServiceError(
      "validation",
      "The destination does not match the number whose consent is being checked.",
    );
  }
  const decision = (await ctx.call(getService("contacts.canContact"), {
    contactId: input.contactId,
    purpose: "marketing",
    channel: "sms",
  })) as { allowed: boolean; reason: string };
  if (!decision.allowed) {
    throw new ServiceError(
      "validation",
      `Marketing text refused: express SMS consent is ${decision.reason.replaceAll("_", " ")}.`,
    );
  }
}

const complianceRow = row({
  id: uuid,
  contactId: uuid,
  providerRef: z.string(),
  intent: z.enum(SMS_COMPLIANCE_INTENTS),
  keyword: z.string(),
  locale: z.string(),
  occurredAt: timestamp,
  createdAt: timestamp,
});

export const listSmsComplianceEvents = defineService({
  name: "messaging.complianceEvents",
  summary: "The carrier control words handled before the inbox saw them.",
  kind: "query",
  permission: "scoped",
  input: z.object({ contactId: z.string().uuid().optional() }),
  output: listed(complianceRow),
  handler: (input, ctx) =>
    ctx.tx
      .select()
      .from(smsComplianceEvents)
      .where(input.contactId ? eq(smsComplianceEvents.contactId, input.contactId) : undefined)
      .orderBy(desc(smsComplianceEvents.occurredAt)),
});

const MARKETING_CHANNELS = ["email", "sms", "push"] as const;

/**
 * Handle mandatory words before conversation recording, automations, or owner
 * keyword rules. Returns true when the event was consumed as compliance.
 */
export async function applyInboundSmsCompliance(
  ctx: ServiceContext,
  event: {
    providerRef: string;
    from: string;
    body?: string;
    occurredAt: string;
  },
): Promise<{ handled: boolean; contactId?: string }> {
  const match = classifySmsComplianceKeyword(event.body ?? "");
  if (!match) return { handled: false };

  const [seen] = await ctx.tx
    .select({ id: smsComplianceEvents.id, contactId: smsComplianceEvents.contactId })
    .from(smsComplianceEvents)
    .where(eq(smsComplianceEvents.providerRef, event.providerRef))
    .limit(1);
  if (seen) return { handled: true, contactId: seen.contactId };

  const contactId = await resolveMessageContact(ctx, {
    phone: event.from,
    channel: "sms",
  });
  const [contact] = await ctx.tx
    .select({ preferredLocale: contacts.preferredLocale })
    .from(contacts)
    .where(eq(contacts.id, contactId))
    .limit(1);
  const locale = supportedReplyLocale(contact?.preferredLocale ?? null, match.locale);
  const occurredAt = new Date(event.occurredAt);
  const [created] = await ctx.tx
    .insert(smsComplianceEvents)
    .values({
      contactId,
      providerRef: event.providerRef,
      intent: match.intent,
      keyword: match.keyword,
      locale,
      occurredAt,
    })
    .onConflictDoNothing({ target: smsComplianceEvents.providerRef })
    .returning();
  if (!created) return { handled: true, contactId };

  if (match.intent === "stop") {
    for (const channel of MARKETING_CHANNELS) {
      await ctx.call(getService("contacts.recordConsent"), {
        contactId,
        purpose: "marketing",
        channel,
        state: "withdrawn",
        method: "system",
        termsVersion: "sms-control-v1",
        evidence: {
          intent: match.intent,
          keyword: match.keyword,
          providerRef: event.providerRef,
        },
        occurredAt: occurredAt.toISOString(),
      });
    }
  } else if (match.intent === "start") {
    // START is explicit permission for the channel it arrived on. It never
    // silently re-enables email or push after a global STOP.
    await ctx.call(getService("contacts.recordConsent"), {
      contactId,
      purpose: "marketing",
      channel: "sms",
      state: "granted",
      method: "system",
      termsVersion: "sms-control-v1",
      evidence: {
        intent: match.intent,
        keyword: match.keyword,
        providerRef: event.providerRef,
      },
      occurredAt: occurredAt.toISOString(),
    });
  }

  await ctx.emitTimeline({
    contactId,
    eventType: "messaging.complianceHandled",
    subjectType: "smsComplianceEvent",
    subjectId: created.id,
    payload: { intent: match.intent, locale },
  });
  ctx.setSubject("smsComplianceEvent", created.id);
  ctx.queueEvent("messaging.complianceHandled", {
    id: created.id,
    contactId,
    intent: match.intent,
    locale,
  });

  // Durable and after-commit: a carrier outage can delay the acknowledgement,
  // but can never undo the opt-out that caused it.
  await ctx.queueJob(
    "core.sendSmsComplianceReply",
    {
      contactId,
      to: event.from,
      body: smsComplianceReply(match.intent, locale),
      idempotencyKey: `sms-compliance:${event.providerRef}`,
      policyException: {
        kind: "customer_requested_reply",
        referenceId: event.providerRef,
      },
    },
    { idempotencyKey: event.providerRef },
  );
  return { handled: true, contactId };
}

const compliancePointerState = z.array(
  z.object({ id: z.string().uuid(), contactId: z.string().uuid() }),
);

registerContactReference({
  table: "sms_compliance_events",
  repoint: (tx, duplicateId, survivingId) =>
    tx
      .update(smsComplianceEvents)
      .set({ contactId: survivingId })
      .where(eq(smsComplianceEvents.contactId, duplicateId)),
  captureForUndo: async (tx, duplicateId, survivingId) => ({
    state: await tx
      .select({ id: smsComplianceEvents.id, contactId: smsComplianceEvents.contactId })
      .from(smsComplianceEvents)
      .where(inArray(smsComplianceEvents.contactId, [duplicateId, survivingId])),
    undoable: true,
  }),
  restoreAfterUndo: async (tx, beforeState, afterState, duplicateId) => {
    const before = compliancePointerState.parse(beforeState);
    const after = compliancePointerState.parse(afterState);
    const current = after.length
      ? await tx
          .select({ id: smsComplianceEvents.id, contactId: smsComplianceEvents.contactId })
          .from(smsComplianceEvents)
          .where(inArray(smsComplianceEvents.id, after.map((event) => event.id)))
      : [];
    const byId = new Map(current.map((event) => [event.id, event.contactId]));
    if (
      current.length !== after.length ||
      after.some((event) => byId.get(event.id) !== event.contactId)
    ) {
      throw new ServiceError(
        "conflict",
        "SMS compliance evidence changed after this merge. Leave the merge in place or restore the evidence first.",
      );
    }
    const moved = before.filter((event) => event.contactId === duplicateId);
    if (moved.length) {
      await tx
        .update(smsComplianceEvents)
        .set({ contactId: duplicateId })
        .where(inArray(smsComplianceEvents.id, moved.map((event) => event.id)));
    }
  },
});

registerContactPrivacySource({
  scope: "contact.smsCompliance",
  tables: ["sms_compliance_events"],
  exportData: (tx, contactId) =>
    tx
      .select()
      .from(smsComplianceEvents)
      .where(eq(smsComplianceEvents.contactId, contactId))
      .orderBy(asc(smsComplianceEvents.occurredAt)),
  erase: async (tx, contactId) => {
    const removed = await tx
      .delete(smsComplianceEvents)
      .where(eq(smsComplianceEvents.contactId, contactId))
      .returning({ id: smsComplianceEvents.id });
    return { affected: removed.length };
  },
});

export default [listSmsComplianceEvents];
