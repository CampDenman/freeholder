// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// ICS in and out (MASTER.md §4.4, C6.06).
//
// §4.4: "ICS everywhere: a subscribable feed per calendar for the owner, and
// an attachment on every confirmation for the customer. Two-way sync is the
// calendar adapter family (§12); **the ICS path works with no adapter at
// all**."
//
// That is the sentence this file exists to keep. An owner who has connected
// nothing — no Google, no Microsoft, no intention of either — still gets their
// diary on their phone and still has their other calendar respected, because
// a .ics file is something every calendar already speaks.
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { and, asc, eq, gte, lte, sql } from "drizzle-orm";
import { requestWithTimeout } from "@/adapters/mail/http";
import { uuid } from "@/core/contract";
import { parseIcs, renderCalendar } from "@/core/ics";
import { contacts } from "@/core/contacts/schema";
import {
  bookings,
  calendars,
  externalBusyBlocks,
  HOLDING_STATUSES,
} from "@/core/scheduling/schema";
import { db } from "@/core/db";
import { defineService, ServiceError, type Actor, type Tx } from "@/core/service";

const PROD_ID = "-//Freeholder//Scheduling//EN";
/** A feed carries a season either side of today, not a lifetime of history. */
const FEED_DAYS_BACK = 30;
const FEED_DAYS_FORWARD = 180;

function requirePerson(actor: Actor): void {
  if (actor.kind !== "user") {
    throw new ServiceError("permission", "Sign in to manage calendar feeds.");
  }
}

export const issueCalendarFeed = defineService({
  name: "calendars.issueFeed",
  summary: "Create or replace a calendar's subscribable link.",
  kind: "mutation",
  permission: "scoped",
  agentCallable: false,
  writeClass: "write",
  stepUp: true,
  input: z.object({ id: z.uuid() }),
  output: z.object({ id: uuid, token: z.string() }),
  handler: async (input, ctx) => {
    requirePerson(ctx.actor);
    // Rotating is the same operation as issuing, which is what makes revoking
    // a leaked feed one click rather than a support conversation.
    const [updated] = await ctx.tx
      .update(calendars)
      .set({ icsToken: randomBytes(24).toString("base64url"), updatedAt: sql`now()` })
      .where(eq(calendars.id, input.id))
      .returning({ id: calendars.id, token: calendars.icsToken });
    if (!updated) throw new ServiceError("not_found", "No such calendar.");
    ctx.setSubject("calendar", updated.id);
    ctx.queueEvent("calendar.feedIssued", { id: updated.id });
    return { id: updated.id, token: updated.token! };
  },
});

export const revokeCalendarFeed = defineService({
  name: "calendars.revokeFeed",
  summary: "Stop a calendar's subscribable link working.",
  kind: "mutation",
  permission: "scoped",
  agentCallable: false,
  writeClass: "write",
  input: z.object({ id: z.uuid() }),
  output: z.object({ id: uuid }),
  handler: async (input, ctx) => {
    requirePerson(ctx.actor);
    const [updated] = await ctx.tx
      .update(calendars)
      .set({ icsToken: null, updatedAt: sql`now()` })
      .where(eq(calendars.id, input.id))
      .returning({ id: calendars.id });
    if (!updated) throw new ServiceError("not_found", "No such calendar.");
    ctx.setSubject("calendar", updated.id);
    return updated;
  },
});

export const setCalendarImport = defineService({
  name: "calendars.setIcsImport",
  summary: "Block a calendar's time from an .ics feed somebody else publishes.",
  kind: "mutation",
  permission: "scoped",
  agentCallable: false,
  writeClass: "write",
  input: z.object({ id: z.uuid(), url: z.string().trim().url().max(500).nullish() }),
  output: z.object({ id: uuid, url: z.string().nullable() }),
  handler: async (input, ctx) => {
    requirePerson(ctx.actor);
    if (input.url && !/^https:\/\//i.test(input.url) && !/^webcal:\/\//i.test(input.url)) {
      throw new ServiceError(
        "validation",
        "A feed is fetched over HTTPS. Anything else can be rewritten in transit.",
      );
    }
    const [updated] = await ctx.tx
      .update(calendars)
      .set({ icsImportUrl: input.url ?? null, updatedAt: sql`now()` })
      .where(eq(calendars.id, input.id))
      .returning({ id: calendars.id, url: calendars.icsImportUrl });
    if (!updated) throw new ServiceError("not_found", "No such calendar.");
    // Dropping the feed drops what it was blocking, or an owner who removed a
    // calendar keeps being busy at times nothing explains.
    if (!input.url) {
      await ctx.tx
        .delete(externalBusyBlocks)
        .where(
          and(
            eq(externalBusyBlocks.calendarId, input.id),
            eq(externalBusyBlocks.source, "ics"),
          ),
        );
    }
    ctx.setSubject("calendar", updated.id);
    return updated;
  },
});

/**
 * The appointments a feed carries, for one calendar.
 *
 * `permission: "public"` because the token *is* the authorisation: a calendar
 * app subscribing to a feed sends no cookies, and requiring a session would
 * mean the feed only worked in a browser — the one place an owner does not
 * need it. The token is unguessable and rotatable in one click.
 */
export const calendarFeed = defineService({
  name: "calendars.feed",
  summary: "One calendar's appointments, as a subscribable .ics feed.",
  kind: "query",
  permission: "public",
  mcpExclude: true,
  agentCallable: false,
  input: z.object({ token: z.string().trim().min(16).max(200) }),
  output: z.object({ name: z.string(), body: z.string() }).nullable(),
  handler: (input, ctx) => feedFor(ctx.tx, input.token),
});

export const bookingIcs = defineService({
  name: "bookings.ics",
  summary: "One appointment, for the customer's own calendar.",
  kind: "query",
  permission: "public",
  mcpExclude: true,
  agentCallable: false,
  input: z.object({ token: z.string().trim().min(16).max(200) }),
  output: z.object({ body: z.string() }).nullable(),
  handler: (input, ctx) => bookingFeed(ctx.tx, input.token),
});

async function feedFor(
  tx: Tx,
  token: string,
): Promise<{ name: string; body: string } | null> {
  const [calendar] = await tx
    .select({ id: calendars.id, name: calendars.name })
    .from(calendars)
    .where(and(eq(calendars.icsToken, token), eq(calendars.status, "active")))
    .limit(1);
  if (!calendar) return null;

  const now = new Date();
  const rows = await tx
    .select({
      id: bookings.id,
      startsAt: bookings.startsAt,
      endsAt: bookings.endsAt,
      status: bookings.status,
      notes: bookings.notes,
      locationDetail: bookings.locationDetail,
      contactName: contacts.name,
      contactEmail: contacts.email,
    })
    .from(bookings)
    .innerJoin(contacts, eq(contacts.id, bookings.contactId))
    .where(
      and(
        eq(bookings.calendarId, calendar.id),
        gte(bookings.endsAt, new Date(now.getTime() - FEED_DAYS_BACK * 86_400_000)),
        lte(bookings.startsAt, new Date(now.getTime() + FEED_DAYS_FORWARD * 86_400_000)),
        sql`${bookings.status} <> 'cancelled'`,
      ),
    )
    .orderBy(asc(bookings.startsAt));

  return {
    name: calendar.name,
    body: renderCalendar(
      rows.map((booking) => ({
        uid: `${booking.id}@freeholder`,
        startsAt: booking.startsAt,
        endsAt: booking.endsAt,
        summary: booking.contactName ?? booking.contactEmail ?? "Booking",
        // This feed is the owner's own diary, so it carries what they wrote.
        // The customer's copy below deliberately carries less.
        description: booking.notes ?? undefined,
        location: booking.locationDetail ?? undefined,
        status: booking.status === "no_show" ? "TENTATIVE" : "CONFIRMED",
        transparency: HOLDING_STATUSES.includes(
          booking.status as (typeof HOLDING_STATUSES)[number],
        )
          ? "OPAQUE"
          : "TRANSPARENT",
      })),
      { prodId: PROD_ID, name: calendar.name },
    ),
  };
}

/**
 * One booking, as the attachment a customer adds to their own calendar.
 *
 * Reached by the reschedule token, which is already the unguessable thing a
 * customer holds for this appointment (§4.4: "customers reschedule through a
 * signed reschedule_token link, with no login and no support email"). Giving
 * the same token a second use costs nothing and saves inventing a second one.
 */
async function bookingFeed(
  tx: Tx,
  rescheduleToken: string,
): Promise<{ body: string } | null> {
  const [booking] = await tx
    .select({
      id: bookings.id,
      startsAt: bookings.startsAt,
      endsAt: bookings.endsAt,
      status: bookings.status,
      locationDetail: bookings.locationDetail,
      calendarName: calendars.name,
    })
    .from(bookings)
    .innerJoin(calendars, eq(calendars.id, bookings.calendarId))
    .where(eq(bookings.rescheduleToken, rescheduleToken))
    .limit(1);
  if (!booking) return null;

  return {
    body: renderCalendar(
      [
        {
          uid: `${booking.id}@freeholder`,
          startsAt: booking.startsAt,
          endsAt: booking.endsAt,
          summary: booking.calendarName,
          location: booking.locationDetail ?? undefined,
          // A cancelled appointment still answers, and says it is cancelled —
          // that is how a subscribed client removes it rather than leaving a
          // stale block in somebody's week.
          status: booking.status === "cancelled" ? "CANCELLED" : "CONFIRMED",
        },
      ],
      { prodId: PROD_ID, method: booking.status === "cancelled" ? "CANCEL" : "PUBLISH" },
    ),
  };
}

/**
 * Fetch every configured .ics feed and refresh what it blocks.
 *
 * A feed that cannot be read leaves the last good answer in place rather than
 * clearing it: an unreachable calendar is not an empty calendar, and treating
 * it as one would quietly offer times somebody is already busy.
 */
export async function importIcsFeeds(): Promise<{
  calendars: number;
  blocks: number;
  failed: number;
}> {
  const due = await db()
    .select({ id: calendars.id, url: calendars.icsImportUrl })
    .from(calendars)
    .where(and(eq(calendars.status, "active"), sql`${calendars.icsImportUrl} is not null`));

  let blocks = 0;
  let failed = 0;
  for (const calendar of due) {
    try {
      const url = calendar.url!.replace(/^webcal:\/\//i, "https://");
      const response = await requestWithTimeout(globalThis.fetch, url, {
        method: "GET",
        headers: { accept: "text/calendar, text/plain" },
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const events = parseIcs(await response.text());

      await db().transaction(async (tx) => {
        const seen: string[] = [];
        for (const event of events) {
          if (event.cancelled) continue;
          seen.push(event.uid);
          await tx
            .insert(externalBusyBlocks)
            .values({
              calendarId: calendar.id,
              sourceRef: event.uid,
              source: "ics",
              startsAt: event.startsAt,
              endsAt: event.endsAt,
              busy: event.busy,
            })
            .onConflictDoUpdate({
              target: [externalBusyBlocks.calendarId, externalBusyBlocks.sourceRef],
              set: {
                startsAt: event.startsAt,
                endsAt: event.endsAt,
                busy: event.busy,
                updatedAt: sql`now()`,
              },
            });
          blocks += 1;
        }
        // Anything the feed stopped listing has been cancelled upstream. Only
        // safe because the fetch succeeded — a failed fetch never gets here.
        await tx
          .delete(externalBusyBlocks)
          .where(
            and(
              eq(externalBusyBlocks.calendarId, calendar.id),
              eq(externalBusyBlocks.source, "ics"),
              seen.length > 0
                ? sql`${externalBusyBlocks.sourceRef} <> all(${sql.param(seen)})`
                : sql`true`,
            ),
          );
      });
    } catch (error) {
      failed += 1;
      console.warn(`[scheduling] ics feed for calendar ${calendar.id} failed`, error);
    }
  }
  return { calendars: due.length, blocks, failed };
}

export default [
  issueCalendarFeed,
  revokeCalendarFeed,
  setCalendarImport,
  calendarFeed,
  bookingIcs,
];
