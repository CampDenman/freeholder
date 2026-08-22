// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// The quote pipeline (MASTER.md §4.3, C6.12).
//
//   draft → sent → viewed → (negotiating ⇄) → accepted | declined | expired
//
// Three rules carry this file.
//
// **A quote is a sequence of offers, not one offer that gets edited.** Line
// items belong to a version; revising writes a new set and leaves the old one
// readable. "But you quoted me £4,000" is then answerable from the database
// rather than from anybody's memory — which is the entire reason a quote is a
// document rather than a message.
//
// **Editing a live quote is not allowed.** Once it is with the customer, the
// only way to change it is a revision, which is visible to them. A silently
// edited price is the failure this design exists to make impossible.
//
// **Acceptance freezes what was accepted.** Optional lines make the total a
// function of what the customer chose, so the snapshot is taken at the moment
// they say yes; recomputing later from rows somebody has since revised would
// answer a different question.
import { z } from "zod";
import { randomBytes } from "node:crypto";
import { and, asc, desc, eq, inArray, lte, sql } from "drizzle-orm";
import { listed, row, timestamp, uuid } from "@/core/contract";
import { contacts } from "@/core/contacts/schema";
import { registerContactReference } from "@/core/contacts/service";
import { registerContactPrivacySource } from "@/core/privacy/service";
import {
  defineService,
  ServiceError,
  type Actor,
  type ServiceContext,
} from "@/core/service";
import { extendMinor, sumMinor } from "@/modules/invoicing/money";
import {
  OPEN_STATUSES,
  QUOTE_AUTHORS,
  QUOTE_STATUSES,
  quoteItems,
  quoteMessages,
  quoteSequences,
  quotes,
} from "./schema";

const id = z.string().uuid();
const currency = z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/);

function requirePerson(actor: Actor): void {
  if (actor.kind !== "user") {
    throw new ServiceError("permission", "Sign in to manage quotes.");
  }
}

const itemRow = row({
  id: uuid,
  quoteId: uuid,
  version: z.number().int(),
  description: z.string(),
  quantityMicros: z.number().int(),
  unitPriceMinor: z.number().int(),
  optional: z.boolean(),
  selected: z.boolean(),
  sortOrder: z.number().int(),
});

const quoteRow = row({
  id: uuid,
  contactId: uuid,
  reference: z.string(),
  title: z.string(),
  status: z.enum(QUOTE_STATUSES),
  version: z.number().int(),
  currency: z.string(),
  validUntil: timestamp.nullable(),
  depositMinor: z.number().int().nullable(),
  terms: z.string().nullable(),
  notes: z.string().nullable(),
  sentAt: timestamp.nullable(),
  firstViewedAt: timestamp.nullable(),
  acceptedAt: timestamp.nullable(),
  declinedAt: timestamp.nullable(),
  declineReason: z.string().nullable(),
});

const totalsShape = z.object({
  /** Everything the customer must take. */
  requiredMinor: z.number().int(),
  /** Optional lines they have currently chosen. */
  optionalSelectedMinor: z.number().int(),
  /** Optional lines still on the table. */
  optionalAvailableMinor: z.number().int(),
  totalMinor: z.number().int(),
});

/**
 * What this set of lines comes to.
 *
 * Three figures rather than one, because "what does it cost" has three honest
 * answers on a quote with optional extras: what they must take, what they have
 * chosen, and what is still on the table. Collapsing them into a total is what
 * makes an owner wonder why the number moved.
 */
function totalsFor(
  lines: readonly {
    quantityMicros: number;
    unitPriceMinor: number;
    optional: boolean;
    selected: boolean;
  }[],
): z.infer<typeof totalsShape> {
  const extend = (line: (typeof lines)[number]) =>
    extendMinor(line.unitPriceMinor, line.quantityMicros);
  const requiredMinor = sumMinor(
    lines.filter((line) => !line.optional).map(extend),
    "Quote total",
  );
  const optionalSelectedMinor = sumMinor(
    lines.filter((line) => line.optional && line.selected).map(extend),
    "Quote options",
  );
  const optionalAvailableMinor = sumMinor(
    lines.filter((line) => line.optional && !line.selected).map(extend),
    "Quote options",
  );
  return {
    requiredMinor,
    optionalSelectedMinor,
    optionalAvailableMinor,
    totalMinor: requiredMinor + optionalSelectedMinor,
  };
}

async function liveItems(ctx: ServiceContext, quote: { id: string; version: number }) {
  return ctx.tx
    .select()
    .from(quoteItems)
    .where(and(eq(quoteItems.quoteId, quote.id), eq(quoteItems.version, quote.version)))
    .orderBy(asc(quoteItems.sortOrder), asc(quoteItems.createdAt));
}

/** The next human-facing reference, allocated under a lock. */
async function nextReference(ctx: ServiceContext): Promise<string> {
  const [sequence] = await ctx.tx
    .insert(quoteSequences)
    .values({ id: "quote", nextValue: 2 })
    .onConflictDoUpdate({
      target: quoteSequences.id,
      // The update is the claim: two owners drafting at once get two numbers,
      // because the row is locked by the write rather than by a read.
      set: { nextValue: sql`${quoteSequences.nextValue} + 1`, updatedAt: sql`now()` },
    })
    .returning({ nextValue: quoteSequences.nextValue });
  const value = (sequence?.nextValue ?? 2) - 1;
  return `Q-${String(value).padStart(4, "0")}`;
}

async function loadQuote(ctx: ServiceContext, quoteId: string) {
  const [quote] = await ctx.tx.select().from(quotes).where(eq(quotes.id, quoteId)).limit(1);
  if (!quote) throw new ServiceError("not_found", "That quote is not here.");
  return quote;
}

/** Editing a live quote is a revision, not an edit. */
function assertDraft(quote: { status: string }): void {
  if (quote.status !== "draft") {
    throw new ServiceError(
      "conflict",
      "This quote is with the customer. Revise it instead — they will see the change.",
    );
  }
}

export const createQuote = defineService({
  name: "quotes.create",
  summary: "Draft an offer for somebody.",
  kind: "mutation",
  permission: "scoped",
  writeClass: "money",
  input: z.object({
    contactId: id,
    title: z.string().trim().min(1).max(200),
    currency: currency.default("GBP"),
    validUntil: z.iso.datetime().nullish(),
    depositMinor: z.number().int().min(0).nullish(),
    terms: z.string().trim().max(50_000).nullish(),
    notes: z.string().trim().max(10_000).nullish(),
  }),
  output: quoteRow,
  handler: async (input, ctx) => {
    requirePerson(ctx.actor);
    const [contact] = await ctx.tx
      .select({ id: contacts.id })
      .from(contacts)
      .where(eq(contacts.id, input.contactId))
      .limit(1);
    if (!contact) throw new ServiceError("not_found", "No such contact.");

    const [created] = await ctx.tx
      .insert(quotes)
      .values({
        contactId: input.contactId,
        reference: await nextReference(ctx),
        title: input.title,
        currency: input.currency,
        validUntil: input.validUntil ? new Date(input.validUntil) : null,
        depositMinor: input.depositMinor ?? null,
        terms: input.terms ?? null,
        notes: input.notes ?? null,
      })
      .returning();
    ctx.setSubject("quote", created!.id);
    return created!;
  },
});

export const setQuoteItems = defineService({
  name: "quotes.setItems",
  summary: "Write the lines of a draft quote.",
  kind: "mutation",
  permission: "scoped",
  writeClass: "money",
  input: z.object({
    id,
    items: z
      .array(
        z.object({
          description: z.string().trim().min(1).max(500),
          quantityMicros: z.number().int().min(1).max(1_000_000_000_000).default(1_000_000),
          unitPriceMinor: z.number().int().min(0),
          optional: z.boolean().default(false),
          selected: z.boolean().default(true),
        }),
      )
      .min(1)
      .max(200),
  }),
  output: z.object({ items: listed(itemRow), totals: totalsShape }),
  handler: async (input, ctx) => {
    requirePerson(ctx.actor);
    const quote = await loadQuote(ctx, input.id);
    assertDraft(quote);

    // A draft's current version is rewritten wholesale. Nothing is preserved
    // because nothing has been shown to anybody yet — the moment it has,
    // `assertDraft` above sends the caller to `quotes.revise` instead.
    await ctx.tx
      .delete(quoteItems)
      .where(and(eq(quoteItems.quoteId, quote.id), eq(quoteItems.version, quote.version)));
    const written = await ctx.tx
      .insert(quoteItems)
      .values(
        input.items.map((item, index) => ({
          quoteId: quote.id,
          version: quote.version,
          description: item.description,
          quantityMicros: item.quantityMicros,
          unitPriceMinor: item.unitPriceMinor,
          optional: item.optional,
          // A required line is always taken; storing `false` there would make
          // the total depend on a flag nobody can see or change.
          selected: item.optional ? item.selected : true,
          sortOrder: index,
        })),
      )
      .returning();
    ctx.setSubject("quote", quote.id);
    return { items: written, totals: totalsFor(written) };
  },
});

export const sendQuote = defineService({
  name: "quotes.send",
  summary: "Put a quote in front of the customer.",
  kind: "mutation",
  permission: "scoped",
  writeClass: "message",
  stepUp: true,
  input: z.object({ id }),
  output: quoteRow.extend({ viewToken: z.string() }),
  handler: async (input, ctx) => {
    requirePerson(ctx.actor);
    const quote = await loadQuote(ctx, input.id);
    if (quote.status !== "draft" && !OPEN_STATUSES.includes(quote.status as never)) {
      throw new ServiceError(
        "conflict",
        `A quote that is ${quote.status} cannot be sent again.`,
      );
    }
    const lines = await liveItems(ctx, quote);
    if (lines.length === 0) {
      // An empty quote is not an offer, and sending one wastes the single
      // moment a prospect is paying attention.
      throw new ServiceError("validation", "Add at least one line before sending.");
    }

    const [sent] = await ctx.tx
      .update(quotes)
      .set({
        status: "sent",
        sentAt: quote.sentAt ?? new Date(),
        // Issued once and kept across revisions, so the link already in
        // somebody's inbox still opens the latest version.
        viewToken: quote.viewToken ?? randomBytes(24).toString("base64url"),
        updatedAt: sql`now()`,
      })
      .where(eq(quotes.id, quote.id))
      .returning();

    await ctx.emitTimeline({
      contactId: quote.contactId,
      eventType: "quote.sent",
      subjectType: "quote",
      subjectId: quote.id,
      payload: { reference: quote.reference, version: quote.version },
    });
    ctx.setSubject("quote", quote.id);
    ctx.queueEvent("quote.sent", {
      id: quote.id,
      contactId: quote.contactId,
      reference: quote.reference,
    });
    return { ...sent!, viewToken: sent!.viewToken! };
  },
});

export const reviseQuote = defineService({
  name: "quotes.revise",
  summary: "Offer a new version, keeping the old one readable.",
  kind: "mutation",
  permission: "scoped",
  writeClass: "money",
  input: z.object({
    id,
    items: z
      .array(
        z.object({
          description: z.string().trim().min(1).max(500),
          quantityMicros: z.number().int().min(1).max(1_000_000_000_000).default(1_000_000),
          unitPriceMinor: z.number().int().min(0),
          optional: z.boolean().default(false),
          selected: z.boolean().default(true),
        }),
      )
      .min(1)
      .max(200),
    validUntil: z.iso.datetime().nullish(),
    terms: z.string().trim().max(50_000).nullish(),
  }),
  output: quoteRow.extend({ items: listed(itemRow), totals: totalsShape }),
  handler: async (input, ctx) => {
    requirePerson(ctx.actor);
    const quote = await loadQuote(ctx, input.id);
    if (quote.status === "accepted") {
      // What was agreed happened. A revision would rewrite it, and the honest
      // move is a new quote.
      throw new ServiceError("conflict", "An accepted quote cannot be revised.");
    }

    const version = quote.version + 1;
    // The previous version's rows are left exactly where they are. That is the
    // whole point: "you quoted me £4,000" is answerable afterwards.
    const written = await ctx.tx
      .insert(quoteItems)
      .values(
        input.items.map((item, index) => ({
          quoteId: quote.id,
          version,
          description: item.description,
          quantityMicros: item.quantityMicros,
          unitPriceMinor: item.unitPriceMinor,
          optional: item.optional,
          selected: item.optional ? item.selected : true,
          sortOrder: index,
        })),
      )
      .returning();

    const [revised] = await ctx.tx
      .update(quotes)
      .set({
        version,
        // A revision goes back to the customer, so it is sent rather than
        // silently live — and a quote they had already declined reopens.
        status: quote.status === "draft" ? "draft" : "sent",
        ...(input.validUntil !== undefined
          ? { validUntil: input.validUntil ? new Date(input.validUntil) : null }
          : {}),
        ...(input.terms !== undefined ? { terms: input.terms ?? null } : {}),
        declinedAt: null,
        declineReason: null,
        updatedAt: sql`now()`,
      })
      .where(eq(quotes.id, quote.id))
      .returning();

    await ctx.emitTimeline({
      contactId: quote.contactId,
      eventType: "quote.revised",
      subjectType: "quote",
      subjectId: quote.id,
      payload: { reference: quote.reference, version },
    });
    ctx.setSubject("quote", quote.id);
    ctx.queueEvent("quote.revised", {
      id: quote.id,
      contactId: quote.contactId,
      version,
    });
    return { ...revised!, items: written, totals: totalsFor(written) };
  },
});

const publicView = z.object({
  id: uuid,
  reference: z.string(),
  title: z.string(),
  status: z.enum(QUOTE_STATUSES),
  version: z.number().int(),
  currency: z.string(),
  validUntil: timestamp.nullable(),
  depositMinor: z.number().int().nullable(),
  terms: z.string().nullable(),
  open: z.boolean(),
  items: listed(itemRow),
  totals: totalsShape,
  messages: listed(
    row({
      id: uuid,
      author: z.enum(QUOTE_AUTHORS),
      body: z.string(),
      createdAt: timestamp,
    }),
  ),
});

async function viewFor(
  ctx: ServiceContext,
  quote: typeof quotes.$inferSelect,
): Promise<z.infer<typeof publicView>> {
  const items = await liveItems(ctx, quote);
  const thread = await ctx.tx
    .select({
      id: quoteMessages.id,
      author: quoteMessages.author,
      body: quoteMessages.body,
      createdAt: quoteMessages.createdAt,
    })
    .from(quoteMessages)
    .where(eq(quoteMessages.quoteId, quote.id))
    .orderBy(asc(quoteMessages.createdAt));
  return {
    id: quote.id,
    reference: quote.reference,
    title: quote.title,
    status: quote.status,
    version: quote.version,
    currency: quote.currency,
    validUntil: quote.validUntil,
    depositMinor: quote.depositMinor,
    terms: quote.terms,
    open: OPEN_STATUSES.includes(quote.status as never),
    items,
    totals: totalsFor(items),
    // The owner's private notes are deliberately absent. `notes` is what the
    // business writes *about* a job, and a quote page is not the place for it.
    messages: thread,
  };
}

/**
 * The quote as the prospect sees it, and the moment they first see it.
 *
 * Public, because the token is the authorisation: somebody reading a quote
 * from an email has no account, and §4.3's pipeline depends on them being able
 * to view, question and accept without making one.
 */
export const quoteByToken = defineService({
  name: "quotes.byToken",
  summary: "One quote, for the person it was sent to.",
  kind: "query",
  permission: "public",
  mcpExclude: true,
  agentCallable: false,
  input: z.object({ token: z.string().trim().min(16).max(200) }),
  output: publicView.nullable(),
  handler: async (input, ctx) => {
    const [quote] = await ctx.tx
      .select()
      .from(quotes)
      .where(eq(quotes.viewToken, input.token))
      .limit(1);
    if (!quote) return null;
    return viewFor(ctx, quote);
  },
});

/**
 * Record that the prospect opened it.
 *
 * A mutation rather than a side-effect of the query, so reading a quote in the
 * admin never marks it viewed and a caching layer can never fabricate the
 * event. §4.3's state machine has `viewed` for a reason: it is the first
 * signal an owner gets that the offer landed, and a false one is worse than
 * none.
 */
export const markQuoteViewed = defineService({
  name: "quotes.markViewed",
  summary: "Record that the customer has opened their quote.",
  kind: "mutation",
  permission: "public",
  mcpExclude: true,
  agentCallable: false,
  writeClass: "write",
  input: z.object({ token: z.string().trim().min(16).max(200) }),
  output: z.object({ id: uuid, firstView: z.boolean() }),
  handler: async (input, ctx) => {
    const [quote] = await ctx.tx
      .select()
      .from(quotes)
      .where(eq(quotes.viewToken, input.token))
      .limit(1);
    if (!quote) throw new ServiceError("not_found", "That link is no longer valid.");
    if (quote.status !== "sent") return { id: quote.id, firstView: false };

    await ctx.tx
      .update(quotes)
      .set({
        status: "viewed",
        firstViewedAt: quote.firstViewedAt ?? new Date(),
        updatedAt: sql`now()`,
      })
      .where(eq(quotes.id, quote.id));
    await ctx.emitTimeline({
      contactId: quote.contactId,
      eventType: "quote.viewed",
      subjectType: "quote",
      subjectId: quote.id,
      payload: { reference: quote.reference },
    });
    // The owner's alert. Only on the first view: one notification per quote is
    // information, and one per refresh is noise somebody switches off.
    ctx.queueEvent("quote.viewed", {
      id: quote.id,
      contactId: quote.contactId,
      reference: quote.reference,
    });
    return { id: quote.id, firstView: true };
  },
});

export const chooseQuoteOptions = defineService({
  name: "quotes.chooseOptions",
  summary: "Let the customer toggle the optional lines.",
  kind: "mutation",
  permission: "public",
  mcpExclude: true,
  agentCallable: false,
  writeClass: "money",
  input: z.object({
    token: z.string().trim().min(16).max(200),
    selectedItemIds: z.array(id).max(200),
  }),
  output: z.object({ totals: totalsShape }),
  handler: async (input, ctx) => {
    const [quote] = await ctx.tx
      .select()
      .from(quotes)
      .where(eq(quotes.viewToken, input.token))
      .limit(1);
    if (!quote) throw new ServiceError("not_found", "That link is no longer valid.");
    if (!OPEN_STATUSES.includes(quote.status as never)) {
      throw new ServiceError("conflict", "This quote is closed.");
    }

    const chosen = new Set(input.selectedItemIds);
    const lines = await liveItems(ctx, quote);
    for (const line of lines) {
      // Only optional lines move. A customer cannot deselect the work itself,
      // and an id from somewhere else names nothing on this version.
      if (!line.optional) continue;
      const selected = chosen.has(line.id);
      if (selected === line.selected) continue;
      await ctx.tx
        .update(quoteItems)
        .set({ selected, updatedAt: sql`now()` })
        .where(eq(quoteItems.id, line.id));
    }
    const after = await liveItems(ctx, quote);
    return { totals: totalsFor(after) };
  },
});

export const acceptQuote = defineService({
  name: "quotes.accept",
  summary: "Take the offer, and freeze what was taken.",
  kind: "mutation",
  permission: "public",
  mcpExclude: true,
  agentCallable: false,
  writeClass: "money",
  input: z.object({
    token: z.string().trim().min(16).max(200),
    /** Typed by the person accepting, as with a signature (C6.09). */
    acceptedName: z.string().trim().min(2).max(200),
  }),
  output: z.object({ id: uuid, reference: z.string(), totalMinor: z.number().int() }),
  handler: async (input, ctx) => {
    const [quote] = await ctx.tx
      .select()
      .from(quotes)
      .where(eq(quotes.viewToken, input.token))
      .limit(1);
    if (!quote) throw new ServiceError("not_found", "That link is no longer valid.");
    if (quote.status === "accepted") {
      throw new ServiceError("conflict", "This quote has already been accepted.");
    }
    if (!OPEN_STATUSES.includes(quote.status as never)) {
      throw new ServiceError("conflict", "This quote is no longer open.");
    }
    if (quote.validUntil && quote.validUntil <= new Date()) {
      // Honoured at the moment of acceptance rather than only by the sweep: a
      // job that runs every hour must not decide whether a price still stands.
      throw new ServiceError(
        "conflict",
        "This quote has expired. Ask for a fresh one and it will be along shortly.",
      );
    }

    const lines = await liveItems(ctx, quote);
    const totals = totalsFor(lines);
    // Frozen here, deliberately. Optional lines make the total a function of
    // what they chose, and recomputing it later from rows somebody has since
    // revised would answer a different question from the one they said yes to.
    const snapshot = {
      version: quote.version,
      currency: quote.currency,
      acceptedName: input.acceptedName,
      totals,
      items: lines
        .filter((line) => !line.optional || line.selected)
        .map((line) => ({
          description: line.description,
          quantityMicros: line.quantityMicros,
          unitPriceMinor: line.unitPriceMinor,
          optional: line.optional,
        })),
    };

    const [accepted] = await ctx.tx
      .update(quotes)
      .set({
        status: "accepted",
        acceptedAt: new Date(),
        acceptedByUserId: ctx.actor.kind === "user" ? ctx.actor.userId : null,
        acceptedSnapshot: snapshot,
        // The link stops being an offer the moment it becomes an agreement.
        viewToken: null,
        updatedAt: sql`now()`,
      })
      .where(eq(quotes.id, quote.id))
      .returning({ id: quotes.id, reference: quotes.reference });

    await ctx.emitTimeline({
      contactId: quote.contactId,
      eventType: "quote.accepted",
      subjectType: "quote",
      subjectId: quote.id,
      payload: {
        reference: quote.reference,
        version: quote.version,
        totalMinor: totals.totalMinor,
        acceptedName: input.acceptedName,
      },
    });
    ctx.setSubject("quote", quote.id);
    // C6.13 turns this into contracts, projects, bookings and invoices. The
    // event is the seam, so conversion is a consequence of acceptance rather
    // than something acceptance has to know about.
    ctx.queueEvent("quote.accepted", {
      id: quote.id,
      contactId: quote.contactId,
      reference: quote.reference,
      totalMinor: totals.totalMinor,
    });
    return {
      id: accepted!.id,
      reference: accepted!.reference,
      totalMinor: totals.totalMinor,
    };
  },
});

export const declineQuote = defineService({
  name: "quotes.decline",
  summary: "Say no, on the record, with a reason worth reading.",
  kind: "mutation",
  permission: "public",
  mcpExclude: true,
  agentCallable: false,
  writeClass: "write",
  input: z.object({
    token: z.string().trim().min(16).max(200),
    reason: z.string().trim().max(2_000).nullish(),
  }),
  output: z.object({ id: uuid }),
  handler: async (input, ctx) => {
    const [declined] = await ctx.tx
      .update(quotes)
      .set({
        status: "declined",
        declinedAt: new Date(),
        declineReason: input.reason ?? null,
        updatedAt: sql`now()`,
      })
      .where(
        and(
          eq(quotes.viewToken, input.token),
          inArray(quotes.status, [...OPEN_STATUSES]),
        ),
      )
      .returning({
        id: quotes.id,
        contactId: quotes.contactId,
        reference: quotes.reference,
      });
    if (!declined) throw new ServiceError("not_found", "That link is no longer valid.");

    await ctx.emitTimeline({
      contactId: declined.contactId,
      eventType: "quote.declined",
      subjectType: "quote",
      subjectId: declined.id,
      payload: input.reason ? { reason: input.reason } : {},
    });
    ctx.setSubject("quote", declined.id);
    // The token survives a decline, on purpose: a revision is the usual reply
    // to "too expensive", and the link the customer already has should open it.
    ctx.queueEvent("quote.declined", {
      id: declined.id,
      contactId: declined.contactId,
      reference: declined.reference,
    });
    return { id: declined.id };
  },
});

export const postQuoteMessage = defineService({
  name: "quotes.message",
  summary: "Say something about a quote, where the quote is.",
  kind: "mutation",
  permission: "public",
  mcpExclude: true,
  agentCallable: false,
  writeClass: "message",
  input: z.object({
    /** One of the two, and exactly one: the owner has no token to hold. */
    token: z.string().trim().min(16).max(200).optional(),
    quoteId: id.optional(),
    body: z.string().trim().min(1).max(10_000),
    proposedChanges: z.record(z.string(), z.unknown()).optional(),
  }),
  output: row({ id: uuid, author: z.enum(QUOTE_AUTHORS), body: z.string() }),
  handler: async (input, ctx) => {
    const fromOwner = ctx.actor.kind === "user";
    if (!fromOwner && !input.token) {
      throw new ServiceError("permission", "That link is no longer valid.");
    }
    const [quote] = await ctx.tx
      .select()
      .from(quotes)
      .where(
        fromOwner && input.quoteId
          ? eq(quotes.id, input.quoteId)
          : eq(quotes.viewToken, input.token ?? ""),
      )
      .limit(1);
    if (!quote) throw new ServiceError("not_found", "That quote is not here.");

    const [posted] = await ctx.tx
      .insert(quoteMessages)
      .values({
        quoteId: quote.id,
        version: quote.version,
        author: fromOwner ? "owner" : "contact",
        authorUserId: ctx.actor.kind === "user" ? ctx.actor.userId : null,
        body: input.body,
        // Carried, never applied. A counter-offer is a message; only the owner
        // turns one into a revision, which is what keeps the price the
        // business's to set.
        proposedChanges: input.proposedChanges ?? null,
      })
      .returning({
        id: quoteMessages.id,
        author: quoteMessages.author,
        body: quoteMessages.body,
      });

    // A question moves the quote into negotiation, which is the state §4.3
    // draws with arrows in both directions — it goes back to `sent` on the
    // owner's next revision.
    if (!fromOwner && OPEN_STATUSES.includes(quote.status as never)) {
      await ctx.tx
        .update(quotes)
        .set({ status: "negotiating", updatedAt: sql`now()` })
        .where(eq(quotes.id, quote.id));
    }
    ctx.setSubject("quote", quote.id);
    ctx.queueEvent(fromOwner ? "quote.ownerReplied" : "quote.questioned", {
      id: quote.id,
      contactId: quote.contactId,
      reference: quote.reference,
    });
    return posted!;
  },
});

export const listQuotes = defineService({
  name: "quotes.list",
  summary: "Offers out, accepted and gone quiet.",
  kind: "query",
  permission: "scoped",
  input: z.object({
    status: z.enum(QUOTE_STATUSES).optional(),
    contactId: id.optional(),
    limit: z.number().int().min(1).max(200).default(50),
  }),
  output: listed(
    quoteRow.extend({
      contactName: z.string().nullable(),
      contactEmail: z.string().nullable(),
      totalMinor: z.number().int(),
    }),
  ),
  handler: async (input, ctx) => {
    requirePerson(ctx.actor);
    // Columns named one by one rather than `quotes` wholesale. `row()` is a
    // loose object, so spreading the record would carry `view_token` — a
    // credential — into every list, log and screenshot. The first draft did
    // exactly that and the test caught it.
    const rows = await ctx.tx
      .select({
        quote: {
          id: quotes.id,
          contactId: quotes.contactId,
          reference: quotes.reference,
          title: quotes.title,
          status: quotes.status,
          version: quotes.version,
          currency: quotes.currency,
          validUntil: quotes.validUntil,
          depositMinor: quotes.depositMinor,
          terms: quotes.terms,
          notes: quotes.notes,
          sentAt: quotes.sentAt,
          firstViewedAt: quotes.firstViewedAt,
          acceptedAt: quotes.acceptedAt,
          declinedAt: quotes.declinedAt,
          declineReason: quotes.declineReason,
        },
        contactName: contacts.name,
        contactEmail: contacts.email,
      })
      .from(quotes)
      .innerJoin(contacts, eq(contacts.id, quotes.contactId))
      .where(
        and(
          input.status ? eq(quotes.status, input.status) : undefined,
          input.contactId ? eq(quotes.contactId, input.contactId) : undefined,
        ),
      )
      .orderBy(desc(quotes.createdAt))
      .limit(input.limit);

    // Totalled per row rather than in SQL, because an optional line counts
    // only when chosen and that is a rule rather than a sum.
    const totals = new Map<string, number>();
    if (rows.length > 0) {
      const lines = await ctx.tx
        .select()
        .from(quoteItems)
        .where(inArray(quoteItems.quoteId, rows.map((r) => r.quote.id)));
      for (const { quote } of rows) {
        totals.set(
          quote.id,
          totalsFor(lines.filter((l) => l.quoteId === quote.id && l.version === quote.version))
            .totalMinor,
        );
      }
    }
    return rows.map(({ quote, contactName, contactEmail }) => ({
      ...quote,
      contactName,
      contactEmail,
      totalMinor: totals.get(quote.id) ?? 0,
    }));
  },
});

export const getQuote = defineService({
  name: "quotes.get",
  summary: "One quote, every version of it, and the conversation.",
  kind: "query",
  permission: "scoped",
  input: z.object({ id }),
  output: quoteRow
    .extend({
      items: listed(itemRow),
      totals: totalsShape,
      /** Every version's lines, so an earlier offer is still readable. */
      history: listed(itemRow),
      messages: listed(
        row({
          id: uuid,
          version: z.number().int(),
          author: z.enum(QUOTE_AUTHORS),
          body: z.string(),
          proposedChanges: z.unknown(),
          createdAt: timestamp,
        }),
      ),
      viewToken: z.string().nullable(),
    })
    .nullable(),
  handler: async (input, ctx) => {
    requirePerson(ctx.actor);
    const [quote] = await ctx.tx.select().from(quotes).where(eq(quotes.id, input.id)).limit(1);
    if (!quote) return null;
    const all = await ctx.tx
      .select()
      .from(quoteItems)
      .where(eq(quoteItems.quoteId, quote.id))
      .orderBy(asc(quoteItems.version), asc(quoteItems.sortOrder));
    const live = all.filter((line) => line.version === quote.version);
    const messages = await ctx.tx
      .select({
        id: quoteMessages.id,
        version: quoteMessages.version,
        author: quoteMessages.author,
        body: quoteMessages.body,
        proposedChanges: quoteMessages.proposedChanges,
        createdAt: quoteMessages.createdAt,
      })
      .from(quoteMessages)
      .where(eq(quoteMessages.quoteId, quote.id))
      .orderBy(asc(quoteMessages.createdAt));
    return {
      ...quote,
      items: live,
      totals: totalsFor(live),
      history: all.filter((line) => line.version !== quote.version),
      messages,
      viewToken: quote.viewToken,
    };
  },
});

/**
 * Let quotes past their date lapse.
 *
 * A swept status rather than a computed one, for the same reason a rental's
 * overdue is: an expired quote is something an owner follows up, and a flag
 * that exists only while somebody is looking at the right screen is not a
 * list. Acceptance checks the date itself as well, so a job that runs hourly
 * never decides whether a price still stands.
 */
export const expireQuotes = defineService({
  name: "quotes.expire",
  summary: "Lapse quotes whose validity has passed.",
  kind: "mutation",
  permission: "scoped",
  agentCallable: false,
  writeClass: "write",
  input: z.object({}),
  output: z.object({ expired: z.number().int() }),
  handler: async (_input, ctx) => {
    const rows = await ctx.tx
      .update(quotes)
      .set({ status: "expired", updatedAt: sql`now()` })
      .where(
        and(
          inArray(quotes.status, [...OPEN_STATUSES]),
          lte(quotes.validUntil, new Date()),
        ),
      )
      .returning({
        id: quotes.id,
        contactId: quotes.contactId,
        reference: quotes.reference,
      });
    for (const expired of rows) {
      ctx.queueEvent("quote.expired", {
        id: expired.id,
        contactId: expired.contactId,
        reference: expired.reference,
      });
    }
    return { expired: rows.length };
  },
});

/**
 * What a merge means for a quote (CLAUDE.md's non-negotiable).
 *
 * Unconditional: an offer made to somebody is theirs whichever of two
 * duplicate records the business filed it under, and a quote pointing at a
 * record that no longer exists is money the business cannot find.
 */
registerContactReference({
  table: "quotes",
  repoint: (tx, duplicateId, survivingId) =>
    tx.update(quotes).set({ contactId: survivingId }).where(eq(quotes.contactId, duplicateId)),
  captureForUndo: async (tx, duplicateId, survivingId) => ({
    state: await tx
      .select({ id: quotes.id, contactId: quotes.contactId })
      .from(quotes)
      .where(inArray(quotes.contactId, [duplicateId, survivingId])),
    undoable: true,
  }),
  restoreAfterUndo: async (tx, beforeState, _afterState, duplicateId) => {
    const moved = z
      .array(z.object({ id: z.string().uuid(), contactId: z.string().uuid().nullable() }))
      .parse(beforeState)
      .filter((quote) => quote.contactId === duplicateId);
    if (moved.length) {
      await tx
        .update(quotes)
        .set({ contactId: duplicateId })
        .where(inArray(quotes.id, moved.map((quote) => quote.id)));
    }
  },
});

/**
 * What a quote means for the person's own data (§30).
 *
 * The offer survives and the person goes. A quote is the business's own record
 * of what it offered and at what price — its pipeline, its win rate, its
 * accounts — and deleting it would take that with the customer's data. What is
 * removed is what the business wrote *about* them and what they wrote back.
 */
registerContactPrivacySource({
  scope: "contact.quotes",
  tables: ["quotes", "quote_messages"],
  exportData: async (tx, contactId) => {
    const offers = await tx
      .select()
      .from(quotes)
      .where(eq(quotes.contactId, contactId))
      .orderBy(asc(quotes.createdAt));
    const thread = offers.length
      ? await tx
          .select()
          .from(quoteMessages)
          .where(inArray(quoteMessages.quoteId, offers.map((quote) => quote.id)))
      : [];
    return { quotes: offers, messages: thread };
  },
  erase: async (tx, contactId) => {
    const offers = await tx
      .update(quotes)
      .set({
        notes: null,
        declineReason: null,
        // A live link that outlived the request would be a way back to a quote
        // they asked to be forgotten from.
        viewToken: null,
        updatedAt: sql`now()`,
      })
      .where(eq(quotes.contactId, contactId))
      .returning({ id: quotes.id });
    if (offers.length) {
      await tx
        .delete(quoteMessages)
        .where(inArray(quoteMessages.quoteId, offers.map((quote) => quote.id)));
    }
    return { affected: offers.length };
  },
});

import conversionServices from "./conversion";

export default [
  ...conversionServices,
  createQuote,
  setQuoteItems,
  sendQuote,
  reviseQuote,
  quoteByToken,
  markQuoteViewed,
  chooseQuoteOptions,
  acceptQuote,
  declineQuote,
  postQuoteMessage,
  listQuotes,
  getQuote,
  expireQuotes,
];
