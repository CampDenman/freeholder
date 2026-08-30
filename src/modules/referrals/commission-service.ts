// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Earning, holding, reversing and settling commission
// (MASTER.md §4.3, §4.13, C9.10).
//
// C9.09 recorded and attributed and paid nobody. This is the half that pays,
// and four rules from §4.13 shape every service in the file:
//
//   "Commission has a holdback. A `CommissionEvent` becomes payable only after
//   the refund window closes; a refund or chargeback inside it reverses
//   automatically, and reversing after payout produces a negative line on the
//   next batch rather than an argument."
//
//   "Dual-sided rewards can pay in points. A referrer may earn commission,
//   loyalty points, a pass, or a credit — the reward is a configuration."
//
//   "Payouts settle through invoicing. v1 is manual and batched with a CSV the
//   owner can hand to their bank or accountant."
//
//   "One hop only. Commission accrues to the referrer of the converting
//   customer and to nobody above them."
//
// **How paying in points works, and why no loyalty import appears below.**
// §4.13 also says earning is "a listener on spine events, never a call from
// inside another module", and names "a referral converted" as one of those
// events. So this module emits `referral.converted` against the *referrer's*
// contact, carrying what the conversion was worth, and a loyalty `EarnRule`
// matching that event grants the points. A programme paying only in points
// sets its commission `kind` to "none": no cash row is written, the event
// still fires, and the amount lives in exactly one place — the earn rule.
// Referrals never learns that loyalty exists, and loyalty never learns that
// referrals does.
//
// **One hop** needs no enforcement code, and that is the design. Commission is
// computed from the touches on the converting customer's own chain; there is
// no parent link on `AffiliateCode` to walk and no query here that could build
// one. `tests/modules/referrals-commission.test.ts` asserts a referrer's own
// referrer earns nothing from a sale two hops away.
import { z } from "zod";
import { and, asc, desc, eq, gte, inArray, isNull, lte, sql } from "drizzle-orm";
import { listed, row, uuid as uuidSchema } from "@/core/contract";
import { defineService, ServiceError, type ServiceContext, type Tx } from "@/core/service";
import { registerContactReference } from "@/core/contacts/service";
import { registerContactPrivacySource } from "@/core/privacy/service";
import {
  affiliatePrograms,
  affiliateTaxProfiles,
  commissionEvents,
  payoutBatches,
  payoutLines,
  referralInvitations,
} from "./schema";
import { attributionFor } from "./attribution-service";
import {
  type CommissionConfig,
  commissionFor,
  payableAt,
  sharesFrom,
  splitMinor,
} from "./commission";
import { conversionTypeFrom, directionOf, spineFact } from "./spine";

const commissionRow = row({
  id: uuidSchema,
  programId: uuidSchema,
  codeId: uuidSchema,
  affiliateContactId: uuidSchema,
  referredContactId: uuidSchema,
  conversionType: z.enum(["signup", "subscription", "order", "booking", "custom"]),
  subjectType: z.string(),
  subjectId: uuidSchema.nullable(),
  sharePpm: z.number().int(),
  basisMinor: z.number().int(),
  amountMinor: z.number().int(),
  currency: z.string(),
  status: z.enum(["pending", "approved", "paid", "reversed"]),
  payableAt: z.date(),
  reversesId: uuidSchema.nullable(),
  payoutLineId: uuidSchema.nullable(),
});

/**
 * The programme's commission settings, or empty when it has none.
 *
 * Empty is a safe default here rather than a hidden failure: `commissionFor`
 * reads a missing `kind` as "none" and pays zero, so a malformed jsonb blob
 * cannot invent money. It can only fail to pay some, which is the direction an
 * owner notices and can correct.
 */
function configOf(program: { commission: unknown }): CommissionConfig {
  const raw = program.commission;
  return typeof raw === "object" && raw !== null ? raw : {};
}

/* --------------------------------------------------------- the listener */

/**
 * A conversion arrived. Work out who earned what, and write it down.
 *
 * Runs inside the caller's transaction, so the commission and the spine rows
 * that explain it commit with each other or not at all.
 */
async function convert(
  ctx: ServiceContext,
  topic: string,
  payload: unknown,
): Promise<{ written: number }> {
  const fact = await spineFact(ctx.tx, topic, payload);
  if (!fact) return { written: 0 };

  const programs = await ctx.tx
    .select()
    .from(affiliatePrograms)
    .where(eq(affiliatePrograms.status, "active"));
  if (programs.length === 0) return { written: 0 };

  const conversionType = fact.subjectType === "contact" ? "signup" : conversionTypeFrom(fact.payload);
  let written = 0;

  for (const program of programs) {
    // A programme states which conversions it pays for. One that does not name
    // this kind is not silently generous.
    const types = Array.isArray(program.conversionTypes) ? program.conversionTypes : [];
    if (types.length > 0 && !types.includes(conversionType)) continue;

    // Attribution is asked for, not recomputed here. It is the same read the
    // owner sees in the admin, so what the report shows and what the affiliate
    // is paid cannot drift apart.
    const attribution = await ctx.call(attributionFor, {
      contactId: fact.contactId,
      programId: program.id,
    });
    if (attribution.credits.length === 0) continue;

    const config = configOf(program);
    const basisMinor = Math.max(0, fact.amountMinor);
    const total = commissionFor(config, basisMinor);
    const shares = sharesFrom(attribution.credits);
    const split = splitMinor(total, shares);
    const shareById = new Map(shares.map((share) => [share.codeId, share.sharePpm]));
    const earnedAt = new Date();
    const currency = fact.currency ?? program_currency(program);

    for (const credit of attribution.credits) {
      const amountMinor = split.find((part) => part.codeId === credit.codeId)?.amountMinor ?? 0;

      // The event fires whatever the cash is, because a points-only programme
      // pays nothing here and everything through loyalty's earn rule. Writing
      // it against the *referrer* is what makes the points land on the person
      // who did the referring rather than the person who bought something.
      await ctx.emitTimeline({
        contactId: credit.referrerContactId,
        eventType: "referral.converted",
        subjectType: fact.subjectType,
        subjectId: fact.subjectId,
        payload: {
          programId: program.id,
          codeId: credit.codeId,
          referredContactId: fact.contactId,
          conversionType,
          basisMinor,
          amountMinor,
          currency,
          sharePpm: shareById.get(credit.codeId) ?? 0,
        },
      });

      // Queued as well as written to the spine. The timeline row is the
      // record and carries the money; the bus event is what wakes a loyalty
      // earn rule up, and it carries the referrer's id because that is the
      // contact whose points these are.
      ctx.queueEvent("referral.converted", {
        referrerContactId: credit.referrerContactId,
        codeId: credit.codeId,
        programId: program.id,
        conversionType,
        amountMinor,
        currency,
      });

      if (amountMinor <= 0) continue;

      // `onConflictDoNothing` rather than a prior existence check: the bus can
      // redeliver and a retried job re-runs its handler, and the unique index
      // is the only guard that holds under concurrency. Paying somebody twice
      // for one sale is the expensive direction of this bug.
      const [inserted] = await ctx.tx
        .insert(commissionEvents)
        .values({
          programId: program.id,
          codeId: credit.codeId,
          affiliateContactId: credit.referrerContactId,
          referredContactId: fact.contactId,
          conversionType,
          subjectType: fact.subjectType,
          subjectId: fact.subjectId,
          invoiceId: fact.subjectType === "invoice" ? fact.subjectId : null,
          sharePpm: shareById.get(credit.codeId) ?? 0,
          basisMinor,
          amountMinor,
          currency,
          status: "pending",
          payableAt: payableAt(earnedAt, program.holdbackDays),
        })
        .onConflictDoNothing()
        .returning({ id: commissionEvents.id });

      if (!inserted) continue;
      written += 1;
      ctx.queueEvent("referral.commissionEarned", {
        commissionEventId: inserted.id,
        affiliateContactId: credit.referrerContactId,
        amountMinor,
        currency,
      });
    }

    // An invitation that led here has done its job. §4.13 gives
    // `reward_state` for exactly this and C9.09 could only ever write "none".
    await ctx.tx
      .update(referralInvitations)
      .set({ convertedAt: new Date(), rewardState: total > 0 ? "pending" : "granted" })
      .where(
        and(
          eq(referralInvitations.programId, program.id),
          inArray(
            referralInvitations.codeId,
            attribution.credits.map((credit) => credit.codeId),
          ),
          isNull(referralInvitations.convertedAt),
        ),
      );
  }

  return { written };
}

/** A programme's own currency, for a signup conversion that carries none. */
function program_currency(program: { commission: unknown }): string {
  const config = configOf(program);
  return typeof (config as { currency?: unknown }).currency === "string"
    ? (config as { currency: string }).currency
    : "GBP";
}

/**
 * Money went back. Undo the commission, in whichever of the two ways applies.
 *
 * §4.13: "a refund or chargeback inside it reverses automatically, and
 * reversing after payout produces a negative line on the next batch rather
 * than an argument." Those are genuinely different operations — one edits a
 * row that has not been acted on, the other writes a new row that cites it —
 * and conflating them would either rewrite a paid batch's history or leave the
 * owner out of pocket.
 */
async function reverse(
  ctx: ServiceContext,
  topic: string,
  payload: unknown,
): Promise<{ reversed: number; clawedBack: number }> {
  const fact = await spineFact(ctx.tx, topic, payload);
  if (!fact?.subjectId) return { reversed: 0, clawedBack: 0 };

  const existing = await ctx.tx
    .select()
    .from(commissionEvents)
    .where(
      and(
        eq(commissionEvents.subjectType, fact.subjectType),
        eq(commissionEvents.subjectId, fact.subjectId),
        isNull(commissionEvents.reversesId),
      ),
    );

  let reversed = 0;
  let clawedBack = 0;

  for (const event of existing) {
    if (event.status === "reversed") continue;

    if (event.status === "paid") {
      // Already settled. A negative row, citing the original, that the next
      // batch will net off. The original is left exactly as it was: it is the
      // record of a payment that really happened.
      await ctx.tx.insert(commissionEvents).values({
        programId: event.programId,
        codeId: event.codeId,
        affiliateContactId: event.affiliateContactId,
        referredContactId: event.referredContactId,
        conversionType: event.conversionType,
        subjectType: event.subjectType,
        subjectId: event.subjectId,
        invoiceId: event.invoiceId,
        sharePpm: event.sharePpm,
        basisMinor: -event.basisMinor,
        amountMinor: -event.amountMinor,
        currency: event.currency,
        // Approved, not pending: the money is already owed back, and holding a
        // clawback for another refund window would let somebody who refunds
        // everything stay ahead indefinitely.
        status: "approved",
        payableAt: new Date(),
        reversesId: event.id,
      });
      clawedBack += 1;
      ctx.queueEvent("referral.commissionClawedBack", {
        commissionEventId: event.id,
        affiliateContactId: event.affiliateContactId,
        amountMinor: -event.amountMinor,
      });
      continue;
    }

    await ctx.tx
      .update(commissionEvents)
      .set({ status: "reversed" })
      .where(eq(commissionEvents.id, event.id));
    reversed += 1;
    ctx.queueEvent("referral.commissionReversed", {
      commissionEventId: event.id,
      affiliateContactId: event.affiliateContactId,
    });
  }

  if (reversed + clawedBack > 0) {
    await ctx.tx
      .update(referralInvitations)
      .set({ rewardState: "reversed" })
      .where(
        inArray(
          referralInvitations.codeId,
          existing.map((event) => event.codeId),
        ),
      );
  }

  return { reversed, clawedBack };
}

const applySpineEvent = defineService({
  name: "referrals.applySpineEvent",
  writeClass: "write",
  summary: "React to a conversion or a refund by writing or undoing commission.",
  kind: "mutation",
  permission: "system",
  input: z.object({ topic: z.string(), payload: z.unknown() }),
  output: row({ written: z.number().int(), reversed: z.number().int(), clawedBack: z.number().int() }),
  handler: async (input, ctx) => {
    const direction = directionOf(input.topic);
    if (!direction) return { written: 0, reversed: 0, clawedBack: 0 };
    if (direction === "reverse") {
      const result = await reverse(ctx, input.topic, input.payload);
      return { written: 0, ...result };
    }
    const result = await convert(ctx, input.topic, input.payload);
    return { ...result, reversed: 0, clawedBack: 0 };
  },
});

/**
 * The listener the bus calls, one function for every topic in the manifest.
 *
 * It runs after the emitting transaction has committed, in its own — which is
 * why calling `.call` here is right rather than a second-transaction bug. A
 * listener *is* the top of a transaction; the rule it would break is calling
 * one service from inside another handler, and there is no handler above this.
 *
 * Safe to run twice. The partial unique index on
 * (code, subject_type, subject_id) means a redelivery cannot pay for the same
 * conversion again, and "we paid you twice for one sale" is a harder
 * conversation than "we have not paid you yet".
 */
export async function onSpineEvent(payload: unknown, eventName?: string): Promise<void> {
  const topic = eventName ?? "";
  if (!directionOf(topic)) return;
  await applySpineEvent.call({ topic, payload }, { kind: "system" });
}

/* ------------------------------------------------------------- holdback */

/**
 * Move matured commission from pending to approved.
 *
 * Idempotent by construction: it selects on the condition it then clears, so
 * running it twice in a minute approves nothing the second time. That matters
 * because §4.13's holdback is the owner's promise to an affiliate, and a job
 * that double-counted would break it in the direction that costs money.
 */
export async function matureCommissions(tx: Tx, now = new Date()): Promise<number> {
  const matured = await tx
    .update(commissionEvents)
    .set({ status: "approved" })
    .where(and(eq(commissionEvents.status, "pending"), lte(commissionEvents.payableAt, now)))
    .returning({ id: commissionEvents.id });
  return matured.length;
}

/* ---------------------------------------------------------- the ledger */

export const commissions = defineService({
  name: "referrals.commissions",
  summary: "Commission earned, newest first.",
  kind: "query",
  permission: "scoped",
  input: z.object({
    affiliateContactId: uuidSchema.optional(),
    status: z.enum(["pending", "approved", "paid", "reversed"]).optional(),
    limit: z.number().int().min(1).max(500).default(100),
  }),
  output: listed(commissionRow),
  handler: (input, ctx) =>
    ctx.tx
      .select()
      .from(commissionEvents)
      .where(
        and(
          input.affiliateContactId
            ? eq(commissionEvents.affiliateContactId, input.affiliateContactId)
            : undefined,
          input.status ? eq(commissionEvents.status, input.status) : undefined,
        ),
      )
      .orderBy(desc(commissionEvents.createdAt))
      .limit(input.limit),
  // A referrer may read their own earnings in the portal. A query, filtered to
  // the caller's own contact by the framework — see `core/portal/sections.ts`
  // for why that check lives there and not here.
  selfService: { contactField: "affiliateContactId" },
});

/* ------------------------------------------------------------- payouts */

export const buildBatch = defineService({
  name: "referrals.buildPayoutBatch",
  writeClass: "write",
  summary: "Gather everything payable into a draft batch, one line per person.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({
    periodStart: z.date(),
    periodEnd: z.date(),
    currency: z.string().min(3).max(3).default("GBP"),
    method: z.enum(["manual", "transfer", "provider"]).default("manual"),
  }),
  output: row({ batchId: uuidSchema, lines: z.number().int(), totalMinor: z.number().int() }),
  handler: async (input, ctx) => {
    if (input.periodEnd <= input.periodStart) {
      throw new ServiceError("validation", "A payout period ends after it starts.");
    }

    const payable = await ctx.tx
      .select()
      .from(commissionEvents)
      .where(
        and(
          eq(commissionEvents.status, "approved"),
          eq(commissionEvents.currency, input.currency),
          isNull(commissionEvents.payoutLineId),
          lte(commissionEvents.payableAt, input.periodEnd),
        ),
      )
      .orderBy(asc(commissionEvents.createdAt));

    if (payable.length === 0) {
      throw new ServiceError("validation", "There is nothing payable in that period.");
    }

    const [batch] = await ctx.tx
      .insert(payoutBatches)
      .values({
        periodStart: input.periodStart,
        periodEnd: input.periodEnd,
        currency: input.currency,
        method: input.method,
        status: "draft",
      })
      .returning();

    const byPerson = new Map<string, typeof payable>();
    for (const event of payable) {
      const bucket = byPerson.get(event.affiliateContactId) ?? [];
      bucket.push(event);
      byPerson.set(event.affiliateContactId, bucket);
    }

    let totalMinor = 0;
    let lines = 0;

    for (const [affiliateContactId, events] of byPerson) {
      // Negatives are in here, because a clawback is a commission event with a
      // negative amount. Netting them off is the whole point of §4.13's "a
      // negative line on the next batch rather than an argument".
      const amountMinor = events.reduce((sum, event) => sum + event.amountMinor, 0);

      // Somebody whose clawbacks outweigh their earnings this period is not
      // invoiced for the difference. The events stay unsettled and roll into
      // the next batch, which is the humane reading of a netting rule and the
      // only one that does not turn a refund into a debt collection.
      if (amountMinor <= 0) continue;

      const [profile] = await ctx.tx
        .select()
        .from(affiliateTaxProfiles)
        .where(eq(affiliateTaxProfiles.contactId, affiliateContactId));

      const [line] = await ctx.tx
        .insert(payoutLines)
        .values({
          batchId: batch!.id,
          affiliateContactId,
          amountMinor,
          currency: input.currency,
          taxFormState: profile?.state ?? "not_required",
        })
        .returning();

      await ctx.tx
        .update(commissionEvents)
        .set({ payoutLineId: line!.id })
        .where(
          inArray(
            commissionEvents.id,
            events.map((event) => event.id),
          ),
        );

      totalMinor += amountMinor;
      lines += 1;
    }

    await ctx.tx
      .update(payoutBatches)
      .set({ totalMinor })
      .where(eq(payoutBatches.id, batch!.id));

    ctx.setSubject("payout_batch", batch!.id);
    ctx.queueEvent("referral.payoutBatchBuilt", { batchId: batch!.id, lines, totalMinor });
    return { batchId: batch!.id, lines, totalMinor };
  },
});

export const approveBatch = defineService({
  name: "referrals.approvePayoutBatch",
  writeClass: "write",
  summary: "Approve a draft payout batch.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({ batchId: uuidSchema }),
  output: row({ batchId: uuidSchema, status: z.enum(["draft", "approved", "paid"]) }),
  handler: async (input, ctx) => {
    const [batch] = await ctx.tx
      .update(payoutBatches)
      .set({ status: "approved", approvedAt: new Date() })
      .where(and(eq(payoutBatches.id, input.batchId), eq(payoutBatches.status, "draft")))
      .returning();
    if (!batch) throw new ServiceError("conflict", "That batch is not a draft any more.");
    ctx.setSubject("payout_batch", batch.id);
    ctx.queueEvent("referral.payoutBatchApproved", { batchId: batch.id });
    return { batchId: batch.id, status: batch.status };
  },
});

export const markBatchPaid = defineService({
  name: "referrals.markPayoutBatchPaid",
  writeClass: "write",
  summary: "Record that an approved batch has actually been paid.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({ batchId: uuidSchema, paidAt: z.date().optional() }),
  output: row({ batchId: uuidSchema, settled: z.number().int() }),
  handler: async (input, ctx) => {
    const [batch] = await ctx.tx
      .update(payoutBatches)
      .set({ status: "paid", paidAt: input.paidAt ?? new Date() })
      .where(and(eq(payoutBatches.id, input.batchId), eq(payoutBatches.status, "approved")))
      .returning();
    if (!batch) {
      throw new ServiceError("conflict", "Only an approved batch can be marked paid.");
    }

    const lineIds = await ctx.tx
      .select({ id: payoutLines.id })
      .from(payoutLines)
      .where(eq(payoutLines.batchId, batch.id));

    const settled = lineIds.length
      ? await ctx.tx
          .update(commissionEvents)
          .set({ status: "paid" })
          .where(
            inArray(
              commissionEvents.payoutLineId,
              lineIds.map((line) => line.id),
            ),
          )
          .returning({ id: commissionEvents.id })
      : [];

    ctx.setSubject("payout_batch", batch.id);
    ctx.queueEvent("referral.payoutBatchPaid", { batchId: batch.id, settled: settled.length });
    return { batchId: batch.id, settled: settled.length };
  },
});

export const batches = defineService({
  name: "referrals.payoutBatches",
  summary: "Payout batches, newest first.",
  kind: "query",
  permission: "scoped",
  input: z.object({ limit: z.number().int().min(1).max(200).default(50) }),
  output: listed(
    row({
      id: uuidSchema,
      periodStart: z.date(),
      periodEnd: z.date(),
      currency: z.string(),
      method: z.enum(["manual", "transfer", "provider"]),
      status: z.enum(["draft", "approved", "paid"]),
      totalMinor: z.number().int(),
      paidAt: z.date().nullable(),
    }),
  ),
  handler: (input, ctx) =>
    ctx.tx
      .select({
        id: payoutBatches.id,
        periodStart: payoutBatches.periodStart,
        periodEnd: payoutBatches.periodEnd,
        currency: payoutBatches.currency,
        method: payoutBatches.method,
        status: payoutBatches.status,
        totalMinor: payoutBatches.totalMinor,
        paidAt: payoutBatches.paidAt,
      })
      .from(payoutBatches)
      .orderBy(desc(payoutBatches.periodEnd))
      .limit(input.limit),
});

/**
 * One CSV field, quoted the way a spreadsheet expects.
 *
 * The leading-character guard is not decoration. A value beginning `=`, `+`,
 * `-` or `@` is executed as a formula when the file is opened in Excel or
 * Sheets, so a contact who names themselves `=HYPERLINK(...)` turns the
 * owner's payout export into an attack on the owner's own machine. Prefixing a
 * single quote is the standard defusing and costs nothing to a reader.
 */
function csvField(value: string | number | null): string {
  const text = value === null ? "" : String(value);
  const defused = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return `"${defused.replaceAll('"', '""')}"`;
}

export const batchCsv = defineService({
  name: "referrals.payoutBatchCsv",
  summary: "A payout batch as CSV, for the owner's bank or accountant (§4.13).",
  kind: "query",
  permission: "scoped",
  input: z.object({ batchId: uuidSchema }),
  output: row({ filename: z.string(), csv: z.string(), lines: z.number().int() }),
  handler: async (input, ctx) => {
    const [batch] = await ctx.tx
      .select()
      .from(payoutBatches)
      .where(eq(payoutBatches.id, input.batchId));
    if (!batch) throw new ServiceError("not_found", "There is no such payout batch.");

    const rows = await ctx.tx
      .select({
        lineId: payoutLines.id,
        affiliateContactId: payoutLines.affiliateContactId,
        amountMinor: payoutLines.amountMinor,
        currency: payoutLines.currency,
        taxFormState: payoutLines.taxFormState,
      })
      .from(payoutLines)
      .where(eq(payoutLines.batchId, batch.id))
      .orderBy(asc(payoutLines.createdAt));

    const header = [
      "line_id",
      "affiliate_contact_id",
      "amount_minor",
      "currency",
      "tax_form_state",
      "period_start",
      "period_end",
      "batch_status",
    ];
    const body = rows.map((line) =>
      [
        line.lineId,
        line.affiliateContactId,
        // Minor units, not a formatted decimal. A bank file that says 1250 and
        // a ledger that says 1250 cannot disagree; "12.50" invites a locale to
        // read it as 1250 somewhere between here and the bank.
        line.amountMinor,
        line.currency,
        line.taxFormState,
        batch.periodStart.toISOString(),
        batch.periodEnd.toISOString(),
        batch.status,
      ]
        .map(csvField)
        .join(","),
    );

    return {
      filename: `payouts-${batch.periodEnd.toISOString().slice(0, 10)}.csv`,
      // CRLF, because that is what RFC 4180 says and what the spreadsheet on
      // the owner's accountant's Windows machine will not argue with.
      csv: [header.map(csvField).join(","), ...body].join("\r\n"),
      lines: rows.length,
    };
  },
});

/* ---------------------------------------------------------- tax status */

export const saveTaxProfile = defineService({
  name: "referrals.saveTaxProfile",
  writeClass: "write",
  summary: "Record what paperwork an affiliate owes, and whether it arrived.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({
    contactId: uuidSchema,
    jurisdiction: z.string().trim().max(120).default(""),
    formKind: z.string().trim().max(60).default(""),
    state: z.enum(["not_required", "requested", "collected", "expired"]),
    thresholdMinor: z.number().int().min(0).default(0),
    currency: z.string().min(3).max(3).default("GBP"),
    note: z.string().trim().max(2000).optional(),
  }),
  output: row({ id: uuidSchema, state: z.enum(["not_required", "requested", "collected", "expired"]) }),
  handler: async (input, ctx) => {
    const now = new Date();
    const [saved] = await ctx.tx
      .insert(affiliateTaxProfiles)
      .values({
        contactId: input.contactId,
        jurisdiction: input.jurisdiction,
        formKind: input.formKind,
        state: input.state,
        thresholdMinor: input.thresholdMinor,
        currency: input.currency,
        note: input.note ?? null,
        requestedAt: input.state === "requested" ? now : null,
        collectedAt: input.state === "collected" ? now : null,
      })
      .onConflictDoUpdate({
        target: affiliateTaxProfiles.contactId,
        set: {
          jurisdiction: input.jurisdiction,
          formKind: input.formKind,
          state: input.state,
          thresholdMinor: input.thresholdMinor,
          currency: input.currency,
          note: input.note ?? null,
          // Stamped only on the transition into the state, so "when did they
          // send it" survives a later edit to the note.
          ...(input.state === "requested" ? { requestedAt: now } : {}),
          ...(input.state === "collected" ? { collectedAt: now } : {}),
        },
      })
      .returning();
    ctx.setSubject("contact", input.contactId);
    return { id: saved!.id, state: saved!.state };
  },
});

/**
 * Who has been paid enough this year to need paperwork, and has none.
 *
 * §4.13: "The platform prompts and records; it does not file." This is the
 * prompt, and it is a query rather than a job on purpose — it tells the owner
 * what to ask for, and does not pretend to have asked.
 */
export const taxPrompts = defineService({
  name: "referrals.taxPrompts",
  summary: "Affiliates over their threshold whose paperwork is missing (§4.13).",
  kind: "query",
  permission: "scoped",
  input: z.object({ since: z.date() }),
  output: listed(
    row({
      contactId: uuidSchema,
      paidMinor: z.number().int(),
      currency: z.string(),
      thresholdMinor: z.number().int(),
      state: z.enum(["not_required", "requested", "collected", "expired"]),
    }),
  ),
  handler: async (input, ctx) => {
    const paid = await ctx.tx
      .select({
        contactId: commissionEvents.affiliateContactId,
        currency: commissionEvents.currency,
        paidMinor: sql<number>`sum(${commissionEvents.amountMinor})::int`,
      })
      .from(commissionEvents)
      .where(
        and(
          eq(commissionEvents.status, "paid"),
          gte(commissionEvents.createdAt, input.since),
        ),
      )
      .groupBy(commissionEvents.affiliateContactId, commissionEvents.currency);

    const profiles = await ctx.tx.select().from(affiliateTaxProfiles);
    const byContact = new Map(profiles.map((profile) => [profile.contactId, profile]));

    return paid
      .map((entry) => {
        const profile = byContact.get(entry.contactId);
        return {
          contactId: entry.contactId,
          paidMinor: entry.paidMinor,
          currency: entry.currency,
          thresholdMinor: profile?.thresholdMinor ?? 0,
          state: profile?.state ?? ("not_required" as const),
        };
      })
      .filter(
        (entry) =>
          entry.state !== "collected" &&
          entry.paidMinor > 0 &&
          entry.paidMinor >= entry.thresholdMinor,
      )
      .sort((a, b) => b.paidMinor - a.paidMinor);
  },
});

/* ------------------------------------------------------------ the spine */

registerContactReference({
  table: "commission_events",
  // Two contact columns on one table, so two updates. Repointing only the
  // affiliate would leave the duplicate id sitting in `referred_contact_id`,
  // where it would quietly survive the merge and reappear in a report.
  repoint: async (tx, duplicateId, survivingId) => {
    await tx
      .update(commissionEvents)
      .set({ affiliateContactId: survivingId })
      .where(eq(commissionEvents.affiliateContactId, duplicateId));
    await tx
      .update(commissionEvents)
      .set({ referredContactId: survivingId })
      .where(eq(commissionEvents.referredContactId, duplicateId));
  },
  captureForUndo: async (tx, duplicateId) => ({
    state: {
      affiliate: await tx
        .select({ id: commissionEvents.id })
        .from(commissionEvents)
        .where(eq(commissionEvents.affiliateContactId, duplicateId)),
      referred: await tx
        .select({ id: commissionEvents.id })
        .from(commissionEvents)
        .where(eq(commissionEvents.referredContactId, duplicateId)),
    },
    undoable: true,
  }),
  restoreAfterUndo: async (tx, beforeState, _afterState, duplicateId) => {
    const shape = z.object({
      affiliate: z.array(z.object({ id: z.string().uuid() })),
      referred: z.array(z.object({ id: z.string().uuid() })),
    });
    const before = shape.parse(beforeState);
    for (const each of before.affiliate) {
      await tx
        .update(commissionEvents)
        .set({ affiliateContactId: duplicateId })
        .where(eq(commissionEvents.id, each.id));
    }
    for (const each of before.referred) {
      await tx
        .update(commissionEvents)
        .set({ referredContactId: duplicateId })
        .where(eq(commissionEvents.id, each.id));
    }
  },
});

registerContactReference({
  table: "payout_lines",
  // A merge can put two lines for the same person on one batch, which the
  // unique index refuses. They are the same person's money, so they add up:
  // the survivor's line absorbs the duplicate's and the duplicate goes.
  repoint: async (tx, duplicateId, survivingId) => {
    const mine = await tx
      .select()
      .from(payoutLines)
      .where(eq(payoutLines.affiliateContactId, duplicateId));
    for (const line of mine) {
      const [survivor] = await tx
        .select()
        .from(payoutLines)
        .where(
          and(
            eq(payoutLines.batchId, line.batchId),
            eq(payoutLines.affiliateContactId, survivingId),
          ),
        );
      if (!survivor) {
        await tx
          .update(payoutLines)
          .set({ affiliateContactId: survivingId })
          .where(eq(payoutLines.id, line.id));
        continue;
      }
      await tx
        .update(payoutLines)
        .set({ amountMinor: survivor.amountMinor + line.amountMinor })
        .where(eq(payoutLines.id, survivor.id));
      await tx
        .update(commissionEvents)
        .set({ payoutLineId: survivor.id })
        .where(eq(commissionEvents.payoutLineId, line.id));
      await tx.delete(payoutLines).where(eq(payoutLines.id, line.id));
    }
  },
  captureForUndo: async (tx, duplicateId, survivingId) => {
    const mine = await tx
      .select({ id: payoutLines.id, batchId: payoutLines.batchId })
      .from(payoutLines)
      .where(eq(payoutLines.affiliateContactId, duplicateId));

    // Only a *collision* loses information. Moving a line to the survivor is
    // perfectly reversible, and the common case — one of the two people has
    // never been paid a commission — must stay undoable, or adding this table
    // would quietly make every merge on the platform permanent.
    let collides = false;
    for (const line of mine) {
      const [clash] = await tx
        .select({ id: payoutLines.id })
        .from(payoutLines)
        .where(
          and(
            eq(payoutLines.batchId, line.batchId),
            eq(payoutLines.affiliateContactId, survivingId),
          ),
        );
      if (clash) {
        collides = true;
        break;
      }
    }

    return {
      state: mine,
      undoable: !collides,
      // Set only when it is true. Two amounts added into one cannot be taken
      // apart again, and offering an undo that restored a wrong number would
      // be worse than declining.
      ...(collides
        ? {
            blocker:
              "Both people had a payout line on the same batch, and merging added the two amounts into one.",
          }
        : {}),
    };
  },
  restoreAfterUndo: async (tx, beforeState, _afterState, duplicateId) => {
    const rows = z
      .array(z.object({ id: z.string().uuid(), batchId: z.string().uuid() }))
      .parse(beforeState);
    for (const each of rows) {
      await tx
        .update(payoutLines)
        .set({ affiliateContactId: duplicateId })
        .where(eq(payoutLines.id, each.id));
    }
  },
});

registerContactReference({
  table: "affiliate_tax_profiles",
  // One profile per contact, so a merge between two affiliates who both have
  // paperwork must choose. The survivor's wins: it is the record that stays
  // attached to the person the owner will actually pay.
  repoint: async (tx, duplicateId, survivingId) => {
    const [survivor] = await tx
      .select({ id: affiliateTaxProfiles.id })
      .from(affiliateTaxProfiles)
      .where(eq(affiliateTaxProfiles.contactId, survivingId));
    if (survivor) {
      await tx
        .delete(affiliateTaxProfiles)
        .where(eq(affiliateTaxProfiles.contactId, duplicateId));
      return;
    }
    await tx
      .update(affiliateTaxProfiles)
      .set({ contactId: survivingId })
      .where(eq(affiliateTaxProfiles.contactId, duplicateId));
  },
  captureForUndo: async (tx, duplicateId) => ({
    state: await tx
      .select()
      .from(affiliateTaxProfiles)
      .where(eq(affiliateTaxProfiles.contactId, duplicateId)),
    undoable: true,
  }),
  restoreAfterUndo: async (tx, beforeState, _afterState, duplicateId) => {
    const rows = z
      .array(z.object({ jurisdiction: z.string(), formKind: z.string(), state: z.string() }))
      .parse(beforeState);
    for (const each of rows) {
      await tx.insert(affiliateTaxProfiles).values({
        contactId: duplicateId,
        jurisdiction: each.jurisdiction,
        formKind: each.formKind,
        state: each.state as "not_required" | "requested" | "collected" | "expired",
      });
    }
  },
});

registerContactPrivacySource({
  scope: "contact.commissions",
  tables: ["commission_events", "payout_lines", "affiliate_tax_profiles"],
  exportData: async (tx, contactId) => ({
    earned: await tx
      .select()
      .from(commissionEvents)
      .where(eq(commissionEvents.affiliateContactId, contactId)),
    // Both sides, because "a sale I was the referred customer on" is as much
    // this person's record as one they earned from.
    referred: await tx
      .select()
      .from(commissionEvents)
      .where(eq(commissionEvents.referredContactId, contactId)),
    payouts: await tx
      .select()
      .from(payoutLines)
      .where(eq(payoutLines.affiliateContactId, contactId)),
    taxProfile: await tx
      .select()
      .from(affiliateTaxProfiles)
      .where(eq(affiliateTaxProfiles.contactId, contactId)),
  }),
  erase: async (tx, contactId) => {
    // Commission events and payout lines survive, the same way invoices do.
    // They are the business's accounting record of money that actually moved,
    // and a jurisdiction that requires those kept for six years does not stop
    // requiring it because somebody asked to be forgotten. What is erasable is
    // the person, and the contact scrub handles that: once the contact is
    // gone, the rows describe an amount and a date and nobody.
    //
    // The tax profile is different and is deleted outright: a jurisdiction, a
    // form kind and a free-text note about somebody's paperwork are personal
    // data in their own right, and none of it is needed to prove a payment
    // happened.
    const profiles = await tx
      .delete(affiliateTaxProfiles)
      .where(eq(affiliateTaxProfiles.contactId, contactId))
      .returning({ id: affiliateTaxProfiles.id });
    return { affected: profiles.length };
  },
});
