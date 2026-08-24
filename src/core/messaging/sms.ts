// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Sending and receiving text messages (MASTER.md §4.14, §12, C7.10).
//
// The adapter transports; core decides. That split is not decoration — §4.14
// puts consent, quiet hours and "who may be messaged" in the service layer
// precisely so there is no code path that can skip them, and a provider SDK
// invited into the domain is exactly how such a path appears.
//
// Four things this file is careful about.
//
// **Which number to send from is a decision with consequences.** §4.14 keeps
// transactional and marketing apart because consent does, so the number is
// chosen by purpose and a number that failed its last health check is refused
// rather than used — sending from a number carriers are filtering is how a
// business discovers the problem from a customer.
//
// **Cost is recorded per message.** §4.14: "SMS is the one channel where an
// owner can spend real money by accident." The provider returns segments and
// price; both land on the message, in integer minor units (§15.4).
//
// **Delivery is observed.** A send records `queued`; the carrier's callback
// records what actually happened, including its own error code verbatim.
//
// **An inbound message goes through the same door as every other channel.**
// `conversations.record` resolves the contact and threads it, so a text from an
// unknown number becomes a real person with a real history (C7.08) rather than
// something SMS-shaped that only the SMS screen understands.
import { z } from "zod";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { listed, row, timestamp, uuid } from "@/core/contract";
import { smsAdapters } from "@/adapters/sms";
import type { SmsAdapter } from "@/adapters/sms";
import { AdapterError } from "@/adapters/types";
import {
  defineService,
  getService,
  ServiceError,
  type Actor,
  type ServiceContext,
  type Tx,
} from "@/core/service";
import { NUMBER_KINDS, NUMBER_PURPOSES, messagingNumbers } from "./numbers-schema";
import {
  maySend,
  overallState,
  REGISTRATION_KINDS,
  REGISTRATION_STATES,
  requirementsFor,
  type RegistrationRecord,
} from "./registration";

const id = z.string().uuid();

function requirePerson(actor: Actor): void {
  // System passes: a booking reminder and a carrier webhook both reach here
  // without a person at the keyboard.
  if (actor.kind !== "user" && actor.kind !== "system") {
    throw new ServiceError("permission", "Sign in to manage text messaging.");
  }
}

const numberRow = row({
  id: uuid,
  provider: z.string(),
  providerRef: z.string(),
  e164: z.string(),
  label: z.string().nullable(),
  country: z.string().nullable(),
  kind: z.enum(NUMBER_KINDS),
  capabilities: z.unknown(),
  purpose: z.enum(NUMBER_PURPOSES),
  isDefault: z.boolean(),
  active: z.boolean(),
  healthy: z.boolean(),
  healthUnknown: z.boolean(),
  healthProblem: z.string().nullable(),
  providerStatus: z.string().nullable(),
  healthCheckedAt: timestamp.nullable(),
  registrations: z.unknown(),
});

/** The adapter an instance is actually configured for, or the refusing one. */
export function smsAdapter(provider?: string): SmsAdapter {
  if (provider) return smsAdapters.get(provider);
  // The first that is genuinely usable. `none` is last and always present, so
  // an unconfigured instance refuses clearly rather than throwing.
  const configured = smsAdapters.available()[0];
  return configured ?? smsAdapters.get("none");
}

export const listMessagingNumbers = defineService({
  name: "messaging.numbers",
  summary: "The numbers this business sends and receives on.",
  kind: "query",
  permission: "scoped",
  input: z.object({}),
  output: listed(numberRow),
  handler: (_input, ctx) =>
    ctx.tx
      .select()
      .from(messagingNumbers)
      .orderBy(desc(messagingNumbers.isDefault), asc(messagingNumbers.e164)),
});

/**
 * Read the numbers the provider actually holds.
 *
 * Listing, never buying. Buying a number spends the owner's money on a vendor's
 * terms, in a country with its own rules about who may hold one — that belongs
 * in the provider's own console, and a platform that hides it behind one button
 * is a platform that bought somebody the wrong thing.
 */
export const importMessagingNumbers = defineService({
  name: "messaging.importNumbers",
  summary: "Read the numbers the provider holds and record what each can do.",
  kind: "mutation",
  permission: "scoped",
  writeClass: "write",
  input: z.object({ provider: z.string().trim().max(50).optional() }),
  output: row({ found: z.number().int(), added: z.number().int() }),
  handler: async (input, ctx) => {
    requirePerson(ctx.actor);
    const adapter = smsAdapter(input.provider);
    if (!adapter.available || !adapter.listNumbers) {
      throw new ServiceError("validation", adapter.status.message);
    }
    const numbers = await adapter.listNumbers();
    let added = 0;
    for (const number of numbers) {
      const [existing] = await ctx.tx
        .select({ id: messagingNumbers.id })
        .from(messagingNumbers)
        .where(
          and(
            eq(messagingNumbers.provider, adapter.id),
            eq(messagingNumbers.providerRef, number.providerRef),
          ),
        )
        .limit(1);
      if (existing) {
        // Capabilities can change under a number; the label, purpose and
        // default are the owner's and are left alone.
        await ctx.tx
          .update(messagingNumbers)
          .set({
            e164: number.e164,
            country: number.country,
            kind: number.kind,
            capabilities: number.capabilities,
            updatedAt: sql`now()`,
          })
          .where(eq(messagingNumbers.id, existing.id));
        continue;
      }
      await ctx.tx.insert(messagingNumbers).values({
        provider: adapter.id,
        providerRef: number.providerRef,
        e164: number.e164,
        country: number.country,
        kind: number.kind,
        capabilities: number.capabilities,
      });
      added += 1;
    }
    ctx.queueEvent("messaging.numbersImported", { provider: adapter.id, found: numbers.length });
    return { found: numbers.length, added };
  },
});

export const updateMessagingNumber = defineService({
  name: "messaging.updateNumber",
  summary: "Say what a number is for, and whether it is the default.",
  kind: "mutation",
  permission: "scoped",
  writeClass: "write",
  input: z.object({
    id,
    label: z.string().trim().max(120).nullish(),
    purpose: z.enum(NUMBER_PURPOSES).optional(),
    isDefault: z.boolean().optional(),
    active: z.boolean().optional(),
  }),
  output: numberRow,
  handler: async (input, ctx) => {
    requirePerson(ctx.actor);
    const [existing] = await ctx.tx
      .select()
      .from(messagingNumbers)
      .where(eq(messagingNumbers.id, input.id))
      .limit(1);
    if (!existing) throw new ServiceError("not_found", "That number is not here.");

    const purpose = input.purpose ?? existing.purpose;
    if (input.isDefault) {
      // One default per purpose; the index says so, this keeps it true rather
      // than letting the second one collide.
      await ctx.tx
        .update(messagingNumbers)
        .set({ isDefault: false, updatedAt: sql`now()` })
        .where(
          and(eq(messagingNumbers.purpose, purpose), eq(messagingNumbers.isDefault, true)),
        );
    }
    const [updated] = await ctx.tx
      .update(messagingNumbers)
      .set({
        ...(input.label !== undefined ? { label: input.label ?? null } : {}),
        ...(input.purpose !== undefined ? { purpose } : {}),
        ...(input.isDefault !== undefined ? { isDefault: input.isDefault } : {}),
        ...(input.active !== undefined ? { active: input.active } : {}),
        updatedAt: sql`now()`,
      })
      .where(eq(messagingNumbers.id, input.id))
      .returning();
    ctx.setSubject("messagingNumber", updated!.id);
    return updated!;
  },
});

/**
 * Ask the provider whether each number can actually be used.
 *
 * §4.14: "an unregistered number silently filtered by carriers is the most
 * common way an SMS launch fails". A check that could not be made is recorded
 * as *unknown* rather than as healthy, because a green tick nobody verified is
 * that failure wearing a disguise.
 */
export const checkNumberHealth = defineService({
  name: "messaging.checkNumbers",
  summary: "Ask the provider whether each number can be used right now.",
  kind: "mutation",
  permission: "scoped",
  writeClass: "write",
  input: z.object({}),
  output: row({ checked: z.number().int(), problems: z.number().int() }),
  handler: async (_input, ctx) => {
    requirePerson(ctx.actor);
    const rows = await ctx.tx.select().from(messagingNumbers);
    let problems = 0;
    for (const number of rows) {
      const adapter = smsAdapter(number.provider);
      if (!adapter.available || !adapter.checkNumber) continue;
      const health = await adapter.checkNumber(number.providerRef);
      if (!health.usable) problems += 1;
      await ctx.tx
        .update(messagingNumbers)
        .set({
          healthy: health.usable,
          healthUnknown: health.unknown,
          healthProblem: health.problem,
          providerStatus: health.providerStatus,
          healthCheckedAt: new Date(),
          updatedAt: sql`now()`,
        })
        .where(eq(messagingNumbers.id, number.id));
    }
    return { checked: rows.length, problems };
  },
});

/**
 * Which number this send goes out on.
 *
 * By purpose, then default, then anything usable. A number that failed its last
 * health check is skipped: sending from a number carriers are filtering is how
 * a business discovers the problem from a customer rather than from a screen.
 */
async function senderFor(
  tx: Tx,
  purpose: (typeof NUMBER_PURPOSES)[number],
  needsMms: boolean,
): Promise<{ e164: string; provider: string } | null> {
  const rows = await tx
    .select()
    .from(messagingNumbers)
    .where(and(eq(messagingNumbers.active, true), eq(messagingNumbers.healthy, true)))
    .orderBy(desc(messagingNumbers.isDefault));
  const usable = rows.filter((number) => {
    const capabilities = number.capabilities;
    if (needsMms && capabilities.mms === false) return false;
    if (capabilities.sms === false) return false;
    // §4.14, C7.11: an unregistered number does not bounce. The carrier accepts
    // the message, bills for it, and drops it somewhere the sender cannot see —
    // so the check has to happen here, before sending, rather than by reading a
    // failure that never arrives.
    return maySend({
      country: number.country,
      kind: number.kind,
      registrations: number.registrations as RegistrationRecord[],
    }).allowed;
  });
  const preferred =
    usable.find((number) => number.purpose === purpose) ?? usable[0] ?? null;
  return preferred ? { e164: preferred.e164, provider: preferred.provider } : null;
}

export const sendSms = defineService({
  name: "messaging.sendSms",
  summary: "Send a text message and record what it cost.",
  kind: "mutation",
  permission: "scoped",
  writeClass: "message",
  input: z.object({
    contactId: id.optional(),
    to: z.string().trim().min(4).max(40),
    body: z.string().trim().min(1).max(4_000),
    purpose: z.enum(NUMBER_PURPOSES).default("transactional"),
    mediaUrls: z.array(z.string().url().max(2_000)).max(10).default([]),
    conversationId: id.optional(),
    /** Stable, so a retry does not send a second message. */
    idempotencyKey: z.string().trim().min(1).max(200),
  }),
  output: row({
    sent: z.boolean(),
    providerRef: z.string().nullable(),
    reason: z.string().nullable(),
    messageId: uuid.nullable(),
  }),
  handler: async (input, ctx) => {
    requirePerson(ctx.actor);
    const adapter = smsAdapter();
    if (!adapter.available) {
      // Refused rather than queued: C7.09's rule, for the same reason. A
      // message nobody can send is not a message waiting, it is a message that
      // will never arrive.
      throw new ServiceError("validation", adapter.status.message);
    }
    const sender = await senderFor(ctx.tx, input.purpose, input.mediaUrls.length > 0);
    if (!sender) {
      // Say *why*, not just "no". A blocked registration is a form somebody has
      // to fill in, and an owner told only "no usable number" will check the
      // credentials they already set up correctly.
      throw new ServiceError("validation", await whyNothingCanSend(ctx.tx));
    }

    let result;
    try {
      result = await adapter.send({
        to: input.to,
        from: sender.e164,
        title: "",
        body: input.body,
        mediaUrls: input.mediaUrls,
        deliveryId: input.idempotencyKey,
      });
    } catch (error) {
      // The provider's own words, already stripped of credentials by the
      // adapter boundary (§12), so an owner gets something they can act on.
      throw new ServiceError(
        "conflict",
        error instanceof AdapterError ? error.message : "The message could not be sent.",
      );
    }
    if (!result.delivers) {
      return {
        sent: false,
        providerRef: result.providerRef,
        reason: result.reason ?? "The provider would not take it.",
        messageId: null,
      };
    }

    // Into the one conversation model, so a text sits in the same thread as the
    // email and the form submission (C7.08).
    const recorded = (await recordOutbound(ctx, {
      contactId: input.contactId,
      to: input.to,
      body: input.body,
      conversationId: input.conversationId,
      providerRef: result.providerRef,
      segments: result.segments,
      costMinor: result.costMinor,
      costCurrency: result.costCurrency,
      mms: input.mediaUrls.length > 0,
    })) as { message: { id: string } };

    // Queued, not delivered: the carrier says what actually happened later.
    if (result.providerRef) {
      await ctx.call(getService("conversations.recordDelivery"), {
        messageId: recorded.message.id,
        status: "queued",
      });
    }
    return {
      sent: true,
      providerRef: result.providerRef,
      reason: null,
      messageId: recorded.message.id,
    };
  },
});

function recordOutbound(
  ctx: ServiceContext,
  input: {
    contactId?: string;
    to: string;
    body: string;
    conversationId?: string;
    providerRef: string | null;
    segments?: number;
    costMinor?: number;
    costCurrency?: string;
    mms: boolean;
  },
) {
  return ctx.call(getService("conversations.record"), {
    ...(input.contactId ? { contactId: input.contactId } : { phone: input.to }),
    ...(input.conversationId ? { conversationId: input.conversationId } : {}),
    direction: "outbound",
    channel: input.mms ? "mms" : "sms",
    body: input.body,
    sentBy: "user",
    providerRef: input.providerRef ?? undefined,
    segments: input.segments,
    costMinor: input.costMinor,
    costCurrency: input.costCurrency,
  });
}

/**
 * Everything a verified carrier callback means (C7.10).
 *
 * The HTTP boundary verifies the signature and hands over already-trusted
 * events; this decides what each one *is*. An inbound message goes through
 * `conversations.record` like every other channel, so it resolves to a contact
 * and threads with their email — which is the whole point of C7.08 existing
 * before this.
 */
export const applySmsEvents = defineService({
  name: "messaging.applySmsEvents",
  summary: "Record what the carrier said, and thread anything it delivered.",
  kind: "mutation",
  permission: "scoped",
  writeClass: "message",
  agentCallable: false,
  mcpExclude: true,
  input: z.object({
    events: z
      .array(
        z.object({
          id: z.string().max(200),
          kind: z.enum(["delivered", "failed", "received", "sent", "undelivered"]),
          providerRef: z.string().max(300),
          from: z.string().max(40).optional(),
          to: z.string().max(40).optional(),
          body: z.string().max(4_000).optional(),
          mediaUrls: z.array(z.string().max(2_000)).max(10).optional(),
          errorCode: z.string().max(50).optional(),
          errorText: z.string().max(500).optional(),
          occurredAt: z.string().max(60),
        }),
      )
      .max(100),
  }),
  output: row({ received: z.number().int(), reported: z.number().int() }),
  handler: async (input, ctx) => {
    requirePerson(ctx.actor);
    let received = 0;
    let reported = 0;

    for (const event of input.events) {
      if (event.kind === "received") {
        if (!event.from) continue;
        await ctx.call(getService("conversations.record"), {
          phone: event.from,
          direction: "inbound",
          channel: (event.mediaUrls?.length ?? 0) > 0 ? "mms" : "sms",
          body: event.body && event.body.length > 0 ? event.body : "(no text)",
          sentBy: "contact",
          // The carrier's id, so a redelivered webhook is a no-op (C7.08).
          providerRef: event.providerRef,
          occurredAt: new Date(event.occurredAt).toISOString(),
        });
        received += 1;
        continue;
      }

      // A status callback about something this instance sent. Found by the
      // provider reference the send recorded; a callback about a message this
      // instance has no record of is ignored rather than invented.
      const { messages } = await import("./schema");
      const [message] = await ctx.tx
        .select({ id: messages.id })
        .from(messages)
        .where(eq(messages.providerRef, event.providerRef))
        .limit(1);
      if (!message) continue;

      await ctx.call(getService("conversations.recordDelivery"), {
        messageId: message.id,
        status: event.kind,
        errorCode: event.errorCode ?? null,
        errorText: event.errorText ?? null,
        occurredAt: new Date(event.occurredAt).toISOString(),
      });
      reported += 1;
    }

    return { received, reported };
  },
});

/**
 * Why nothing can send, in words an owner can act on.
 *
 * The commonest reasons are different problems with different fixes — no
 * numbers at all, none healthy, or one blocked on a registration form — and a
 * single message covering all three sends people to check the thing that is
 * already right.
 */
export async function whyNothingCanSend(tx: Tx): Promise<string> {
  const rows = await tx.select().from(messagingNumbers);
  if (rows.length === 0) {
    return "No numbers are set up yet. Read your numbers in from your provider first.";
  }
  const active = rows.filter((number) => number.active);
  if (active.length === 0) {
    return "Every number is switched off. Turn one back on to send from it.";
  }
  const unhealthy = active.filter((number) => !number.healthy);
  if (unhealthy.length === active.length) {
    return (
      unhealthy[0]?.healthProblem ??
      "No number passed its last health check. Check them again, and fix what the provider reports."
    );
  }
  const blocked = active
    .filter((number) => number.healthy)
    .map((number) =>
      maySend({
        country: number.country,
        kind: number.kind,
        registrations: number.registrations as RegistrationRecord[],
      }),
    )
    .filter((verdict) => !verdict.allowed);
  if (blocked.length > 0 && blocked[0]?.problem) return blocked[0].problem;
  return "No usable number is set up to send from. Read your numbers in and check their health.";
}

/**
 * What each number still has to be registered for (§4.14, C7.11).
 *
 * The requirement is derived here rather than read from the row, so an owner
 * cannot clear it and a rule change reaches every existing number at once.
 */
export const numberRegistrations = defineService({
  name: "messaging.registrations",
  summary: "What each number must be registered for, and how far along it is.",
  kind: "query",
  permission: "scoped",
  input: z.object({}),
  output: listed(
    row({
      id: uuid,
      e164: z.string(),
      country: z.string().nullable(),
      kind: z.enum(NUMBER_KINDS),
      state: z.enum(REGISTRATION_STATES),
      canSend: z.boolean(),
      problem: z.string().nullable(),
      required: listed(
        row({
          kind: z.enum(REGISTRATION_KINDS),
          guidance: z.string(),
          state: z.enum(REGISTRATION_STATES),
          brand: z.string().nullable(),
          campaign: z.string().nullable(),
          providerRef: z.string().nullable(),
          reason: z.string().nullable(),
        }),
      ),
    }),
  ),
  handler: async (_input, ctx) => {
    const rows = await ctx.tx
      .select()
      .from(messagingNumbers)
      .orderBy(asc(messagingNumbers.e164));
    return rows.map((number) => {
      const stored = number.registrations as RegistrationRecord[];
      const shape = { country: number.country, kind: number.kind, registrations: stored };
      const verdict = maySend(shape);
      return {
        id: number.id,
        e164: number.e164,
        country: number.country,
        kind: number.kind,
        state: overallState(shape),
        canSend: verdict.allowed,
        problem: verdict.problem,
        required: requirementsFor(shape).map((requirement) => {
          const record = stored.find((one) => one.kind === requirement.kind);
          return {
            kind: requirement.kind,
            guidance: requirement.guidance,
            state: record?.state ?? "not_started",
            brand: record?.brand ?? null,
            campaign: record?.campaign ?? null,
            providerRef: record?.providerRef ?? null,
            reason: record?.reason ?? null,
          };
        }),
      };
    });
  },
});

/**
 * Record where a registration has got to.
 *
 * Owner-entered, because the platform cannot submit a 10DLC brand on somebody's
 * behalf — that is an identity claim with legal weight, made in the provider's
 * own console. What the platform *can* do is remember what was said and refuse
 * to send until it says approved, which is the whole of §4.14's rule.
 *
 * Recording a registration that is not required is refused: it would put a form
 * in front of an owner that nobody asked them to fill in.
 */
export const setRegistration = defineService({
  name: "messaging.setRegistration",
  summary: "Record how far a number's registration has got.",
  kind: "mutation",
  permission: "scoped",
  writeClass: "write",
  input: z.object({
    id,
    kind: z.enum(REGISTRATION_KINDS),
    state: z.enum(REGISTRATION_STATES),
    brand: z.string().trim().max(200).nullish(),
    campaign: z.string().trim().max(200).nullish(),
    providerRef: z.string().trim().max(200).nullish(),
    reason: z.string().trim().max(1_000).nullish(),
  }),
  output: numberRow,
  handler: async (input, ctx) => {
    requirePerson(ctx.actor);
    const [number] = await ctx.tx
      .select()
      .from(messagingNumbers)
      .where(eq(messagingNumbers.id, input.id))
      .limit(1);
    if (!number) throw new ServiceError("not_found", "That number is not here.");

    const required = requirementsFor({ country: number.country, kind: number.kind });
    if (!required.some((requirement) => requirement.kind === input.kind)) {
      throw new ServiceError(
        "validation",
        "That registration is not needed for this number, so there is nothing to record.",
      );
    }

    const now = new Date().toISOString();
    const stored = (number.registrations as RegistrationRecord[]).filter(
      (one) => one.kind !== input.kind,
    );
    const previous = (number.registrations as RegistrationRecord[]).find(
      (one) => one.kind === input.kind,
    );
    stored.push({
      kind: input.kind,
      state: input.state,
      brand: input.brand ?? previous?.brand ?? null,
      campaign: input.campaign ?? previous?.campaign ?? null,
      providerRef: input.providerRef ?? previous?.providerRef ?? null,
      // The moment it was first submitted survives later updates: "how long has
      // this been in review" is the question an owner actually asks.
      submittedAt:
        input.state === "submitted" && !previous?.submittedAt
          ? now
          : (previous?.submittedAt ?? null),
      decidedAt:
        input.state === "approved" || input.state === "rejected"
          ? now
          : (previous?.decidedAt ?? null),
      // A rejection with no reason is unactionable, so a reason given once is
      // kept until the state changes away from rejected.
      reason: input.state === "rejected" ? (input.reason ?? previous?.reason ?? null) : null,
    });

    const [updated] = await ctx.tx
      .update(messagingNumbers)
      .set({ registrations: stored, updatedAt: sql`now()` })
      .where(eq(messagingNumbers.id, input.id))
      .returning();
    ctx.setSubject("messagingNumber", updated!.id);
    ctx.queueEvent("messaging.registrationChanged", {
      id: updated!.id,
      kind: input.kind,
      state: input.state,
    });
    return updated!;
  },
});

export default [
  listMessagingNumbers,
  importMessagingNumbers,
  updateMessagingNumber,
  checkNumberHealth,
  numberRegistrations,
  setRegistration,
  sendSms,
  applySmsEvents,
];
