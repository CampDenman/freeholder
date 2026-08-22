// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// What an accepted quote becomes (MASTER.md §4.3, C6.13).
//
// §4.3 draws it:
//
//   accepted → [Contract if required] → Invoice(deposit) → Invoice(balance)
//
// Three rules hold this file up.
//
// **Atomically.** One transaction produces the project, the agreement, the
// bookings and the invoices, or produces none of them. A half-converted quote
// is the worst possible state: an invoice with no job to explain it, or a job
// with no invoice, and an owner who has to work out which by hand.
//
// **Without copied customer identities.** Every record points at the same
// `contact_id` the quote already had. Nothing here calls `contacts.create`,
// nothing re-resolves an email, and nothing invents a "billing contact" — the
// person who accepted is the person on the invoice, the agreement and the
// appointment, and that is the spine rule applied at the one moment a system
// is most tempted to break it.
//
// **After the acceptance commits, not during it.** The customer's click must
// survive whatever happens next: if invoicing were briefly unable to write,
// converting inside the acceptance would roll back the fact that they said
// yes. So acceptance commits, the event fires, and conversion runs in its own
// all-or-nothing transaction — the same shape C6.06 used for an upstream
// calendar write, and for the same reason.
import { z } from "zod";
import { eq, sql } from "drizzle-orm";
import { listed, row, uuid } from "@/core/contract";
import {
  defineService,
  getService,
  listServices,
  ServiceError,
  type ServiceContext,
} from "@/core/service";
import { quotes } from "./schema";

const id = z.string().uuid();

/**
 * What acceptance should produce, decided per quote.
 *
 * Per quote rather than per instance, because a kitchen refit and a one-hour
 * consultation are not the same job even in the same business. Everything is
 * optional and the defaults produce a project and an invoice, which is what
 * the great majority of accepted quotes need.
 */
export const conversionPlan = z.object({
  /** Gather the job into a project (C6.15). */
  project: z.boolean().default(true),
  /** Issue this agreement for signing (C6.14). Null means none is required. */
  contractTemplateId: id.nullable().default(null),
  /** Raise the deposit invoice named on the quote, if there is one. */
  deposit: z.boolean().default(true),
  /** Raise the balance, or the whole amount when there is no deposit. */
  balance: z.boolean().default(true),
  /**
   * Appointments to put in the diary.
   *
   * Times come from the owner rather than from the quote, deliberately: a
   * quote carries a price and a scope, never a date, and a conversion that
   * invented one would put a fiction in somebody's diary. An owner who knows
   * when the work happens says so here; one who does not leaves it empty and
   * books it later.
   */
  bookings: z
    .array(
      z.object({
        calendarId: id,
        startsAt: z.iso.datetime(),
        endsAt: z.iso.datetime(),
      }),
    )
    .max(20)
    .default([]),
});

export type ConversionPlan = z.infer<typeof conversionPlan>;

const DEFAULT_PLAN: ConversionPlan = {
  project: true,
  contractTemplateId: null,
  deposit: true,
  balance: true,
  bookings: [],
};

function planFrom(stored: unknown): ConversionPlan {
  const parsed = conversionPlan.safeParse(stored);
  return parsed.success ? parsed.data : DEFAULT_PLAN;
}

const acceptedSnapshot = z.object({
  currency: z.string(),
  totals: z.object({ totalMinor: z.number().int() }),
  items: z.array(
    z.object({
      description: z.string(),
      quantityMicros: z.number().int(),
      unitPriceMinor: z.number().int(),
    }),
  ),
});

export const setQuoteConversion = defineService({
  name: "quotes.setConversion",
  summary: "Say what accepting this quote should set in motion.",
  kind: "mutation",
  permission: "scoped",
  writeClass: "write",
  input: z.object({ id, plan: conversionPlan }),
  output: row({ id: uuid, plan: conversionPlan }),
  handler: async (input, ctx) => {
    if (ctx.actor.kind !== "user") {
      throw new ServiceError("permission", "Sign in to manage quotes.");
    }
    const [updated] = await ctx.tx
      .update(quotes)
      .set({ conversionPlan: input.plan, updatedAt: sql`now()` })
      .where(eq(quotes.id, input.id))
      .returning({ id: quotes.id, plan: quotes.conversionPlan });
    if (!updated) throw new ServiceError("not_found", "That quote is not here.");
    ctx.setSubject("quote", updated.id);
    return { id: updated.id, plan: planFrom(updated.plan) };
  },
});

export interface ConversionResult {
  projectId: string | null;
  contractId: string | null;
  bookingIds: string[];
  invoiceIds: string[];
  /** What could not be produced, and why, in words an owner can act on. */
  skipped: string[];
}

/** Attach something to the project, when there is one. */
async function attach(
  ctx: ServiceContext,
  projectId: string | null,
  kind: string,
  targetId: string,
  label?: string,
): Promise<void> {
  if (!projectId) return;
  if (!listServices().has("projects.link")) return;
  await ctx.call(getService("projects.link"), {
    projectId,
    kind,
    targetId,
    label: label ?? null,
  });
}

export const convertQuote = defineService({
  name: "quotes.convert",
  summary: "Turn an accepted quote into the job, the agreement and the invoices.",
  kind: "mutation",
  permission: "scoped",
  agentCallable: false,
  writeClass: "money",
  input: z.object({ id }),
  output: row({
    projectId: uuid.nullable(),
    contractId: uuid.nullable(),
    bookingIds: listed(uuid),
    invoiceIds: listed(uuid),
    skipped: listed(z.string()),
  }),
  handler: async (input, ctx) => {
    const [quote] = await ctx.tx.select().from(quotes).where(eq(quotes.id, input.id)).limit(1);
    if (!quote) throw new ServiceError("not_found", "That quote is not here.");
    if (quote.status !== "accepted") {
      throw new ServiceError(
        "conflict",
        "Only an accepted quote turns into work. This one is still open.",
      );
    }
    if (quote.convertedAt) {
      // Converting twice would produce a second invoice for one job, which is
      // the mistake an owner discovers from a customer.
      throw new ServiceError("conflict", "This quote has already been turned into work.");
    }

    const snapshot = acceptedSnapshot.safeParse(quote.acceptedSnapshot);
    if (!snapshot.success) {
      throw new ServiceError(
        "conflict",
        "This quote has no record of what was accepted, so there is nothing to convert.",
      );
    }
    const accepted = snapshot.data;
    const plan = planFrom(quote.conversionPlan);
    const skipped: string[] = [];

    // The contact travels; it is never re-created. This is the line C6.13
    // exists to hold, and it is one assignment repeated rather than a
    // resolution repeated — nothing below asks the spine for a contact again.
    const contactId = quote.contactId;

    let projectId: string | null = null;
    if (plan.project) {
      if (!listServices().has("projects.create")) {
        skipped.push("Projects are switched off, so no job record was made.");
      } else {
        const project = (await ctx.call(getService("projects.create"), {
          title: quote.title,
          contactId,
          // The quote's `notes` are deliberately not carried across. They are
          // what the business wrote *about* the customer while pricing the
          // job, and a project summary is a line C8.01 may one day publish.
          // A converted quote is work that is going ahead, not an enquiry.
          slug: `${quote.reference.toLowerCase()}-${quote.title
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/^-+|-+$/g, "")
            .slice(0, 80)}`,
        })) as { id: string };
        projectId = project.id;
        await ctx.call(getService("projects.update"), {
          id: projectId,
          status: "active",
        });
        await attach(ctx, projectId, "quote", quote.id, quote.reference);
      }
    }

    let contractId: string | null = null;
    if (plan.contractTemplateId) {
      if (!listServices().has("contracts.issueFromTemplate")) {
        skipped.push("Agreements are switched off, so none was issued.");
      } else {
        const issued = (await ctx.call(getService("contracts.issueFromTemplate"), {
          templateId: plan.contractTemplateId,
          contactId,
          // Hung off the project when there is one, so the signed agreement
          // sits with the job rather than beside it.
          subjectType: projectId ? "project" : "quote",
          subjectId: projectId ?? quote.id,
        })) as { id: string };
        contractId = issued.id;
        await attach(ctx, projectId, "contract", contractId, quote.title);
      }
    }

    const bookingIds: string[] = [];
    for (const slot of plan.bookings) {
      if (!listServices().has("bookings.create")) {
        skipped.push("Scheduling is switched off, so nothing was put in the diary.");
        break;
      }
      const booked = (await ctx.call(getService("bookings.create"), {
        calendarId: slot.calendarId,
        // The one shape `bookings.create` takes for a customer. `contacts
        // .resolve` behind it is idempotent on email, so this returns the
        // existing contact rather than making a second one — which is what
        // keeps "without copied customer identities" true through a service
        // that was written to accept a stranger.
        contact: { email: await emailFor(ctx, contactId) },
        startsAt: slot.startsAt,
        endsAt: slot.endsAt,
        source: "admin",
        status: "confirmed",
        notes: `${quote.reference}: ${quote.title}`,
      })) as { id: string };
      bookingIds.push(booked.id);
      await attach(ctx, projectId, "booking", booked.id, quote.title);
    }

    const invoiceIds: string[] = [];
    if (plan.deposit || plan.balance) {
      if (!listServices().has("invoicing.createDraft")) {
        skipped.push("Invoicing is switched off, so nothing was raised.");
      } else {
        const depositMinor = plan.deposit ? (quote.depositMinor ?? 0) : 0;
        const totalMinor = accepted.totals.totalMinor;

        if (depositMinor > 0) {
          const draft = (await ctx.call(getService("invoicing.createDraft"), {
            contactId,
            currency: accepted.currency,
            sourceType: "deposit",
            sourceId: quote.id,
            // Stable per quote, so a retried conversion never raises a second
            // invoice even if something after it failed the first time.
            idempotencyKey: `quote:${quote.id}:deposit`,
            lines: [
              {
                description: `Deposit — ${quote.title}`,
                quantityMicros: 1_000_000,
                unitAmountMinor: depositMinor,
              },
            ],
            // Left to the owner at issue time. A conversion has no addresses
            // to calculate from, and guessing a tax treatment on somebody's
            // behalf is the one thing an accounting system must not do.
            tax: {
              mode: "not_applicable",
              reason: `Converted from ${quote.reference}; tax applied when issued.`,
            },
          })) as { invoice: { id: string } };
          invoiceIds.push(draft.invoice.id);
          await attach(ctx, projectId, "invoice", draft.invoice.id, "Deposit");
        }

        const balanceMinor = totalMinor - depositMinor;
        if (plan.balance && balanceMinor > 0) {
          const draft = (await ctx.call(getService("invoicing.createDraft"), {
            contactId,
            currency: accepted.currency,
            sourceType: depositMinor > 0 ? "balance" : "quote",
            sourceId: quote.id,
            idempotencyKey: `quote:${quote.id}:balance`,
            // The lines the customer actually accepted, one for one. A single
            // "as quoted" line would lose what they agreed to at the exact
            // moment it starts mattering.
            lines:
              depositMinor > 0
                ? [
                    {
                      description: `Balance — ${quote.title}`,
                      quantityMicros: 1_000_000,
                      unitAmountMinor: balanceMinor,
                    },
                  ]
                : accepted.items.map((line) => ({
                    description: line.description,
                    quantityMicros: line.quantityMicros,
                    unitAmountMinor: line.unitPriceMinor,
                  })),
            tax: {
              mode: "not_applicable",
              reason: `Converted from ${quote.reference}; tax applied when issued.`,
            },
          })) as { invoice: { id: string } };
          invoiceIds.push(draft.invoice.id);
          await attach(ctx, projectId, "invoice", draft.invoice.id, "Balance");
        }
      }
    }

    await ctx.tx
      .update(quotes)
      .set({ convertedAt: new Date(), updatedAt: sql`now()` })
      .where(eq(quotes.id, quote.id));

    await ctx.emitTimeline({
      contactId,
      eventType: "quote.converted",
      subjectType: "quote",
      subjectId: quote.id,
      payload: { projectId, contractId, invoiceIds, bookingIds, skipped },
    });
    ctx.setSubject("quote", quote.id);
    ctx.queueEvent("quote.converted", {
      id: quote.id,
      contactId,
      projectId,
      invoiceIds,
    });
    return { projectId, contractId, bookingIds, invoiceIds, skipped };
  },
});

/**
 * The email of a contact that already exists.
 *
 * Read rather than resolved. `bookings.create` takes a customer's email
 * because it was written for a stranger arriving on the public site; here the
 * customer is already known, and looking their address up keeps the booking
 * pointing at the same contact rather than at a second one that happens to
 * match.
 */
async function emailFor(ctx: ServiceContext, contactId: string): Promise<string> {
  const { contacts } = await import("@/core/contacts/schema");
  const [contact] = await ctx.tx
    .select({ email: contacts.email })
    .from(contacts)
    .where(eq(contacts.id, contactId))
    .limit(1);
  if (!contact?.email) {
    throw new ServiceError(
      "conflict",
      "This customer has no email address, so the work cannot be put in the diary.",
    );
  }
  return contact.email;
}

/**
 * Convert in response to a committed acceptance.
 *
 * On the event bus rather than inside `quotes.accept`, because the customer's
 * click must survive whatever happens next: converting inside the acceptance
 * would mean a brief failure in invoicing rolled back the fact that they said
 * yes. The conversion itself is still atomic — one transaction, all four or
 * none — it simply is not the *same* transaction.
 *
 * Never throws into the bus. A quote that could not be converted is still an
 * accepted quote, and `quotes.convert` is there for the owner to run again.
 */
export async function convertOnAccepted(
  eventName: string,
  payload: unknown,
): Promise<void> {
  if (eventName !== "quote.accepted") return;
  const record =
    payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
  const quoteId = typeof record.id === "string" ? record.id : null;
  if (!quoteId) return;

  try {
    await convertQuote.call({ id: quoteId }, { kind: "system" });
  } catch (error) {
    // The acceptance has committed and is correct, which is the fact that
    // matters. The owner sees the quote as accepted and unconverted, and can
    // convert it themselves.
    console.warn(`[quotes] ${quoteId} accepted but not converted`, error);
  }
}

export default [setQuoteConversion, convertQuote];
