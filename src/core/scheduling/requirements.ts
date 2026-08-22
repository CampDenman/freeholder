// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// What has to be true before a slot is confirmed (MASTER.md §4.4, C6.09).
//
// §4.4: "Intake and waivers are part of the booking, not an afterthought: a
// service may require a form submission (§4.6) and an e-signed waiver (§4.3's
// `Contract`) **before the slot is confirmed**, and the booking holds a
// reference to both."
//
// Two design decisions carry this file.
//
// **The gate is on confirming, not on booking.** A customer who cannot book
// until they have signed a waiver is a customer who leaves. They book, they
// hold the slot, and the requirements are what stands between "requested" and
// "confirmed" — which is exactly the distinction the state machine already
// made and nothing had yet used.
//
// **Requirements are read, never cached.** A booking does not store "needs a
// waiver"; it stores what it *has*, and the offering says what it needs. An
// owner who adds an intake form to a service tomorrow wants tomorrow's
// bookings to ask for it, and a snapshot would quietly exempt everything
// already in the diary. This is the opposite of the cancellation policy, which
// *is* snapshotted — and the difference is that a policy is a promise made to
// the customer while a requirement is a condition the business sets for
// itself.
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { row, uuid } from "@/core/contract";
import { bookings } from "@/core/scheduling/schema";
import {
  defineService,
  getService,
  listServices,
  ServiceError,
  type ServiceContext,
} from "@/core/service";

export interface OfferingRequirements {
  intakeFormId: string | null;
  waiverTitle: string | null;
  waiverBody: string | null;
  reminderOffsetsMin: number[];
}

const NONE: OfferingRequirements = {
  intakeFormId: null,
  waiverTitle: null,
  waiverBody: null,
  reminderOffsetsMin: [],
};

/**
 * What the offering asks for, through the registry.
 *
 * Catalog switched off is not an error — it is an instance that sells time
 * without a catalogue, whose bookings ask for nothing. Same seam, same
 * direction and same graceful absence as the cancellation terms (C6.08).
 */
export async function requirementsFor(
  ctx: ServiceContext,
  serviceOfferingId: string | null,
): Promise<OfferingRequirements> {
  if (!serviceOfferingId) return NONE;
  if (!listServices().has("catalog.bookingRequirements")) return NONE;
  const found = (await ctx.callAsSystem(getService("catalog.bookingRequirements"), {
    serviceOfferingId,
  })) as OfferingRequirements | null;
  return found ?? NONE;
}

export interface Outstanding {
  /** The intake form still to be filled in, if any. */
  intakeFormId: string | null;
  /** True when a waiver is asked for and not yet signed. */
  waiverOutstanding: boolean;
  waiverTitle: string | null;
  /** Everything in one word, because that is what a caller acts on. */
  ready: boolean;
}

/**
 * Whether a booking has everything its service asks for.
 *
 * The waiver question is asked of the contracts module rather than of a column
 * on the booking, because "signed" is the contract's fact and duplicating it
 * here would create two records that can disagree about whether somebody
 * signed. `bookings.waiverId` is the pointer, not the answer.
 */
export async function outstandingFor(
  ctx: ServiceContext,
  booking: {
    id: string;
    serviceOfferingId: string | null;
    intakeSubmissionId: string | null;
    waiverId: string | null;
  },
): Promise<Outstanding> {
  const needs = await requirementsFor(ctx, booking.serviceOfferingId);
  const intakeFormId =
    needs.intakeFormId && !booking.intakeSubmissionId ? needs.intakeFormId : null;

  let waiverOutstanding = false;
  if (needs.waiverBody) {
    if (!listServices().has("contracts.signedFor")) {
      // The service asks for a waiver and nothing in this instance can hold
      // one. Refusing to confirm forever would be worse than confirming: the
      // owner has switched off the module that would satisfy the requirement,
      // and that is a configuration answer rather than a customer's problem.
      waiverOutstanding = false;
    } else {
      const answer = (await ctx.callAsSystem(getService("contracts.signedFor"), {
        subjectType: "booking",
        subjectId: booking.id,
        kind: "waiver",
      })) as { signed: boolean };
      waiverOutstanding = !answer.signed;
    }
  }

  return {
    intakeFormId,
    waiverOutstanding,
    waiverTitle: waiverOutstanding ? needs.waiverTitle : null,
    ready: !intakeFormId && !waiverOutstanding,
  };
}

export const bookingRequirements = defineService({
  name: "bookings.requirements",
  summary: "What is still outstanding before an appointment can be confirmed.",
  kind: "query",
  permission: "scoped",
  input: z.object({ id: z.uuid() }),
  output: row({
    intakeFormId: uuid.nullable(),
    waiverOutstanding: z.boolean(),
    waiverTitle: z.string().nullable(),
    ready: z.boolean(),
  }).nullable(),
  handler: async (input, ctx) => {
    const [booking] = await ctx.tx
      .select({
        id: bookings.id,
        serviceOfferingId: bookings.serviceOfferingId,
        intakeSubmissionId: bookings.intakeSubmissionId,
        waiverId: bookings.waiverId,
      })
      .from(bookings)
      .where(eq(bookings.id, input.id))
      .limit(1);
    if (!booking) return null;
    return outstandingFor(ctx, booking);
  },
});

export const attachIntake = defineService({
  name: "bookings.attachIntake",
  summary: "Record the intake form somebody filled in for their appointment.",
  kind: "mutation",
  permission: "scoped",
  agentCallable: false,
  writeClass: "write",
  input: z.object({ id: z.uuid(), submissionId: z.uuid() }),
  output: row({ id: uuid, intakeSubmissionId: uuid.nullable() }),
  handler: async (input, ctx) => {
    const [updated] = await ctx.tx
      .update(bookings)
      .set({ intakeSubmissionId: input.submissionId })
      .where(eq(bookings.id, input.id))
      .returning({
        id: bookings.id,
        intakeSubmissionId: bookings.intakeSubmissionId,
      });
    if (!updated) throw new ServiceError("not_found", "No such appointment.");
    ctx.setSubject("booking", updated.id);
    ctx.queueEvent("booking.intakeReceived", { id: updated.id });
    return updated;
  },
});

/**
 * The customer attaching their own intake form, by the link they hold.
 *
 * Public for the same reason rescheduling is (§4.4): the person filling in an
 * intake form has no account, and requiring one would put a password between a
 * customer and a questionnaire the business asked them for. The token is the
 * authorisation, and it only ever attaches to the booking it belongs to — a
 * `submissionId` from somewhere else lands on *this* appointment or nowhere.
 */
export const attachIntakeByToken = defineService({
  name: "bookings.attachIntakeByToken",
  summary: "Record the intake a customer filled in for their own appointment.",
  kind: "mutation",
  permission: "public",
  mcpExclude: true,
  agentCallable: false,
  writeClass: "write",
  input: z.object({
    token: z.string().trim().min(16).max(200),
    submissionId: z.uuid(),
  }),
  output: row({ id: uuid }),
  handler: async (input, ctx) => {
    const [updated] = await ctx.tx
      .update(bookings)
      .set({ intakeSubmissionId: input.submissionId })
      .where(eq(bookings.rescheduleToken, input.token))
      .returning({ id: bookings.id });
    if (!updated) throw new ServiceError("not_found", "That link is no longer valid.");
    ctx.setSubject("booking", updated.id);
    ctx.queueEvent("booking.intakeReceived", { id: updated.id });
    return updated;
  },
});

/**
 * Put the waiver this appointment needs in front of its customer.
 *
 * Issuing is idempotent in the contracts module, so calling this twice returns
 * the outstanding document rather than a second one — which matters, because
 * the link is already in somebody's inbox.
 */
export const issueBookingWaiver = defineService({
  name: "bookings.issueWaiver",
  summary: "Send the waiver a service asks for to the customer.",
  kind: "mutation",
  permission: "scoped",
  agentCallable: false,
  writeClass: "write",
  input: z.object({ id: z.uuid() }),
  output: row({ contractId: uuid.nullable(), reason: z.string().nullable() }),
  handler: async (input, ctx) => {
    const [booking] = await ctx.tx
      .select({
        id: bookings.id,
        contactId: bookings.contactId,
        serviceOfferingId: bookings.serviceOfferingId,
      })
      .from(bookings)
      .where(eq(bookings.id, input.id))
      .limit(1);
    if (!booking) throw new ServiceError("not_found", "No such appointment.");

    const needs = await requirementsFor(ctx, booking.serviceOfferingId);
    if (!needs.waiverBody) {
      return { contractId: null, reason: "This service asks for no waiver." };
    }
    if (!listServices().has("contracts.issue")) {
      return { contractId: null, reason: "Agreements are switched off on this instance." };
    }

    const issued = (await ctx.callAsSystem(getService("contracts.issue"), {
      contactId: booking.contactId,
      subjectType: "booking",
      subjectId: booking.id,
      kind: "waiver",
      title: needs.waiverTitle ?? "Waiver",
      body: needs.waiverBody,
    })) as { id: string };

    await ctx.tx
      .update(bookings)
      .set({ waiverId: issued.id })
      .where(eq(bookings.id, booking.id));
    ctx.setSubject("booking", booking.id);
    return { contractId: issued.id, reason: null };
  },
});

/**
 * Record a signed waiver against the booking it was issued for.
 *
 * On the event bus rather than inside `contracts.sign`, because contracts must
 * not know what a booking is — §11's dependency direction is what keeps the
 * module installable on an instance that sells no time at all.
 */
export async function linkSignedWaiver(
  eventName: string,
  payload: unknown,
): Promise<void> {
  if (eventName !== "contract.signed") return;
  const record =
    payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
  if (record.subjectType !== "booking") return;
  const contractId = typeof record.id === "string" ? record.id : null;
  const bookingId = typeof record.subjectId === "string" ? record.subjectId : null;
  if (!contractId || !bookingId) return;

  try {
    const { db } = await import("@/core/db");
    await db()
      .update(bookings)
      .set({ waiverId: contractId })
      .where(and(eq(bookings.id, bookingId), eq(bookings.waiverId, contractId)));
  } catch (error) {
    // The signature has committed and is the record that matters. A pointer
    // that failed to update is a display problem, not a legal one.
    console.warn(`[scheduling] could not link waiver ${contractId}`, error);
  }
}

export default [
  bookingRequirements,
  attachIntake,
  attachIntakeByToken,
  issueBookingWaiver,
];
