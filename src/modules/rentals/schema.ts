// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Equipment and space hire (MASTER.md §4.2, C6.10).
//
// §4.2 settles the design in one sentence: "A rental is a bookable *thing*
// rather than a bookable *person*, so it **reuses the scheduling engine's
// resource calendars (§4.4) rather than inventing a second availability
// model**."
//
// So there is no rental availability here, and there is deliberately no rental
// calendar. A rentable lens *is* a resource calendar (C6.01 already models
// one), a hire *is* a booking on it (C6.07), and the exclusion constraint that
// stops a massage room being double-booked stops the same lens going out twice
// without another line of code. What this module adds is everything that is
// genuinely different about handing an object to somebody: what it costs by
// the hour or the week, what it is worth if it does not come back, and the
// four moments — reserved, out, back, closed — that a booking has no concept
// of.
import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { contacts } from "@/core/contacts/schema";
import { bookings, calendars } from "@/core/scheduling/schema";
import { createdAtColumn, updatedAtColumn } from "@/core/db/columns";
import { productVariants } from "@/modules/catalog/schema";

export const RENTAL_UNITS = ["hour", "day", "week"] as const;
/** §4.2's `RentalTerms.damage_policy`, as the three answers owners give. */
export const DAMAGE_POLICIES = ["deposit_only", "repair_cost", "replacement"] as const;

/**
 * What one rentable variant costs and what it is worth (§4.2's `RentalTerms`).
 *
 * Per variant rather than per product, because "the 50mm" and "the 85mm" are
 * variants of one lens hire and they are not worth the same. The rate itself
 * is **not** here: pricing is the catalogue's (§4.2's price lists and breaks),
 * and a second place to write a number is a second answer to "what does this
 * cost" the first time somebody edits one of them.
 */
export const rentalTerms = pgTable(
  "rental_terms",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    variantId: uuid("variant_id")
      .notNull()
      .references(() => productVariants.id, { onDelete: "cascade" }),
    /**
     * The resource calendar this thing's time is spent on.
     *
     * The whole of §4.2's "reuses the scheduling engine" is this column. A
     * rental with no calendar is a rental nothing can stop being double-booked,
     * so it is `notNull` — the seam is not optional.
     */
    calendarId: uuid("calendar_id")
      .notNull()
      .references(() => calendars.id, { onDelete: "restrict" }),
    unit: text("unit", { enum: RENTAL_UNITS }).notNull().default("day"),
    minUnits: integer("min_units").notNull().default(1),
    maxUnits: integer("max_units"),
    /** Turnaround: cleaning, charging, checking. Time nobody else may book. */
    bufferBeforeHours: integer("buffer_before_hours").notNull().default(0),
    bufferAfterHours: integer("buffer_after_hours").notNull().default(0),
    /** Held against damage, in integer minor units (§4.3). */
    depositMinor: bigint("deposit_minor", { mode: "number" }).notNull().default(0),
    damagePolicy: text("damage_policy", { enum: DAMAGE_POLICIES })
      .notNull()
      .default("deposit_only"),
    /** What it costs to replace outright, which is what "lost" means. */
    replacementValueMinor: bigint("replacement_value_minor", { mode: "number" })
      .notNull()
      .default(0),
    /** Charged per unit late, so an owner sets one number rather than a rule. */
    lateFeePerUnitMinor: bigint("late_fee_per_unit_minor", { mode: "number" })
      .notNull()
      .default(0),
    /** What the customer is asked to agree to. Words, as with waivers (C6.09). */
    conditionsBody: text("conditions_body"),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [
    uniqueIndex("rental_terms_variant_idx").on(t.variantId),
    index("rental_terms_calendar_idx").on(t.calendarId),
    check("rental_terms_min_units", sql`${t.minUnits} > 0`),
    check(
      "rental_terms_max_units",
      sql`${t.maxUnits} is null or ${t.maxUnits} >= ${t.minUnits}`,
    ),
    check("rental_terms_buffers", sql`${t.bufferBeforeHours} >= 0 and ${t.bufferAfterHours} >= 0`),
    check("rental_terms_money", sql`${t.depositMinor} >= 0
      and ${t.replacementValueMinor} >= 0
      and ${t.lateFeePerUnitMinor} >= 0`),
    // A policy that charges for a replacement without knowing what one costs
    // produces a fee of zero at the exact moment the business needs a number.
    check(
      "rental_terms_replacement_known",
      sql`${t.damagePolicy} <> 'replacement' or ${t.replacementValueMinor} > 0`),
  ],
);

/**
 * The four moments a hire has that a booking does not.
 *
 * `reserved` → `out` → `returned` → `closed`, with `overdue` reachable from
 * `out` when the clock passes the end. A booking knows when something was
 * meant to happen; only this row knows whether the lens is on the shelf.
 */
export const RENTAL_STATUSES = [
  "reserved",
  "out",
  "overdue",
  "returned",
  "closed",
  "cancelled",
] as const;

export const RETURN_CONDITIONS = ["fine", "damaged", "lost"] as const;

export const rentalAgreements = pgTable(
  "rental_agreements",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    contactId: uuid("contact_id")
      .notNull()
      .references(() => contacts.id, { onDelete: "restrict" }),
    variantId: uuid("variant_id")
      .notNull()
      .references(() => productVariants.id, { onDelete: "restrict" }),
    /**
     * The booking that holds the time.
     *
     * Nullable only so a hire survives its booking being erased; while it
     * exists, this is what stops the thing going out twice — the exclusion
     * constraint does the work, on the calendar, in the database (§4.4).
     */
    bookingId: uuid("booking_id").references(() => bookings.id, { onDelete: "set null" }),
    calendarId: uuid("calendar_id")
      .notNull()
      .references(() => calendars.id, { onDelete: "restrict" }),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    /** When it is due back, which is not the same as when it came back. */
    dueAt: timestamp("ends_at", { withTimezone: true }).notNull(),
    unit: text("unit", { enum: RENTAL_UNITS }).notNull(),
    units: integer("units").notNull(),
    status: text("status", { enum: RENTAL_STATUSES }).notNull().default("reserved"),
    /** The hire itself, quoted at reservation and frozen there. */
    quotedMinor: bigint("quoted_minor", { mode: "number" }).notNull().default(0),
    depositMinor: bigint("deposit_minor", { mode: "number" }).notNull().default(0),
    currency: text("currency"),
    /** The one money object (§4.3). Null until something is actually charged. */
    invoiceId: uuid("invoice_id"),
    pickedUpAt: timestamp("picked_up_at", { withTimezone: true }),
    returnedAt: timestamp("returned_at", { withTimezone: true }),
    conditionOut: text("condition_out"),
    conditionIn: text("condition_in"),
    returnCondition: text("return_condition", { enum: RETURN_CONDITIONS }),
    /**
     * What the return came to, decided by the terms and recorded here.
     *
     * A record of the decision, not of a transaction — the same line C6.08
     * drew for cancellations. **A hire is not a payment**: charging somebody
     * for a broken lens is a deliberate money action in invoicing, with the
     * step-up that implies, not something a return button does on its way past.
     */
    lateFeeMinor: bigint("late_fee_minor", { mode: "number" }).notNull().default(0),
    damageFeeMinor: bigint("damage_fee_minor", { mode: "number" }).notNull().default(0),
    /** What goes back of the deposit once the fees are kept. */
    depositRefundMinor: bigint("deposit_refund_minor", { mode: "number" })
      .notNull()
      .default(0),
    notes: text("notes"),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [
    index("rental_agreements_contact_idx").on(t.contactId),
    index("rental_agreements_variant_idx").on(t.variantId, t.startsAt),
    index("rental_agreements_status_idx").on(t.status, t.dueAt),
    index("rental_agreements_booking_idx").on(t.bookingId),
    check("rental_agreements_order", sql`${t.dueAt} > ${t.startsAt}`),
    check("rental_agreements_units", sql`${t.units} > 0`),
    check(
      "rental_agreements_money",
      sql`${t.quotedMinor} >= 0 and ${t.depositMinor} >= 0
        and ${t.lateFeeMinor} >= 0 and ${t.damageFeeMinor} >= 0
        and ${t.depositRefundMinor} >= 0`,
    ),
    // Something cannot be out without having gone out, or back without
    // having been out — the shape a bug leaves is a row that claims both.
    check(
      "rental_agreements_out_complete",
      sql`${t.status} not in ('out','overdue','returned','closed')
        or ${t.pickedUpAt} is not null`,
    ),
    check(
      "rental_agreements_return_complete",
      sql`${t.status} not in ('returned','closed')
        or (${t.returnedAt} is not null and ${t.returnCondition} is not null)`,
    ),
  ],
);
