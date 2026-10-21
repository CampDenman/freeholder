// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Hiring a thing out (MASTER.md §4.2, C6.10).
//
// The design decision worth reading before the code: **this module owns no
// availability.** §4.2 is explicit that a rental "reuses the scheduling
// engine's resource calendars rather than inventing a second availability
// model", so reserving a lens creates an ordinary booking on an ordinary
// resource calendar, through `bookings.create`, and the exclusion constraint
// that stops a massage room being double-booked stops the lens going out twice
// (C6.04). Nothing here counts, checks or locks anything about time.
//
// What is genuinely different about handing an object to somebody is the rest:
// a rate per hour, day or week; buffers for cleaning and charging; a deposit;
// and the four moments a booking has no concept of — reserved, out, back,
// closed.
//
// **A hire is not a payment**, the same line C6.08 drew for cancellations.
// Returns *decide* what is owed and record the decision; charging a card for a
// broken lens is a deliberate act in invoicing, with the step-up that implies.
import { z } from "zod";
import { and, asc, desc, eq, inArray, lte, sql } from "drizzle-orm";
import { listed, row, timestamp, uuid } from "@/core/contract";
import { contacts } from "@/core/contacts/schema";
import { registerContactReference } from "@/core/contacts/service";
import { registerContactPrivacySource } from "@/core/privacy/service";
import { calendars } from "@/core/scheduling/schema";
import { productVariants, products } from "@/modules/catalog/schema";
import {
  defineService,
  getService,
  ServiceError,
  type Actor,
  type ServiceContext,
} from "@/core/service";
import {
  DAMAGE_POLICIES,
  RENTAL_STATUSES,
  RENTAL_UNITS,
  RETURN_CONDITIONS,
  rentalAgreements,
  rentalTerms,
} from "./schema";
import { quoteRental, returnOutcome, type RentalTermsShape } from "./pricing";
// Claims this module's room in the customer portal (C8.11). Imported for
// its side effect: core owns the registry so it never imports a module,
// and something has to make the claim at load time.
import "./portal";

const id = z.string().uuid();

function requirePerson(actor: Actor): void {
  if (actor.kind !== "user") {
    throw new ServiceError("permission", "Sign in to manage hire.");
  }
}

const termsRow = row({
  id: uuid,
  variantId: uuid,
  calendarId: uuid,
  unit: z.enum(RENTAL_UNITS),
  minUnits: z.number().int(),
  maxUnits: z.number().int().nullable(),
  bufferBeforeHours: z.number().int(),
  bufferAfterHours: z.number().int(),
  depositMinor: z.number().int(),
  damagePolicy: z.enum(DAMAGE_POLICIES),
  replacementValueMinor: z.number().int(),
  lateFeePerUnitMinor: z.number().int(),
  conditionsBody: z.string().nullable(),
});

const agreementRow = row({
  id: uuid,
  contactId: uuid,
  variantId: uuid,
  bookingId: uuid.nullable(),
  calendarId: uuid,
  startsAt: timestamp,
  dueAt: timestamp,
  unit: z.enum(RENTAL_UNITS),
  units: z.number().int(),
  status: z.enum(RENTAL_STATUSES),
  quotedMinor: z.number().int(),
  depositMinor: z.number().int(),
  currency: z.string().nullable(),
  invoiceId: uuid.nullable(),
  pickedUpAt: timestamp.nullable(),
  returnedAt: timestamp.nullable(),
  conditionOut: z.string().nullable(),
  conditionIn: z.string().nullable(),
  returnCondition: z.enum(RETURN_CONDITIONS).nullable(),
  lateFeeMinor: z.number().int(),
  damageFeeMinor: z.number().int(),
  depositRefundMinor: z.number().int(),
  notes: z.string().nullable(),
});

function shapeOf(terms: typeof rentalTerms.$inferSelect): RentalTermsShape {
  return {
    unit: terms.unit,
    minUnits: terms.minUnits,
    maxUnits: terms.maxUnits,
    depositMinor: terms.depositMinor,
    damagePolicy: terms.damagePolicy,
    replacementValueMinor: terms.replacementValueMinor,
    lateFeePerUnitMinor: terms.lateFeePerUnitMinor,
  };
}

async function termsForVariant(
  ctx: ServiceContext,
  variantId: string,
): Promise<typeof rentalTerms.$inferSelect> {
  const [terms] = await ctx.tx
    .select()
    .from(rentalTerms)
    .where(eq(rentalTerms.variantId, variantId))
    .limit(1);
  if (!terms) {
    throw new ServiceError("validation", "That is not something the business hires out.");
  }
  return terms;
}

export const setRentalTerms = defineService({
  name: "rentals.setTerms",
  summary: "Make a catalogue variant hireable, on a resource calendar.",
  kind: "mutation",
  permission: "scoped",
  writeClass: "money",
  input: z.object({
    variantId: id,
    calendarId: id,
    unit: z.enum(RENTAL_UNITS).default("day"),
    minUnits: z.number().int().min(1).max(365).default(1),
    maxUnits: z.number().int().min(1).max(3_650).nullable().optional(),
    bufferBeforeHours: z.number().int().min(0).max(720).default(0),
    bufferAfterHours: z.number().int().min(0).max(720).default(0),
    depositMinor: z.number().int().min(0).default(0),
    damagePolicy: z.enum(DAMAGE_POLICIES).default("deposit_only"),
    replacementValueMinor: z.number().int().min(0).default(0),
    lateFeePerUnitMinor: z.number().int().min(0).default(0),
    conditionsBody: z.string().trim().max(100_000).nullable().optional(),
  }),
  output: termsRow,
  handler: async (input, ctx) => {
    requirePerson(ctx.actor);
    const [variant] = await ctx.tx
      .select({ id: productVariants.id, kind: products.kind })
      .from(productVariants)
      .innerJoin(products, eq(products.id, productVariants.productId))
      .where(eq(productVariants.id, input.variantId))
      .limit(1);
    if (!variant) throw new ServiceError("not_found", "That variant is not here.");
    if (variant.kind !== "rental") {
      // A `rental` product is what tells the storefront, the feeds and the
      // schema.org output that this is hired rather than sold. Configuring
      // hire on a physical product would make those three disagree.
      throw new ServiceError("validation", "Hire terms apply only to rental products.");
    }

    const [calendar] = await ctx.tx
      .select({ id: calendars.id, kind: calendars.kind, status: calendars.status })
      .from(calendars)
      .where(eq(calendars.id, input.calendarId))
      .limit(1);
    if (!calendar) throw new ServiceError("validation", "That calendar is not here.");
    if (calendar.kind !== "resource") {
      // §4.4: a thing's time is a resource calendar. Pointing hire at a
      // person's diary would hire out the person.
      throw new ServiceError(
        "validation",
        "Hire runs on a resource calendar — the thing itself, not somebody's diary.",
      );
    }
    if (calendar.status !== "active") {
      throw new ServiceError("validation", "That calendar takes no new bookings.");
    }
    if (input.damagePolicy === "replacement" && input.replacementValueMinor <= 0) {
      throw new ServiceError(
        "validation",
        "Say what it costs to replace before charging replacement for damage.",
      );
    }

    const values = {
      variantId: input.variantId,
      calendarId: input.calendarId,
      unit: input.unit,
      minUnits: input.minUnits,
      maxUnits: input.maxUnits ?? null,
      bufferBeforeHours: input.bufferBeforeHours,
      bufferAfterHours: input.bufferAfterHours,
      depositMinor: input.depositMinor,
      damagePolicy: input.damagePolicy,
      replacementValueMinor: input.replacementValueMinor,
      lateFeePerUnitMinor: input.lateFeePerUnitMinor,
      conditionsBody: input.conditionsBody ?? null,
      updatedAt: sql`now()`,
    };
    const [saved] = await ctx.tx
      .insert(rentalTerms)
      .values(values)
      .onConflictDoUpdate({ target: rentalTerms.variantId, set: values })
      .returning();
    ctx.setSubject("rentalTerms", saved!.id);
    return saved!;
  },
});

export const listRentalTerms = defineService({
  name: "rentals.listTerms",
  summary: "Everything the business hires out, and on what terms.",
  kind: "query",
  permission: "scoped",
  input: z.object({}),
  output: listed(termsRow.extend({ sku: z.string(), calendarName: z.string() })),
  handler: async (_input, ctx) => {
    requirePerson(ctx.actor);
    return ctx.tx
      .select({
        id: rentalTerms.id,
        variantId: rentalTerms.variantId,
        calendarId: rentalTerms.calendarId,
        unit: rentalTerms.unit,
        minUnits: rentalTerms.minUnits,
        maxUnits: rentalTerms.maxUnits,
        bufferBeforeHours: rentalTerms.bufferBeforeHours,
        bufferAfterHours: rentalTerms.bufferAfterHours,
        depositMinor: rentalTerms.depositMinor,
        damagePolicy: rentalTerms.damagePolicy,
        replacementValueMinor: rentalTerms.replacementValueMinor,
        lateFeePerUnitMinor: rentalTerms.lateFeePerUnitMinor,
        conditionsBody: rentalTerms.conditionsBody,
        sku: productVariants.sku,
        calendarName: calendars.name,
      })
      .from(rentalTerms)
      .innerJoin(productVariants, eq(productVariants.id, rentalTerms.variantId))
      .innerJoin(calendars, eq(calendars.id, rentalTerms.calendarId))
      .orderBy(asc(productVariants.sku));
  },
});

/**
 * What a hire would cost, before anybody commits to it.
 *
 * Public, because a price is what a storefront shows. The rate comes from the
 * catalogue's own resolver, so a price list, a break or a member rate applies
 * to hire exactly as it applies to a sale — there is no rental pricing engine
 * here, on purpose.
 */
export const quoteHire = defineService({
  name: "rentals.quote",
  summary: "What hiring one thing for a window would cost.",
  kind: "query",
  permission: "public",
  input: z.object({
    variantId: id,
    startsAt: z.iso.datetime(),
    endsAt: z.iso.datetime(),
    currency: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/).default("GBP"),
  }),
  output: z.object({
    available: z.boolean(),
    unit: z.enum(RENTAL_UNITS),
    units: z.number().int(),
    unitRateMinor: z.number().int(),
    hireMinor: z.number().int(),
    depositMinor: z.number().int(),
    dueNowMinor: z.number().int(),
    currency: z.string(),
    reason: z.string().nullable(),
  }),
  handler: async (input, ctx) => {
    const startsAt = new Date(input.startsAt);
    const endsAt = new Date(input.endsAt);
    if (endsAt <= startsAt) {
      throw new ServiceError("validation", "A hire ends after it starts.");
    }
    const terms = await termsForVariant(ctx, input.variantId);
    const { resolvePrice } = await import("@/modules/catalog/pricing");
    const priced = await ctx.callAsSystem(resolvePrice, {
      variantId: input.variantId,
      currency: input.currency,
      quantity: 1,
    });
    const unitRateMinor = priced.available ? (priced.totalMinor ?? 0) : 0;
    const quote = quoteRental({
      terms: shapeOf(terms),
      unitRateMinor,
      startsAt,
      endsAt,
    });
    const tooLong = terms.maxUnits !== null && quote.units > terms.maxUnits;
    return {
      available: priced.available && !tooLong,
      unit: terms.unit,
      units: quote.units,
      unitRateMinor,
      hireMinor: quote.hireMinor,
      depositMinor: quote.depositMinor,
      dueNowMinor: quote.dueNowMinor,
      currency: input.currency,
      reason: tooLong
        ? `This can be hired for at most ${terms.maxUnits} ${terms.unit}(s) at a time.`
        : priced.available
          ? null
          : (priced.reason ?? "No price for that."),
    };
  },
});

export const reserveHire = defineService({
  name: "rentals.reserve",
  summary: "Hold a thing for somebody, on its own calendar.",
  kind: "mutation",
  permission: "public",
  writeClass: "blocks",
  input: z.object({
    variantId: id,
    /** The one automated door into the spine (§2 principle 3). */
    contact: z.object({
      email: z.string().trim().email().toLowerCase(),
      name: z.string().trim().min(1).max(200).optional(),
      phone: z.string().trim().max(100).optional(),
    }),
    startsAt: z.iso.datetime(),
    endsAt: z.iso.datetime(),
    currency: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/).default("GBP"),
    notes: z.string().trim().max(2_000).nullish(),
  }),
  output: agreementRow,
  handler: async (input, ctx) => {
    const startsAt = new Date(input.startsAt);
    const dueAt = new Date(input.endsAt);
    if (dueAt <= startsAt) {
      throw new ServiceError("validation", "A hire ends after it starts.");
    }
    const terms = await termsForVariant(ctx, input.variantId);

    const quoted = (await ctx.callAsSystem(getService("rentals.quote"), {
      variantId: input.variantId,
      startsAt: input.startsAt,
      endsAt: input.endsAt,
      currency: input.currency,
    })) as {
      available: boolean;
      units: number;
      hireMinor: number;
      depositMinor: number;
      reason: string | null;
    };
    if (!quoted.available) {
      throw new ServiceError("conflict", quoted.reason ?? "That cannot be hired.");
    }

    // The booking is the hold, and the exclusion constraint on its calendar is
    // what makes it real (C6.04). Buffers widen the window so a lens that
    // needs four hours of cleaning is genuinely unavailable for them — the
    // same trick the resolver plays for a photographer's travel time.
    const held = (await ctx.callAsSystem(getService("bookings.create"), {
      calendarId: terms.calendarId,
      contact: input.contact,
      startsAt: new Date(
        startsAt.getTime() - terms.bufferBeforeHours * 3_600_000,
      ).toISOString(),
      endsAt: new Date(dueAt.getTime() + terms.bufferAfterHours * 3_600_000).toISOString(),
      source: "site",
      status: "confirmed",
      notes: input.notes ?? null,
    })) as { id: string; contactId: string };

    const [agreement] = await ctx.tx
      .insert(rentalAgreements)
      .values({
        contactId: held.contactId,
        variantId: input.variantId,
        bookingId: held.id,
        calendarId: terms.calendarId,
        startsAt,
        dueAt,
        unit: terms.unit,
        units: quoted.units,
        quotedMinor: quoted.hireMinor,
        depositMinor: quoted.depositMinor,
        currency: input.currency,
        notes: input.notes ?? null,
      })
      .returning();

    await ctx.emitTimeline({
      contactId: held.contactId,
      eventType: "rental.reserved",
      subjectType: "rental",
      subjectId: agreement!.id,
      payload: { startsAt: startsAt.toISOString(), dueAt: dueAt.toISOString() },
    });
    ctx.setSubject("rental", agreement!.id);
    ctx.queueEvent("rental.reserved", {
      id: agreement!.id,
      contactId: held.contactId,
      bookingId: held.id,
    });
    return agreement!;
  },
});

export const handOver = defineService({
  name: "rentals.handOver",
  summary: "Record that the thing has actually gone out.",
  kind: "mutation",
  permission: "scoped",
  writeClass: "write",
  input: z.object({
    id,
    condition: z.string().trim().max(2_000).nullish(),
  }),
  output: agreementRow,
  handler: async (input, ctx) => {
    requirePerson(ctx.actor);
    const [agreement] = await ctx.tx
      .select()
      .from(rentalAgreements)
      .where(eq(rentalAgreements.id, input.id))
      .limit(1);
    if (!agreement) throw new ServiceError("not_found", "That hire is not here.");
    if (agreement.status !== "reserved") {
      throw new ServiceError(
        "conflict",
        `A hire that is ${agreement.status} cannot go out again.`,
      );
    }

    const [out] = await ctx.tx
      .update(rentalAgreements)
      .set({
        status: "out",
        pickedUpAt: new Date(),
        conditionOut: input.condition ?? null,
        updatedAt: sql`now()`,
      })
      .where(eq(rentalAgreements.id, agreement.id))
      .returning();
    await ctx.emitTimeline({
      contactId: agreement.contactId,
      eventType: "rental.out",
      subjectType: "rental",
      subjectId: agreement.id,
      payload: input.condition ? { condition: input.condition } : {},
    });
    ctx.setSubject("rental", agreement.id);
    ctx.queueEvent("rental.out", { id: agreement.id, contactId: agreement.contactId });
    return out!;
  },
});

export const takeBack = defineService({
  name: "rentals.takeBack",
  summary: "Record a return, and what the terms say it comes to.",
  kind: "mutation",
  permission: "scoped",
  writeClass: "money",
  input: z.object({
    id,
    condition: z.enum(RETURN_CONDITIONS).default("fine"),
    notes: z.string().trim().max(2_000).nullish(),
    /** What the repair cost, where the policy charges for repairs. */
    repairCostMinor: z.number().int().min(0).optional(),
  }),
  output: agreementRow,
  handler: async (input, ctx) => {
    requirePerson(ctx.actor);
    const [agreement] = await ctx.tx
      .select()
      .from(rentalAgreements)
      .where(eq(rentalAgreements.id, input.id))
      .limit(1);
    if (!agreement) throw new ServiceError("not_found", "That hire is not here.");
    if (agreement.status !== "out" && agreement.status !== "overdue") {
      throw new ServiceError(
        "conflict",
        `A hire that is ${agreement.status} has nothing to come back.`,
      );
    }

    const terms = await termsForVariant(ctx, agreement.variantId);
    const returnedAt = new Date();
    // Decided and recorded, never charged. Taking money for a broken lens is
    // a deliberate act in invoicing with a step-up in front of it — not
    // something a return button does on its way past (§4.3).
    const outcome = returnOutcome({
      terms: shapeOf(terms),
      dueAt: agreement.dueAt,
      returnedAt,
      condition: input.condition,
      repairCostMinor: input.repairCostMinor,
    });

    const [returned] = await ctx.tx
      .update(rentalAgreements)
      .set({
        status: "returned",
        returnedAt,
        returnCondition: input.condition,
        conditionIn: input.notes ?? null,
        lateFeeMinor: outcome.lateFeeMinor,
        damageFeeMinor: outcome.damageFeeMinor,
        depositRefundMinor: outcome.depositRefundMinor,
        updatedAt: sql`now()`,
      })
      .where(eq(rentalAgreements.id, agreement.id))
      .returning();

    // The thing is back on the shelf, so the time it was holding is released.
    // Leaving the booking in place would keep a lens unavailable for the days
    // somebody returned it early.
    if (agreement.bookingId && returnedAt < agreement.dueAt) {
      await ctx.callAsSystem(getService("bookings.setStatus"), {
        id: agreement.bookingId,
        status: "completed",
      });
    }

    await ctx.emitTimeline({
      contactId: agreement.contactId,
      eventType: "rental.returned",
      subjectType: "rental",
      subjectId: agreement.id,
      payload: {
        condition: input.condition,
        lateFeeMinor: outcome.lateFeeMinor,
        damageFeeMinor: outcome.damageFeeMinor,
        depositRefundMinor: outcome.depositRefundMinor,
        reason: outcome.reason,
      },
    });
    ctx.setSubject("rental", agreement.id);
    ctx.queueEvent("rental.returned", {
      id: agreement.id,
      contactId: agreement.contactId,
      outstandingMinor: outcome.outstandingMinor,
    });
    return returned!;
  },
});

export const listHires = defineService({
  name: "rentals.list",
  summary: "What is out, what is due back, and what has closed.",
  kind: "query",
  permission: "scoped",
  // C8.11: the customer this asks about may ask it themselves. The
  // contract layer verifies the field is present and is their own contact
  // before the handler runs, so this widens what a customer can *see*
  // about themselves and nothing else.
  selfService: { contactField: "contactId" },
  input: z.object({
    status: z.enum(RENTAL_STATUSES).optional(),
    contactId: id.optional(),
    limit: z.number().int().min(1).max(200).default(50),
  }),
  output: listed(
    agreementRow.extend({
      sku: z.string(),
      contactName: z.string().nullable(),
      contactEmail: z.string().nullable(),
    }),
  ),
  handler: async (input, ctx) => {
    requirePerson(ctx.actor);
    return ctx.tx
      .select({
        id: rentalAgreements.id,
        contactId: rentalAgreements.contactId,
        variantId: rentalAgreements.variantId,
        bookingId: rentalAgreements.bookingId,
        calendarId: rentalAgreements.calendarId,
        startsAt: rentalAgreements.startsAt,
        dueAt: rentalAgreements.dueAt,
        unit: rentalAgreements.unit,
        units: rentalAgreements.units,
        status: rentalAgreements.status,
        quotedMinor: rentalAgreements.quotedMinor,
        depositMinor: rentalAgreements.depositMinor,
        currency: rentalAgreements.currency,
        invoiceId: rentalAgreements.invoiceId,
        pickedUpAt: rentalAgreements.pickedUpAt,
        returnedAt: rentalAgreements.returnedAt,
        conditionOut: rentalAgreements.conditionOut,
        conditionIn: rentalAgreements.conditionIn,
        returnCondition: rentalAgreements.returnCondition,
        lateFeeMinor: rentalAgreements.lateFeeMinor,
        damageFeeMinor: rentalAgreements.damageFeeMinor,
        depositRefundMinor: rentalAgreements.depositRefundMinor,
        notes: rentalAgreements.notes,
        sku: productVariants.sku,
        contactName: contacts.name,
        contactEmail: contacts.email,
      })
      .from(rentalAgreements)
      .innerJoin(productVariants, eq(productVariants.id, rentalAgreements.variantId))
      .innerJoin(contacts, eq(contacts.id, rentalAgreements.contactId))
      .where(
        and(
          input.status ? eq(rentalAgreements.status, input.status) : undefined,
          input.contactId ? eq(rentalAgreements.contactId, input.contactId) : undefined,
        ),
      )
      .orderBy(desc(rentalAgreements.dueAt))
      .limit(input.limit);
  },
});

/**
 * Mark what has not come back.
 *
 * Its own status rather than a computed one, because "overdue" is something an
 * owner acts on — a list to chase, a fee that is accruing — and a derived flag
 * that only exists while somebody is looking at the right screen is not a list.
 */
export const markOverdue = defineService({
  name: "rentals.markOverdue",
  summary: "Move hires past their return time into overdue.",
  kind: "mutation",
  permission: "scoped",
  agentCallable: false,
  writeClass: "write",
  input: z.object({}),
  output: z.object({ overdue: z.number().int() }),
  handler: async (_input, ctx) => {
    const rows = await ctx.tx
      .update(rentalAgreements)
      .set({ status: "overdue", updatedAt: sql`now()` })
      .where(
        and(
          eq(rentalAgreements.status, "out"),
          lte(rentalAgreements.dueAt, new Date()),
        ),
      )
      .returning({ id: rentalAgreements.id, contactId: rentalAgreements.contactId });
    for (const overdue of rows) {
      ctx.queueEvent("rental.overdue", { id: overdue.id, contactId: overdue.contactId });
    }
    return { overdue: rows.length };
  },
});

export const closeHire = defineService({
  name: "rentals.close",
  summary: "Settle a returned hire and close it.",
  kind: "mutation",
  permission: "scoped",
  writeClass: "money",
  stepUp: true,
  input: z.object({ id, invoiceId: id.nullable().optional() }),
  output: agreementRow,
  handler: async (input, ctx) => {
    requirePerson(ctx.actor);
    const [closed] = await ctx.tx
      .update(rentalAgreements)
      .set({
        status: "closed",
        // The link to the one money object (§4.3), recorded when the owner has
        // actually settled it rather than assumed by the return.
        ...(input.invoiceId !== undefined ? { invoiceId: input.invoiceId } : {}),
        updatedAt: sql`now()`,
      })
      .where(
        and(eq(rentalAgreements.id, input.id), eq(rentalAgreements.status, "returned")),
      )
      .returning();
    if (!closed) {
      throw new ServiceError("conflict", "Only a returned hire can be closed.");
    }
    ctx.setSubject("rental", closed.id);
    return closed;
  },
});

/**
 * What a merge means for a hire (CLAUDE.md's non-negotiable).
 *
 * Unconditional. Who has the tripod is a fact about a person, and leaving it
 * pointing at the record that no longer exists would lose the one row that
 * says where the business's equipment went.
 */
registerContactReference({
  table: "rental_agreements",
  repoint: (tx, duplicateId, survivingId) =>
    tx
      .update(rentalAgreements)
      .set({ contactId: survivingId })
      .where(eq(rentalAgreements.contactId, duplicateId)),
  captureForUndo: async (tx, duplicateId, survivingId) => ({
    state: await tx
      .select({ id: rentalAgreements.id, contactId: rentalAgreements.contactId })
      .from(rentalAgreements)
      .where(inArray(rentalAgreements.contactId, [duplicateId, survivingId])),
    undoable: true,
  }),
  restoreAfterUndo: async (tx, beforeState, _afterState, duplicateId) => {
    const moved = z
      .array(z.object({ id: z.string().uuid(), contactId: z.string().uuid().nullable() }))
      .parse(beforeState)
      .filter((hire) => hire.contactId === duplicateId);
    if (moved.length) {
      await tx
        .update(rentalAgreements)
        .set({ contactId: duplicateId })
        .where(inArray(rentalAgreements.id, moved.map((hire) => hire.id)));
    }
  },
});

/**
 * What a hire means for the person's own data (§30).
 *
 * The row survives and the person goes, as with a booking: a hire is also the
 * business's own record of where its equipment went and what it was charged
 * for, and deleting it would take the business's history with the customer's.
 */
registerContactPrivacySource({
  scope: "contact.rentals",
  tables: ["rental_agreements"],
  exportData: (tx, contactId) =>
    tx
      .select()
      .from(rentalAgreements)
      .where(eq(rentalAgreements.contactId, contactId))
      .orderBy(asc(rentalAgreements.startsAt)),
  erase: async (tx, contactId) => {
    const rows = await tx
      .update(rentalAgreements)
      .set({
        notes: null,
        conditionOut: null,
        conditionIn: null,
        updatedAt: sql`now()`,
      })
      .where(eq(rentalAgreements.contactId, contactId))
      .returning({ id: rentalAgreements.id });
    return { affected: rows.length };
  },
});

export default [
  setRentalTerms,
  listRentalTerms,
  quoteHire,
  reserveHire,
  handOver,
  takeBack,
  listHires,
  markOverdue,
  closeHire,
];
