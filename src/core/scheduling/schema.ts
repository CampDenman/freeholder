// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Calendars: anything whose time can be spent (MASTER.md §4.4, C6.01).
//
// The model separates three things every simplistic booking tool conflates:
// who or what is being booked (a calendar), what may be booked on it
// (availability, C6.02), and what was booked (a booking, C6.07). This file is
// the first of those.
//
// **A person's calendar and the business's calendar are different objects, and
// both exist from day one.** A solo owner has one of each and never notices;
// the moment they hire somebody, buy a second chair, or start renting the
// studio out, nothing has to be restructured. §4.4 calls this the single most
// expensive assumption to retrofit, and it costs a `kind` column to get right.
//
// **Resources are calendars too.** A massage room, a photo studio, a rental
// lens and a bookable van all behave identically: they have hours, they can be
// double-booked by mistake, and they need to be free at the same moment the
// person is. Making them one entity is what turns "this service needs a
// therapist *and* a room" into a query rather than a feature.
import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  smallint,
  text,
  time,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { users } from "@/core/auth/schema";
import { contacts } from "@/core/contacts/schema";
import { businessLocations } from "@/core/locations/schema";
import { externalCalendars } from "@/core/connections/schema";
import { createdAtColumn, updatedAtColumn } from "@/core/db/columns";
import type { CancellationTerms, StoredOutcome } from "@/core/scheduling/policy";

export const CALENDAR_KINDS = ["person", "business", "resource"] as const;
export const CALENDAR_STATUSES = ["active", "archived"] as const;
/** How a calendar takes part in a service (§4.4's `CalendarMembership`). */
export const MEMBERSHIP_ROLES = ["primary", "assistant", "resource"] as const;

export const calendars = pgTable(
  "calendars",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    kind: text("kind", { enum: CALENDAR_KINDS }).notNull(),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    /**
     * Whose calendar this is. Null for the business itself and for every
     * resource — a kiln has no login, and a booking names a calendar rather
     * than a user precisely so that stays true.
     */
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    locationId: uuid("location_id").references(() => businessLocations.id, {
      onDelete: "set null",
    }),
    /**
     * The calendar's own zone, not the business's. A second location in
     * another country is a calendar, and its hours are local to it (§4.9).
     */
    timezone: text("timezone").notNull(),
    /** 1:1, a class of twelve, or a webinar. Per slot, and per calendar. */
    capacityDefault: integer("capacity_default").notNull().default(1),
    colour: text("colour"),
    /**
     * The synced calendar whose busy time blocks this one (C4.12).
     *
     * A reference rather than §4.4's `external_sync`/`sync_token` pair: that
     * machinery already exists on `external_calendars`, and a second copy of a
     * provider cursor is a second thing to get out of step. What this column
     * adds is the mapping — which real calendar this bookable one *is*.
     */
    externalCalendarId: uuid("external_calendar_id").references(
      () => externalCalendars.id,
      { onDelete: "set null" },
    ),
    /** No bookings more than this far out (§4.4). */
    bookingHorizonDays: integer("booking_horizon_days").notNull().default(180),
    /** No bookings sooner than this (§4.4's lead time). */
    minNoticeMin: integer("min_notice_min").notNull().default(120),
    /** Burnout is a scheduling bug, so the ceiling is a column. */
    maxPerDay: integer("max_per_day"),
    /**
     * The unguessable half of this calendar's subscribable feed URL (C6.06).
     *
     * A feed is a credential: anyone holding the address reads the diary. It
     * is a column rather than a derivation so revoking one is rotating a value
     * rather than changing what the calendar is.
     */
    icsToken: text("ics_token"),
    /**
     * An .ics feed whose events block this calendar (§4.4).
     *
     * The path that works with no adapter at all: an owner with no Google
     * account still gets their other diary respected, because every calendar
     * on earth publishes one of these.
     */
    icsImportUrl: text("ics_import_url"),
    status: text("status", { enum: CALENDAR_STATUSES }).notNull().default("active"),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [
    uniqueIndex("calendars_slug_idx").on(t.slug),
    index("calendars_kind_idx").on(t.kind, t.status),
    index("calendars_user_idx").on(t.userId),
    // Exactly one business calendar. A second one is not a configuration an
    // owner meant to make; it is two answers to "when is the business open".
    uniqueIndex("calendars_one_business_idx")
      .on(t.kind)
      .where(sql`${t.kind} = 'business'`),
    check("calendars_capacity_positive", sql`${t.capacityDefault} > 0`),
    check("calendars_horizon_positive", sql`${t.bookingHorizonDays} > 0`),
    check("calendars_notice_not_negative", sql`${t.minNoticeMin} >= 0`),
    check("calendars_max_per_day_positive", sql`${t.maxPerDay} is null or ${t.maxPerDay} > 0`),
    // A person's calendar belongs to a person; the other two do not.
    check(
      "calendars_person_has_holder",
      sql`(${t.kind} = 'person') = (${t.userId} is not null)`,
    ),
  ],
);

/**
 * Which calendars a service may draw on, and how.
 *
 * This is the row that makes "a therapist *and* a room" answerable: a service
 * with a `primary` membership and a `resource` membership needs both free at
 * once, and the resolver (C6.03) reads that from here rather than from a
 * special case per service type.
 *
 * `serviceOfferingId` is deliberately untyped by a foreign key: catalog is a
 * module and core may not depend on one (§11). The service that writes these
 * rows checks the offering exists; the column is the join, not the guarantee.
 */
export const calendarMemberships = pgTable(
  "calendar_memberships",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    calendarId: uuid("calendar_id")
      .notNull()
      .references(() => calendars.id, { onDelete: "cascade" }),
    serviceOfferingId: uuid("service_offering_id").notNull(),
    role: text("role", { enum: MEMBERSHIP_ROLES }).notNull().default("primary"),
    /** Lower first, for assignment that prefers somebody without excluding others. */
    priority: integer("priority").notNull().default(0),
    /** Free text an owner uses, not an enum the platform pretends to understand. */
    skillLevel: text("skill_level"),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [
    uniqueIndex("calendar_memberships_unique_idx").on(
      t.serviceOfferingId,
      t.calendarId,
      t.role,
    ),
    index("calendar_memberships_service_idx").on(t.serviceOfferingId, t.priority),
    index("calendar_memberships_calendar_idx").on(t.calendarId),
    check("calendar_memberships_priority", sql`${t.priority} between 0 and 1000`),
  ],
);

export const AVAILABILITY_KINDS = ["bookable", "on_call", "admin"] as const;
export const EXCEPTION_KINDS = ["closed", "open", "reduced"] as const;

/**
 * Recurring open hours (MASTER.md §4.4, C6.02).
 *
 * Weekly by weekday, because that is how every business actually states its
 * hours, with an optional effective range for the ones that change with the
 * season. Anything that is not a repeating weekly pattern is an exception
 * below rather than a second kind of rule — an owner who says "Tuesdays, 9 to
 * 5, except the 24th" has said one rule and one exception, and modelling it
 * that way is what keeps the editor readable.
 *
 * `kind` separates hours that customers may book from hours somebody is merely
 * reachable in. §4.4 wants both: an on-call window is real availability to a
 * person planning cover, and it is not a slot on a booking page.
 */
export const availabilityRules = pgTable(
  "availability_rules",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    calendarId: uuid("calendar_id")
      .notNull()
      .references(() => calendars.id, { onDelete: "cascade" }),
    /** 0 = Sunday, matching Date#getDay and the opening-hours table (§4.10). */
    weekday: smallint("weekday").notNull(),
    starts: time("starts").notNull(),
    ends: time("ends").notNull(),
    /** Null at either end means "since always" and "until further notice". */
    effectiveFrom: date("effective_from"),
    effectiveTo: date("effective_to"),
    kind: text("kind", { enum: AVAILABILITY_KINDS }).notNull().default("bookable"),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [
    index("availability_rules_calendar_idx").on(t.calendarId, t.weekday),
    check("availability_rules_weekday", sql`${t.weekday} between 0 and 6`),
    // Overnight hours are split into two rules, for the reason §4.10 splits
    // them: a window that ends before it starts has to be special-cased by
    // every reader, and one of them will forget.
    check("availability_rules_order", sql`${t.ends} > ${t.starts}`),
    check(
      "availability_rules_effective_order",
      sql`${t.effectiveFrom} is null or ${t.effectiveTo} is null
          or ${t.effectiveTo} >= ${t.effectiveFrom}`,
    ),
  ],
);

/**
 * A specific date that overrides the pattern — holidays, a late start, an
 * extra Saturday (§4.4).
 *
 * An exception always wins over a rule for the days it covers. That is the
 * whole reason it exists: an owner writing "closed 24th to 2nd" has said
 * something more specific than their Tuesday hours, and a resolver that merged
 * the two would open on Christmas Day.
 */
export const availabilityExceptions = pgTable(
  "availability_exceptions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    calendarId: uuid("calendar_id")
      .notNull()
      .references(() => calendars.id, { onDelete: "cascade" }),
    /** Inclusive at both ends: one day is the same date twice. */
    startsOn: date("starts_on").notNull(),
    endsOn: date("ends_on").notNull(),
    kind: text("kind", { enum: EXCEPTION_KINDS }).notNull(),
    /** Set for `open` and `reduced`; never for `closed`. */
    starts: time("starts"),
    ends: time("ends"),
    /** Shown beside the date: "Boxing Day", "training", "late start". */
    reason: text("reason"),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [
    index("availability_exceptions_calendar_idx").on(t.calendarId, t.startsOn),
    check("availability_exceptions_order", sql`${t.endsOn} >= ${t.startsOn}`),
    // Closed means no times; anything else means both. A row that is half of
    // each cannot be rendered, and guessing at it would be the platform
    // deciding somebody's hours for them.
    check(
      "availability_exceptions_times",
      sql`case when ${t.kind} = 'closed'
           then ${t.starts} is null and ${t.ends} is null
           else ${t.starts} is not null and ${t.ends} is not null
                and ${t.ends} > ${t.starts} end`,
    ),
  ],
);

export const BOOKING_STATUSES = [
  "requested",
  "confirmed",
  "in_progress",
  "completed",
  "no_show",
  "cancelled",
] as const;
export const BOOKING_SOURCES = ["site", "admin", "agent", "import"] as const;
export const PARTICIPANT_STATUSES = ["registered", "attended", "no_show"] as const;

/** The statuses that hold time. Everything else has released it. */
export const HOLDING_STATUSES = [
  "requested",
  "confirmed",
  "in_progress",
] as const;

/**
 * A scheduled commitment (MASTER.md §4.4, C6.07).
 *
 * A booking names a **calendar**, never a user, which is what lets a room, a
 * person and the business be booked by the same machinery (C6.01).
 *
 * **Store UTC; render in two zones.** `timezoneAtBooking` is kept because
 * timezone confusion is the single largest cause of no-shows: a DST change
 * between booking and appointment becomes a known quantity rather than a
 * surprise, and the customer can always be shown the time they agreed to.
 *
 * **A booking is not a payment.** Deposits, balances and no-show fees resolve
 * to an invoice like everything else (§4.3); `invoiceId` is the link, and a
 * free consultation produces no invoice at all.
 */
export const bookings = pgTable(
  "bookings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    contactId: uuid("contact_id")
      .notNull()
      .references(() => contacts.id, { onDelete: "restrict" }),
    /** Untyped by a foreign key: catalog is a module and core may not depend on one. */
    serviceOfferingId: uuid("service_offering_id"),
    calendarId: uuid("calendar_id")
      .notNull()
      .references(() => calendars.id, { onDelete: "restrict" }),
    /** A room as well as a therapist: the compound requirement, once booked. */
    secondaryCalendarIds: uuid("secondary_calendar_ids")
      .array()
      .notNull()
      .default(sql`'{}'`),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
    timezoneAtBooking: text("timezone_at_booking").notNull(),
    status: text("status", { enum: BOOKING_STATUSES }).notNull().default("requested"),
    locationId: uuid("location_id").references(() => businessLocations.id, {
      onDelete: "set null",
    }),
    /** An address or a meeting URL — whichever the service's location type means. */
    locationDetail: text("location_detail"),
    /** Seats this booking holds. A class of twelve is twelve seats, not twelve bookings. */
    capacityUsed: integer("capacity_used").notNull().default(1),
    /**
     * Whether this booking has the calendar to itself.
     *
     * Denormalized from the calendar's capacity because the exclusion
     * constraint cannot join: a class calendar's bookings overlap by design,
     * and a 1:1 calendar's must not. Set once, at the moment the booking is
     * made, from the calendar it was made on.
     */
    exclusive: boolean("exclusive").notNull().default(true),
    invoiceId: uuid("invoice_id"),
    /** A moved appointment points at the one it replaced, so the history survives. */
    rescheduledFromId: uuid("rescheduled_from_id"),
    /** Signed, so a customer moves their own appointment without an account. */
    rescheduleToken: text("reschedule_token"),
    /**
     * How many times this appointment has been moved (C6.08).
     *
     * Carried forward across a reschedule rather than counted by walking
     * `rescheduledFromId`, because the chain can be walked only while every
     * link survives, and a policy that stops being enforced after somebody
     * tidies up old rows is not a policy.
     */
    rescheduleCount: integer("reschedule_count").notNull().default(0),
    /**
     * The cancellation terms as they stood when this was booked (C6.08).
     *
     * A snapshot, not a reference. §4.4: "the customer saw the terms before
     * booking" — which is only true if editing the policy tomorrow does not
     * silently change what somebody agreed to today. Null means no policy was
     * attached, which is a free cancellation rather than an unknown one.
     */
    cancellationPolicy: jsonb("cancellation_policy").$type<CancellationTerms>(),
    /**
     * What the policy decided when this was cancelled or no-showed (C6.08).
     *
     * A record of the decision, not of a transaction: fee, refund due, and the
     * sentence the customer is shown. **A booking is not a payment** (§4.4), so
     * settling it is a deliberate money action in the invoicing module with the
     * step-up that implies — never something a cancellation does to somebody's
     * card on its way past.
     */
    cancellationOutcome: jsonb("cancellation_outcome").$type<StoredOutcome>(),
    intakeSubmissionId: uuid("intake_submission_id"),
    waiverId: uuid("waiver_id"),
    source: text("source", { enum: BOOKING_SOURCES }).notNull().default("admin"),
    notes: text("notes"),
    cancellationReason: text("cancellation_reason"),
    /**
     * The event this booking became on an upstream calendar (C6.06).
     *
     * §41 keeps general two-way sync out of v1: Freeholder writes the bookings
     * it made and reads busy time, and this column is the whole of "the ones
     * it made". Null means it was never written upstream, which is the normal
     * state for a calendar nobody connected.
     */
    providerEventRef: text("provider_event_ref"),
    /** Anything a later feature wants, without another migration. */
    meta: jsonb("meta"),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [
    index("bookings_calendar_idx").on(t.calendarId, t.startsAt),
    index("bookings_contact_idx").on(t.contactId, t.startsAt),
    index("bookings_status_idx").on(t.status, t.startsAt),
    uniqueIndex("bookings_reschedule_token_idx")
      .on(t.rescheduleToken)
      .where(sql`${t.rescheduleToken} is not null`),
    check("bookings_order", sql`${t.endsAt} > ${t.startsAt}`),
    check("bookings_capacity_positive", sql`${t.capacityUsed} > 0`),
    // The exclusion constraint itself is written in the migration: Drizzle has
    // no expression for `EXCLUDE USING gist`, and §4.4 is explicit that
    // double-booking is prevented in the database rather than in the UI —
    // no amount of careful service-layer checking survives two processes.
  ],
);

/**
 * Group bookings, classes, and a client bringing two people (§4.4).
 *
 * A participant may have no contact at all: "and my sister" is a real thing to
 * book, and refusing to record her because she has no email address would push
 * the owner back to a paper list.
 */
export const bookingParticipants = pgTable(
  "booking_participants",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    bookingId: uuid("booking_id")
      .notNull()
      .references(() => bookings.id, { onDelete: "cascade" }),
    contactId: uuid("contact_id").references(() => contacts.id, {
      onDelete: "set null",
    }),
    name: text("name"),
    status: text("status", { enum: PARTICIPANT_STATUSES })
      .notNull()
      .default("registered"),
    seatCount: integer("seat_count").notNull().default(1),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [
    index("booking_participants_booking_idx").on(t.bookingId),
    index("booking_participants_contact_idx").on(t.contactId),
    check("booking_participants_seats", sql`${t.seatCount} > 0`),
    // Somebody has to be identifiable, by a row in the spine or by a name.
    check(
      "booking_participants_identified",
      sql`${t.contactId} is not null or ${t.name} is not null`,
    ),
  ],
);

export const WAITLIST_STATUSES = [
  "waiting",
  "offered",
  "booked",
  "expired",
  "withdrawn",
] as const;

/**
 * Who wants a full slot, in order (MASTER.md §4.4's `Waitlist`, C6.08).
 *
 * The window is a range rather than an exact time, because somebody who wants
 * "any Tuesday afternoon" is the common case and forcing them to name a slot
 * that is already full is asking them to guess.
 *
 * **An offer is held, not raced.** When a seat frees, the first person in line
 * is moved to `offered` with a token and a deadline; the seat is theirs until
 * the deadline passes, and only then does it pass to the next. The alternative
 * — telling everybody at once — is a race the business always wins and the
 * customer always loses, and it teaches people that the waitlist is a lottery.
 */
export const bookingWaitlist = pgTable(
  "booking_waitlist",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    contactId: uuid("contact_id")
      .notNull()
      .references(() => contacts.id, { onDelete: "cascade" }),
    /** Untyped by a foreign key: catalog is a module and core may not depend on one. */
    serviceOfferingId: uuid("service_offering_id"),
    /** Null means "whoever is free", which is what most people actually want. */
    calendarId: uuid("calendar_id").references(() => calendars.id, {
      onDelete: "cascade",
    }),
    windowStart: timestamp("window_start", { withTimezone: true }).notNull(),
    windowEnd: timestamp("window_end", { withTimezone: true }).notNull(),
    seatCount: integer("seat_count").notNull().default(1),
    status: text("status", { enum: WAITLIST_STATUSES }).notNull().default("waiting"),
    /** The owner's ordering, so "first asked" is not "whoever the query returned". */
    position: integer("position").notNull().default(0),
    offeredAt: timestamp("offered_at", { withTimezone: true }),
    /** After this the offer lapses and the seat passes to the next in line. */
    offerExpiresAt: timestamp("offer_expires_at", { withTimezone: true }),
    /** Signed, so somebody claims their offer without an account (§4.4). */
    offerToken: text("offer_token"),
    /** The slot they were offered, which may be narrower than their window. */
    offerStartsAt: timestamp("offer_starts_at", { withTimezone: true }),
    offerEndsAt: timestamp("offer_ends_at", { withTimezone: true }),
    /** Set when the offer became a real appointment. */
    bookingId: uuid("booking_id").references(() => bookings.id, {
      onDelete: "set null",
    }),
    notes: text("notes"),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [
    index("booking_waitlist_queue_idx").on(
      t.calendarId,
      t.status,
      t.position,
      t.createdAt,
    ),
    index("booking_waitlist_contact_idx").on(t.contactId),
    index("booking_waitlist_window_idx").on(t.windowStart, t.windowEnd),
    uniqueIndex("booking_waitlist_offer_token_idx")
      .on(t.offerToken)
      .where(sql`${t.offerToken} is not null`),
    check("booking_waitlist_order", sql`${t.windowEnd} > ${t.windowStart}`),
    check("booking_waitlist_seats", sql`${t.seatCount} > 0`),
    // An offer without a deadline is an indefinite hold on a seat, which is
    // the failure mode this table exists to avoid.
    check(
      "booking_waitlist_offer_complete",
      sql`${t.status} <> 'offered'
        or (${t.offerToken} is not null and ${t.offerExpiresAt} is not null
            and ${t.offerStartsAt} is not null and ${t.offerEndsAt} is not null)`,
    ),
  ],
);

export const REMINDER_CHANNELS = ["email", "sms"] as const;
export const REMINDER_STATUSES = ["scheduled", "sent", "skipped", "failed"] as const;

/**
 * Scheduled notifications for an appointment (§4.4's `BookingReminder`, C6.09).
 *
 * Rows rather than a computed schedule, and the reason is auditability: an
 * owner asking "was he reminded?" needs an answer, and a rule that says a
 * reminder *would* have been sent is not one. Every attempt lands here with
 * what happened — sent, skipped and why, or failed.
 *
 * **A reminder is transactional** (§4.14): a booking confirmation, a delivery
 * notification and an OTP ride the existing relationship. What it must still
 * respect is the mail suppression list, and — for SMS, which is a personal
 * medium people *read* — an actual opt-in. Both are checked at send time
 * rather than at schedule time, because consent can change in between and the
 * later answer is the true one.
 */
export const bookingReminders = pgTable(
  "booking_reminders",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    bookingId: uuid("booking_id")
      .notNull()
      .references(() => bookings.id, { onDelete: "cascade" }),
    channel: text("channel", { enum: REMINDER_CHANNELS }).notNull().default("email"),
    /** How long before the appointment, which is what an owner configures. */
    offsetMin: integer("offset_min").notNull(),
    /** Computed from the offset at schedule time, and re-computed on a move. */
    sendAt: timestamp("send_at", { withTimezone: true }).notNull(),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    status: text("status", { enum: REMINDER_STATUSES }).notNull().default("scheduled"),
    /** Why it was not sent, in words an owner can act on. */
    skipReason: text("skip_reason"),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [
    index("booking_reminders_due_idx").on(t.status, t.sendAt),
    // One reminder per booking, channel and offset. Confirming an appointment
    // twice must not text somebody twice, and an upsert on this is what makes
    // rescheduling a re-computation rather than a duplication.
    uniqueIndex("booking_reminders_unique_idx").on(t.bookingId, t.channel, t.offsetMin),
    check("booking_reminders_offset", sql`${t.offsetMin} between 0 and 43200`),
  ],
);

export const BUSY_SOURCES = ["ics", "provider"] as const;

/**
 * Time imported from somewhere else, against a Freeholder calendar
 * (MASTER.md §4.4's `ExternalBusyBlock`, C6.06).
 *
 * §4.4: "Never shown to customers, always respected."
 *
 * Distinct from C4.12's `external_events`, and the difference is which key
 * they hang from. Those belong to a *connected account* and arrive through
 * OAuth; these belong to a *calendar* and arrive from a URL anybody can
 * publish. §4.4 is explicit that the ICS path works with no adapter at all, so
 * it cannot be modelled as a degenerate connected account — an owner with no
 * Google account still gets their diary respected.
 */
export const externalBusyBlocks = pgTable(
  "external_busy_blocks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    calendarId: uuid("calendar_id")
      .notNull()
      .references(() => calendars.id, { onDelete: "cascade" }),
    /** The upstream UID, so a re-fetch updates rather than duplicates. */
    sourceRef: text("source_ref").notNull(),
    source: text("source", { enum: BUSY_SOURCES }).notNull().default("ics"),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
    /** False for a transparent event: on the calendar, not blocking. */
    busy: boolean("busy").notNull().default(true),
    /**
     * Set when this block is the shadow of a booking Freeholder itself wrote
     * to the upstream calendar (C6.06's reconciliation).
     *
     * Without it the appointment blocks twice — once as the booking and once
     * as its own reflection — and rescheduling collides with its ghost.
     */
    bookingId: uuid("booking_id").references(() => bookings.id, {
      onDelete: "set null",
    }),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [
    uniqueIndex("external_busy_blocks_ref_idx").on(t.calendarId, t.sourceRef),
    index("external_busy_blocks_window_idx").on(t.calendarId, t.startsAt, t.endsAt),
    check("external_busy_blocks_order", sql`${t.endsAt} > ${t.startsAt}`),
  ],
);
