// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// The optional front-site assistant (MASTER.md §31, C9.21).
//
// §31 asks for an assistant that is "off by default, enabled by a setting in
// admin", picks its provider, model and key through `adapters/ai`, acts only
// inside owner-granted scopes, and falls back to nothing at all when it is not
// configured. Four properties carry that, and each one is a decision worth
// knowing about.
//
// **Off is a first-class answer, not an error.** `assistant.answer` on an
// instance that never switched this on returns `{ status: "off" }` before it
// reads a session, touches a provider or writes a row. The chat widget carries
// on being what C7.15 built: a visitor types, a person replies. An assistant
// that cannot be switched off, or that turns a public page into a 500 when it
// is, has failed at the one thing §31 asks of it first.
//
// **Nothing is decided after something is written.** Every refusal — spent
// budget, hourly cap, conversation cap, unpriced model, missing key — is read
// before any insert. A failed statement aborts the whole Postgres transaction,
// so a module that discovered its budget was gone by trying to spend it could
// not then record that it had refused. And a refusal is *returned*, never
// thrown: a throw after writing the refusal row would roll that row back, and
// the refusal would leave no trace on the one screen an owner goes to when the
// assistant has gone quiet.
//
// **The scope gate is outside the model.** `actions.ts` holds the catalogue —
// the only services this assistant can ever reach — and the grants say which
// of them an owner has switched on. The model chooses whether to ask; it never
// chooses what is possible, and it never supplies the arguments that say
// *whose* quote request this is.
//
// **The transcript stays on the spine.** The assistant answers by calling
// `messaging.sendAssistantChatMessage`, so its words are ordinary messages on
// the contact's canonical conversation, visible in the shared inbox, part of
// the contact's history, escalatable to a person. This module stores what an
// answer cost and what was refused. It does not store a second copy of the
// conversation, because §31's "every conversation lands on the spine" is
// exactly the sentence a private transcript table would break.
import { createHash } from "node:crypto";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { listed, okResult, row, timestamp, uuid } from "@/core/contract";
import { contacts } from "@/core/contacts/schema";
import { businessProfile } from "@/core/settings/schema";
import { messages } from "@/core/messaging/schema";
import { sessionForToken } from "@/core/messaging/chat";
import { turnCostCents } from "@/core/agents/pricing";
import {
  defineService,
  getService,
  ServiceError,
  type ServiceContext,
  type Tx,
} from "@/core/service";
import {
  ASSISTANT_ACTIONS,
  actionService,
  runAction,
  verdictFor,
  type AssistantAction,
} from "./actions";
import {
  allowance,
  assistantPrice,
  estimateTurnCents,
  periodSpend,
  refusalDetail,
  refusalOutcome,
  repliesInLastHour,
  repliesOnConversation,
} from "./limits";
import {
  ASSISTANT_RESPONSE_SCHEMA,
  buildInput,
  buildSystemPrompt,
  parseReply,
  type TranscriptLine,
} from "./prompt";
import { assistantAdapter, credentialPresent, credentialRefFor } from "./provider";
import {
  ASSISTANT_PROVIDERS,
  ASSISTANT_SPEND_PERIODS,
  ASSISTANT_TURN_OUTCOMES,
  type AssistantTurnOutcome,
} from "./contract";
import {
  assistantChunks,
  assistantScopeGrants,
  assistantSettings,
  assistantTurns,
  knowledgeEntries,
  type AssistantSettings,
} from "./schema";
import { collectDocuments } from "./corpus";
import { embedText } from "./embed";
import { retrieveNotes } from "./retrieve";
import { KNOWLEDGE_KINDS } from "./contract";

/** How much of the conversation the model is shown. Bounded, so cost is too. */
const TRANSCRIPT_LIMIT = 20;
const SETTINGS_ID = 1;

/**
 * The settings, or what they would be.
 *
 * A read never writes the singleton into existence: an instance that has never
 * opened the assistant screen should have no assistant row, and "off, no
 * provider, no budget" is the honest answer for it. The row appears the first
 * time an owner saves one.
 */
async function readSettings(tx: Tx): Promise<AssistantSettings> {
  const [found] = await tx
    .select()
    .from(assistantSettings)
    .where(eq(assistantSettings.id, SETTINGS_ID))
    .limit(1);
  if (found) return found;
  const now = new Date();
  return {
    id: SETTINGS_ID,
    enabled: false,
    provider: "none",
    model: null,
    baseUrl: null,
    credentialRef: null,
    inputCentsPerMillion: null,
    outputCentsPerMillion: null,
    maxOutputTokens: 700,
    displayName: null,
    spendCapCents: 0,
    spendPeriod: "month",
    repliesPerConversation: 20,
    repliesPerHour: 60,
    lastError: null,
    createdAt: now,
    updatedAt: now,
  };
}

/** Catalogue actions this instance can actually offer, and the owner has. */
async function grantedActions(tx: Tx): Promise<AssistantAction[]> {
  const rows = await tx
    .select({ action: assistantScopeGrants.action })
    .from(assistantScopeGrants)
    .where(eq(assistantScopeGrants.enabled, true));
  const granted = new Set(rows.map((entry) => entry.action));
  return ASSISTANT_ACTIONS.filter(
    (entry) => granted.has(entry.id) && actionService(entry) !== undefined,
  );
}

async function recordTurn(
  ctx: ServiceContext,
  values: {
    conversationId: string;
    chatSessionId: string;
    messageId: string;
    outcome: AssistantTurnOutcome;
    detail?: string | null;
    provider?: string | null;
    model?: string | null;
    inputTokens?: number;
    outputTokens?: number;
    costCents?: number;
    action?: string | null;
    actionAllowed?: boolean | null;
    startedAt: number;
  },
): Promise<void> {
  await ctx.tx.insert(assistantTurns).values({
    conversationId: values.conversationId,
    chatSessionId: values.chatSessionId,
    messageId: values.messageId,
    outcome: values.outcome,
    detail: values.detail?.slice(0, 1_000) ?? null,
    provider: values.provider ?? null,
    model: values.model ?? null,
    inputTokens: values.inputTokens ?? 0,
    outputTokens: values.outputTokens ?? 0,
    costCents: values.costCents ?? 0,
    action: values.action ?? null,
    actionAllowed: values.actionAllowed ?? null,
    latencyMs: Date.now() - values.startedAt,
  });
}

/** Kept current so the admin can say what is wrong without a visitor's help. */
async function noteError(tx: Tx, message: string | null): Promise<void> {
  await tx
    .update(assistantSettings)
    .set({ lastError: message?.slice(0, 1_000) ?? null })
    .where(eq(assistantSettings.id, SETTINGS_ID));
}

const settingsRow = row({
  enabled: z.boolean(),
  provider: z.enum(ASSISTANT_PROVIDERS),
  model: z.string().nullable(),
  baseUrl: z.string().nullable(),
  /** The *name* of an environment variable. Never its value (§17). */
  credentialRef: z.string().nullable(),
  credentialPresent: z.boolean(),
  inputCentsPerMillion: z.number().nullable(),
  outputCentsPerMillion: z.number().nullable(),
  maxOutputTokens: z.number(),
  displayName: z.string().nullable(),
  spendCapCents: z.number(),
  spendPeriod: z.enum(ASSISTANT_SPEND_PERIODS),
  repliesPerConversation: z.number(),
  repliesPerHour: z.number(),
  lastError: z.string().nullable(),
  priced: z.boolean(),
  spentCents: z.number(),
  remainingCents: z.number(),
  repliesThisHour: z.number(),
  ready: z.boolean(),
});

async function presentSettings(tx: Tx, settings: AssistantSettings) {
  const price = assistantPrice(settings);
  const [spentCents, repliesThisHour] = await Promise.all([
    periodSpend(tx, settings.spendPeriod),
    repliesInLastHour(tx),
  ]);
  const resolution = assistantAdapter(settings);
  return {
    enabled: settings.enabled,
    provider: settings.provider,
    model: settings.model,
    baseUrl: settings.baseUrl,
    credentialRef: credentialRefFor(settings),
    credentialPresent: credentialPresent(settings),
    inputCentsPerMillion: settings.inputCentsPerMillion,
    outputCentsPerMillion: settings.outputCentsPerMillion,
    maxOutputTokens: settings.maxOutputTokens,
    displayName: settings.displayName,
    spendCapCents: settings.spendCapCents,
    spendPeriod: settings.spendPeriod,
    repliesPerConversation: settings.repliesPerConversation,
    repliesPerHour: settings.repliesPerHour,
    lastError: settings.lastError,
    priced: price !== null,
    spentCents,
    remainingCents: Math.max(0, settings.spendCapCents - spentCents),
    repliesThisHour,
    ready:
      settings.enabled &&
      "adapter" in resolution &&
      price !== null &&
      settings.spendCapCents > 0,
  };
}

export const settings = defineService({
  name: "assistant.settings",
  summary: "How the front-site assistant is configured, and what it has spent.",
  kind: "query",
  permission: "scoped",
  input: z.object({}),
  output: settingsRow,
  handler: async (_input, ctx) => presentSettings(ctx.tx, await readSettings(ctx.tx)),
});

export const updateSettings = defineService({
  name: "assistant.updateSettings",
  summary: "Choose the assistant's provider, model, key variable, limits and off switch.",
  kind: "mutation",
  permission: "scoped",
  writeClass: "write",
  input: z.object({
    enabled: z.boolean(),
    provider: z.enum(ASSISTANT_PROVIDERS),
    model: z.string().trim().min(1).max(200).nullish(),
    baseUrl: z.string().trim().url().max(500).nullish(),
    credentialRef: z
      .string()
      .trim()
      .regex(/^[A-Z][A-Z0-9_]*$/, "An environment variable name is capitals, digits and underscores.")
      .max(100)
      .nullish(),
    inputCentsPerMillion: z.number().int().min(0).max(1_000_000).nullish(),
    outputCentsPerMillion: z.number().int().min(0).max(1_000_000).nullish(),
    maxOutputTokens: z.number().int().min(64).max(4_000).default(700),
    displayName: z.string().trim().min(1).max(80).nullish(),
    spendCapCents: z.number().int().min(0).max(100_000_000).default(0),
    spendPeriod: z.enum(ASSISTANT_SPEND_PERIODS).default("month"),
    repliesPerConversation: z.number().int().min(0).max(500).default(20),
    repliesPerHour: z.number().int().min(0).max(5_000).default(60),
  }),
  output: settingsRow,
  handler: async (input, ctx) => {
    const model = input.model ?? null;
    if (input.provider !== "none" && !model) {
      throw new ServiceError(
        "validation",
        "Choose a model as well as a provider — the assistant will not guess one and bill you for the guess.",
      );
    }
    // Switching on with no budget would be a setting that reads as "yes" and
    // behaves as "no" at the first question. Say so here instead.
    if (input.enabled && input.provider !== "none" && input.spendCapCents <= 0) {
      throw new ServiceError(
        "validation",
        "Set a spending limit before switching the assistant on. Every answer costs money, and a limit of nothing means it can never answer.",
      );
    }
    const values = {
      enabled: input.enabled,
      provider: input.provider,
      model: input.provider === "none" ? null : model,
      baseUrl: input.baseUrl ?? null,
      credentialRef: input.credentialRef ?? null,
      inputCentsPerMillion: input.inputCentsPerMillion ?? null,
      outputCentsPerMillion: input.outputCentsPerMillion ?? null,
      maxOutputTokens: input.maxOutputTokens,
      displayName: input.displayName ?? null,
      spendCapCents: input.spendCapCents,
      spendPeriod: input.spendPeriod,
      repliesPerConversation: input.repliesPerConversation,
      repliesPerHour: input.repliesPerHour,
      // A saved change is a fresh start: the old complaint described a
      // configuration that no longer exists.
      lastError: null,
    };
    const [saved] = await ctx.tx
      .insert(assistantSettings)
      .values({ id: SETTINGS_ID, ...values })
      .onConflictDoUpdate({ target: assistantSettings.id, set: values })
      .returning();
    ctx.setSubject("assistant", String(SETTINGS_ID));
    return presentSettings(ctx.tx, saved!);
  },
});

const scopeRow = row({
  action: z.string(),
  service: z.string(),
  writes: z.boolean(),
  description: z.string(),
  enabled: z.boolean(),
  /** False when the module that owns the service is not installed here. */
  available: z.boolean(),
});

export const scopes = defineService({
  name: "assistant.scopes",
  summary: "Every action the assistant could be allowed to take, and whether it is.",
  kind: "query",
  permission: "scoped",
  input: z.object({}),
  output: listed(scopeRow),
  handler: async (_input, ctx) => {
    const rows = await ctx.tx
      .select({
        action: assistantScopeGrants.action,
        enabled: assistantScopeGrants.enabled,
      })
      .from(assistantScopeGrants);
    const granted = new Map(rows.map((entry) => [entry.action, entry.enabled]));
    return ASSISTANT_ACTIONS.map((entry) => ({
      action: entry.id,
      service: entry.service,
      writes: entry.writes,
      description: entry.description,
      enabled: granted.get(entry.id) ?? false,
      available: actionService(entry) !== undefined,
    }));
  },
});

export const setScope = defineService({
  name: "assistant.setScope",
  summary: "Grant or withdraw one thing the assistant is allowed to do.",
  kind: "mutation",
  permission: "scoped",
  writeClass: "write",
  input: z.object({
    action: z.string().trim().min(1).max(100),
    enabled: z.boolean(),
  }),
  output: okResult,
  handler: async (input, ctx) => {
    // The catalogue is the ceiling. An owner cannot grant something the
    // platform does not offer, so a stale form or a hand-made request cannot
    // widen what the assistant can reach.
    if (!ASSISTANT_ACTIONS.some((entry) => entry.id === input.action)) {
      throw new ServiceError(
        "not_found",
        `"${input.action}" is not something the assistant can be allowed to do.`,
      );
    }
    await ctx.tx
      .insert(assistantScopeGrants)
      .values({ action: input.action, enabled: input.enabled })
      .onConflictDoUpdate({
        target: assistantScopeGrants.action,
        set: { enabled: input.enabled, updatedAt: sql`now()` },
      });
    ctx.setSubject("assistant", input.action);
    return { ok: true as const };
  },
});

const turnRow = row({
  id: uuid,
  conversationId: uuid,
  outcome: z.enum(ASSISTANT_TURN_OUTCOMES),
  detail: z.string().nullable(),
  model: z.string().nullable(),
  costCents: z.number(),
  action: z.string().nullable(),
  actionAllowed: z.boolean().nullable(),
  createdAt: timestamp,
});

export const turns = defineService({
  name: "assistant.turns",
  summary: "Recent answers and refusals, so an owner can see why it went quiet.",
  kind: "query",
  permission: "scoped",
  input: z.object({ limit: z.number().int().min(1).max(200).default(50) }),
  output: listed(turnRow),
  handler: async (input, ctx) =>
    ctx.tx
      .select({
        id: assistantTurns.id,
        conversationId: assistantTurns.conversationId,
        outcome: assistantTurns.outcome,
        detail: assistantTurns.detail,
        model: assistantTurns.model,
        costCents: assistantTurns.costCents,
        action: assistantTurns.action,
        actionAllowed: assistantTurns.actionAllowed,
        createdAt: assistantTurns.createdAt,
      })
      .from(assistantTurns)
      .orderBy(desc(assistantTurns.createdAt))
      .limit(input.limit),
});

const answerResult = row({
  status: z.enum([
    "off",
    "nothing_to_answer",
    "already_attempted",
    "refused",
    "unconfigured",
    "failed",
    "answered",
  ]),
  /** What the visitor was told, when they were told anything. */
  reply: z.string().nullable(),
  /** The catalogue action taken, when one was. */
  action: z.string().nullable(),
});

const OFF = { status: "off" as const, reply: null, action: null };

export const answer = defineService({
  name: "assistant.answer",
  summary: "Answer the newest visitor message in one site chat, if the assistant is on.",
  kind: "mutation",
  permission: "public",
  writeClass: "message",
  input: z.object({ token: z.string().trim().min(32).max(200) }),
  rateLimit: {
    // A coarse gate in front of everything, consumed before the transaction
    // opens. The owner's own limits are finer and live in the handler; this
    // one exists so a script cannot make ten thousand transactions open.
    limit: 30,
    windowSeconds: 5 * 60,
    // Hashed, because a rate-limit subject is stored in a table and a chat
    // bearer is a credential. `messaging.postSiteChat` does the same.
    subject: (input) => createHash("sha256").update(input.token, "utf8").digest("hex"),
    message: "Too many assistant requests from this chat. Wait a few minutes.",
  },
  output: answerResult,
  handler: async (input, ctx) => {
    const startedAt = Date.now();
    const current = await readSettings(ctx.tx);
    // The off fallback, first and cheapest: no provider, no session lookup, no
    // row. An instance that never switched this on is an instance where this
    // service does nothing at all.
    if (!current.enabled) return OFF;

    const session = await sessionForToken(ctx.tx, input.token);

    const [last] = await ctx.tx
      .select({
        id: messages.id,
        direction: messages.direction,
        contactId: messages.contactId,
        body: messages.body,
      })
      .from(messages)
      .where(eq(messages.chatSessionId, session.id))
      .orderBy(desc(messages.occurredAt), desc(messages.createdAt))
      .limit(1);
    if (!last || last.direction !== "inbound") {
      return { status: "nothing_to_answer" as const, reply: null, action: null };
    }

    // One attempt per visitor message, refusals included. A visitor clicking
    // again must not spend the next penny of a budget that ran out a second
    // ago; the way to another answer is another question.
    const [existing] = await ctx.tx
      .select({ id: assistantTurns.id })
      .from(assistantTurns)
      .where(eq(assistantTurns.messageId, last.id))
      .limit(1);
    if (existing) {
      return { status: "already_attempted" as const, reply: null, action: null };
    }

    const base = {
      conversationId: session.conversationId,
      chatSessionId: session.id,
      messageId: last.id,
      startedAt,
    };

    const [business] = await ctx.tx
      .select({ name: businessProfile.name, tagline: businessProfile.tagline })
      .from(businessProfile)
      .limit(1);

    // Newest first, then reversed. Taking the *oldest* twenty would hide the
    // question being answered the moment a conversation ran long, which is
    // exactly when a bounded transcript starts to matter.
    const history = await ctx.tx
      .select({
        direction: messages.direction,
        channel: messages.channel,
        body: messages.body,
      })
      .from(messages)
      .where(
        and(
          eq(messages.chatSessionId, session.id),
          inArray(messages.channel, ["chat", "assistant"]),
        ),
      )
      .orderBy(desc(messages.occurredAt))
      .limit(TRANSCRIPT_LIMIT);
    history.reverse();

    const transcript: TranscriptLine[] = history.map((line) => ({
      from:
        line.direction === "inbound"
          ? "visitor"
          : line.channel === "assistant"
            ? "assistant"
            : "business",
      body: line.body,
    }));

    const offered = await grantedActions(ctx.tx);
    const businessName = business?.name ?? "this business";
    const notes = await retrieveNotes(ctx.tx, last.body, session.locale);
    const promptInput = {
      businessName,
      tagline: business?.tagline ?? null,
      assistantName: current.displayName?.trim() || businessName,
      locale: session.locale,
      actions: offered,
      transcript,
      notes,
    };
    const system = buildSystemPrompt(promptInput);
    const asked = buildInput(promptInput);

    // Everything that can refuse is decided here, from reads, before a single
    // insert — see the file header for why that ordering is not optional.
    const price = assistantPrice(current);
    const estimateCents = price
      ? estimateTurnCents(price, `${system}\n${asked}`, current.maxOutputTokens)
      : 0;
    const [spentCents, repliesThisHour, repliesHere] = await Promise.all([
      periodSpend(ctx.tx, current.spendPeriod),
      repliesInLastHour(ctx.tx),
      repliesOnConversation(ctx.tx, session.conversationId),
    ]);
    const verdict = allowance({
      settings: current,
      spentCents,
      repliesThisHour,
      repliesHere,
      price,
      estimateCents,
    });
    if (!verdict.allowed) {
      const detail = refusalDetail(verdict.refusal);
      await recordTurn(ctx, {
        ...base,
        outcome: refusalOutcome(verdict.refusal),
        detail,
        model: current.model,
        provider: current.provider,
      });
      ctx.setSubject("conversation", session.conversationId);
      ctx.queueEvent("assistant.refused", {
        conversationId: session.conversationId,
        reason: verdict.refusal.kind,
      });
      // Returned, not thrown. A throw would roll back the row that is the
      // only evidence this happened.
      return { status: "refused" as const, reply: null, action: null };
    }

    const resolution = assistantAdapter(current);
    if ("unconfigured" in resolution) {
      await recordTurn(ctx, {
        ...base,
        outcome: "unconfigured",
        detail: resolution.unconfigured,
        provider: current.provider,
        model: current.model,
      });
      await noteError(ctx.tx, resolution.unconfigured);
      ctx.setSubject("conversation", session.conversationId);
      return { status: "unconfigured" as const, reply: null, action: null };
    }

    let generated;
    try {
      generated = await resolution.adapter.generate({
        purpose: "site-assistant",
        system,
        input: asked,
        maxOutputTokens: current.maxOutputTokens,
        responseSchema: ASSISTANT_RESPONSE_SCHEMA,
        idempotencyKey: `assistant.answer:${last.id}`,
      });
    } catch (error) {
      // An adapter failure is an HTTP failure, not a database one, so this
      // transaction is still healthy and the record of what happened commits.
      const detail = error instanceof Error ? error.message : "The model could not be reached.";
      await recordTurn(ctx, {
        ...base,
        outcome: "failed",
        detail,
        provider: current.provider,
        model: current.model,
      });
      await noteError(ctx.tx, detail);
      ctx.setSubject("conversation", session.conversationId);
      return { status: "failed" as const, reply: null, action: null };
    }

    const costCents = turnCostCents(verdict.price, generated.usage);
    const usage = {
      provider: generated.provider,
      model: generated.model,
      inputTokens: generated.usage.inputTokens,
      outputTokens: generated.usage.outputTokens,
      costCents,
    };

    const parsed = parseReply(generated.structured, generated.text);
    if (!parsed) {
      // Paid for and unusable. The cost is still recorded: a budget that only
      // counts the answers an owner liked is not a budget.
      await recordTurn(ctx, {
        ...base,
        ...usage,
        outcome: "failed",
        detail: "The model did not answer in a shape this assistant can use.",
      });
      ctx.setSubject("conversation", session.conversationId);
      return { status: "failed" as const, reply: null, action: null };
    }

    // The words go out first. An action that escalates marks the thread for a
    // person, and recording the reply afterwards would clear the very flag the
    // escalation just raised.
    await ctx.callAsSystem(getService("messaging.sendAssistantChatMessage"), {
      conversationId: session.conversationId,
      message: parsed.reply,
    });

    let takenAction: string | null = null;
    let actionAllowed: boolean | null = null;
    let actionDetail: string | null = null;
    if (parsed.actionId !== undefined) {
      const [contact] = await ctx.tx
        .select({ name: contacts.name, email: contacts.email })
        .from(contacts)
        .where(eq(contacts.id, session.contactId))
        .limit(1);
      const decision = verdictFor(
        parsed.actionId,
        parsed.actionArguments,
        new Set(offered.map((entry) => entry.id)),
        {
          conversationId: session.conversationId,
          // From the session's own contact, never from the model. This is what
          // stops a chat window from filing a quote request as somebody else.
          contactName: contact?.name ?? "Website visitor",
          contactEmail: contact?.email ?? "",
          question: transcript.at(-1)?.body ?? "",
        },
      );
      actionAllowed = decision.allowed;
      if (decision.allowed) {
        try {
          await runAction(ctx, decision.entry, decision.input);
          takenAction = decision.entry.id;
        } catch (error) {
          // A domain refusal from the service that owns the action — the chat
          // ended between the model call and this line, say. Recorded, not
          // raised: the visitor already has their answer. Anything that is not
          // a ServiceError may well have left this transaction unusable, so it
          // propagates rather than being written over.
          if (!(error instanceof ServiceError)) throw error;
          actionAllowed = false;
          actionDetail = error.message;
        }
      } else {
        actionDetail = decision.reason;
      }
    }

    await recordTurn(ctx, {
      ...base,
      ...usage,
      outcome: actionAllowed === false ? "refused_scope" : "answered",
      detail: actionDetail,
      action: parsed.actionId ?? null,
      actionAllowed,
    });
    if (current.lastError) await noteError(ctx.tx, null);
    ctx.setSubject("conversation", session.conversationId);
    ctx.queueEvent("assistant.replied", {
      conversationId: session.conversationId,
      contactId: last.contactId,
      action: takenAction,
    });
    return {
      status: "answered" as const,
      reply: parsed.reply,
      action: takenAction,
    };
  },
});

const knowledgeRow = row({
  id: uuid,
  locale: z.string(),
  kind: z.enum(KNOWLEDGE_KINDS),
  title: z.string(),
  body: z.string(),
  enabled: z.boolean(),
  updatedAt: timestamp,
});

export const saveKnowledge = defineService({
  name: "assistant.saveKnowledge",
  writeClass: "write",
  summary: "Create or change an owner-written fact the assistant may quote.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({
    id: uuid.optional(),
    locale: z.string().trim().min(2).max(20).default("en"),
    kind: z.enum(KNOWLEDGE_KINDS),
    title: z.string().trim().min(1).max(200),
    body: z.string().trim().min(1).max(4_000),
    enabled: z.boolean().default(true),
  }),
  output: knowledgeRow,
  handler: async (input, ctx) => {
    const values = {
      locale: input.locale,
      kind: input.kind,
      title: input.title,
      body: input.body,
      enabled: input.enabled,
    };
    const saved = input.id
      ? (
          await ctx.tx
            .update(knowledgeEntries)
            .set({ ...values, updatedAt: new Date() })
            .where(eq(knowledgeEntries.id, input.id))
            .returning()
        )[0]
      : (await ctx.tx.insert(knowledgeEntries).values(values).returning())[0];
    if (!saved) throw new ServiceError("not_found", "There is no such knowledge entry.");
    ctx.setSubject("knowledge_entry", saved.id);
    await ctx.tx
      .delete(assistantChunks)
      .where(
        and(eq(assistantChunks.sourceType, "knowledge"), eq(assistantChunks.sourceId, saved.id)),
      );
    if (saved.enabled) {
      const embedding = embedText(`${saved.title}\n${saved.body}`);
      await ctx.tx
        .insert(assistantChunks)
        .values({
          sourceType: "knowledge",
          sourceId: saved.id,
          locale: saved.locale,
          title: saved.title,
          body: `${saved.title}\n${saved.body}`,
          embedding,
        })
        .onConflictDoUpdate({
          target: [
            assistantChunks.sourceType,
            assistantChunks.sourceId,
            assistantChunks.locale,
          ],
          set: {
            title: saved.title,
            body: `${saved.title}\n${saved.body}`,
            embedding,
            updatedAt: new Date(),
          },
        });
    }
    return saved;
  },
});

export const knowledgeList = defineService({
  name: "assistant.knowledgeList",
  summary: "Owner-written facts, Q&As and policies the assistant may quote.",
  kind: "query",
  permission: "scoped",
  input: z.object({}),
  output: listed(knowledgeRow),
  handler: (_input, ctx) =>
    ctx.tx
      .select()
      .from(knowledgeEntries)
      .orderBy(desc(knowledgeEntries.updatedAt)),
});

export const deleteKnowledge = defineService({
  name: "assistant.deleteKnowledge",
  writeClass: "write",
  summary: "Remove an owner-written knowledge entry.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({ id: uuid }),
  output: row({ id: uuid }),
  handler: async (input, ctx) => {
    const [removed] = await ctx.tx
      .delete(knowledgeEntries)
      .where(eq(knowledgeEntries.id, input.id))
      .returning({ id: knowledgeEntries.id });
    if (!removed) throw new ServiceError("not_found", "There is no such knowledge entry.");
    await ctx.tx
      .delete(assistantChunks)
      .where(
        and(eq(assistantChunks.sourceType, "knowledge"), eq(assistantChunks.sourceId, input.id)),
      );
    return removed;
  },
});

/**
 * Rebuild the retrieval index from published content and knowledge rows.
 *
 * Scoped so an owner can press the button; a job and event listeners call it
 * as system. Full rebuild is the honest answer at this scale: tens of pages,
 * not millions of rows.
 */
export const reindex = defineService({
  name: "assistant.reindex",
  writeClass: "write",
  summary: "Rebuild the assistant's retrieval index from published content.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({}),
  output: row({ chunks: z.number().int() }),
  handler: async (_input, ctx) => {
    const docs = await collectDocuments(ctx.tx);
    const keep = new Set(
      docs.map((doc) => `${doc.sourceType}:${doc.sourceId}:${doc.locale}`),
    );
    for (const doc of docs) {
      const embedding = embedText(`${doc.title}\n${doc.body}`);
      await ctx.tx
        .insert(assistantChunks)
        .values({
          sourceType: doc.sourceType,
          sourceId: doc.sourceId,
          locale: doc.locale,
          title: doc.title,
          body: doc.body,
          embedding,
        })
        .onConflictDoUpdate({
          target: [
            assistantChunks.sourceType,
            assistantChunks.sourceId,
            assistantChunks.locale,
          ],
          set: {
            title: doc.title,
            body: doc.body,
            embedding,
            updatedAt: new Date(),
          },
        });
    }
    const existing = await ctx.tx
      .select({
        id: assistantChunks.id,
        sourceType: assistantChunks.sourceType,
        sourceId: assistantChunks.sourceId,
        locale: assistantChunks.locale,
      })
      .from(assistantChunks);
    const gone = existing
      .filter((row) => !keep.has(`${row.sourceType}:${row.sourceId}:${row.locale}`))
      .map((row) => row.id);
    if (gone.length > 0) {
      await ctx.tx.delete(assistantChunks).where(inArray(assistantChunks.id, gone));
    }
    return { chunks: docs.length };
  },
});

/** Publish, unpublish, catalog or location change: rebuild the index. */
export async function onContentChanged(): Promise<void> {
  await reindex.call({}, { kind: "system" });
}

export default [
  settings,
  updateSettings,
  scopes,
  setScope,
  turns,
  answer,
  saveKnowledge,
  knowledgeList,
  deleteKnowledge,
  reindex,
];
