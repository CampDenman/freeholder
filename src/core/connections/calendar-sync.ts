// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Keeping external calendars in step (MASTER.md §41, C4.12).
//
// The promise this has to keep is narrow and absolute: Freeholder learns when
// somebody is busy, and learns nothing else unless they said it could. So the
// default shadow of an external event is four facts — which calendar, when it
// starts, when it ends, whether it blocks — and the title column stays null.
// Turning `detailVisibility` to `full` is the only thing that changes that,
// and turning it back is not cosmetic: the details already stored are erased.
import { z } from "zod";
import { and, eq, gt, inArray, isNull, lt, notInArray, or, sql } from "drizzle-orm";
import { db } from "@/core/db";
import { listed, row, timestamp, uuid } from "@/core/contract";
import {
  connectedAccounts,
  connectionCapabilities,
  externalCalendars,
  externalEvents,
} from "@/core/connections/schema";
import {
  accessTokenForAccount,
  type OAuthProvider,
} from "@/core/connections/oauth-core";
import {
  calendarSyncClient,
  type CalendarWindow,
  type ProviderEvent,
} from "@/core/connections/calendar-providers";
import { MailAdapterError } from "@/adapters/mail/types";
import {
  defineService,
  getService,
  hasModuleAccess,
  ServiceError,
  type Actor,
  type Tx,
} from "@/core/service";

/**
 * How far either side of today availability actually cares about.
 *
 * A week back so a run that was down over a weekend still reconciles what
 * changed; a quarter forward because nothing books beyond it. Anything outside
 * is deleted rather than kept, which is both cheaper and the honest reading of
 * "only as far as it is needed".
 */
const WINDOW_DAYS_BACK = 7;
const WINDOW_DAYS_FORWARD = 90;

/**
 * How long a cursor is trusted before the window is re-established.
 *
 * The cursor is relative to the request that issued it, and this window moves
 * with the clock, so an old cursor is right about changes and increasingly
 * wrong about the far edge. A daily full pass fixes that without giving up
 * cheap polling in between.
 */
const FULL_RESYNC_AFTER_HOURS = 24;

function syncWindow(now: Date): CalendarWindow {
  return {
    startsAt: new Date(now.getTime() - WINDOW_DAYS_BACK * 86_400_000),
    endsAt: new Date(now.getTime() + WINDOW_DAYS_FORWARD * 86_400_000),
  };
}

type SyncableAccount = {
  id: string;
  provider: OAuthProvider;
  detailVisibility: "busy_only" | "full";
};

export interface CalendarSyncOutcome {
  accountId: string;
  calendars: number;
  events: number;
  removed: number;
  failed?: string;
}

async function readableAccount(
  tx: Tx,
  actor: Actor,
  id: string,
): Promise<SyncableAccount> {
  const [account] = await tx
    .select({
      id: connectedAccounts.id,
      userId: connectedAccounts.userId,
      provider: connectedAccounts.provider,
      status: connectedAccounts.status,
      detailVisibility: connectedAccounts.detailVisibility,
    })
    .from(connectedAccounts)
    .where(eq(connectedAccounts.id, id))
    .limit(1);
  if (!account) throw new ServiceError("not_found", "No such connected account.");

  const isHolder = actor.kind === "user" && actor.userId === account.userId;
  const canManage = hasModuleAccess(actor, "connections", "manage");
  if (!isHolder && !canManage && actor.kind !== "system") {
    throw new ServiceError("not_found", "No such connected account.");
  }
  if (account.provider !== "google" && account.provider !== "microsoft") {
    throw new ServiceError(
      "conflict",
      "Freeholder can only sync calendars for Google and Microsoft accounts.",
    );
  }
  return {
    id: account.id,
    provider: account.provider,
    detailVisibility: account.detailVisibility,
  };
}

/** Reading a calendar needs the capability switched on, not just the scope. */
async function mayReadCalendars(tx: Tx, accountId: string): Promise<boolean> {
  const [enabled] = await tx
    .select({ id: connectionCapabilities.id })
    .from(connectionCapabilities)
    .where(
      and(
        eq(connectionCapabilities.connectedAccountId, accountId),
        eq(connectionCapabilities.capability, "calendar_read"),
        eq(connectionCapabilities.enabled, true),
      ),
    )
    .limit(1);
  return Boolean(enabled);
}

/**
 * Write one provider event into its shadow row.
 *
 * `details` is the whole privacy decision, passed down rather than looked up,
 * so that no path through this file can accidentally store a title an account
 * did not permit.
 */
function shadowOf(
  event: ProviderEvent,
  calendarId: string,
  details: boolean,
): typeof externalEvents.$inferInsert {
  return {
    externalCalendarId: calendarId,
    externalId: event.externalId,
    startsAt: event.startsAt,
    endsAt: event.endsAt,
    allDay: event.allDay,
    busy: event.busy,
    title: details ? (event.title ?? null) : null,
    // `raw` would smuggle back everything `title` was withheld for —
    // attendees, locations, notes — so a busy-only account keeps nothing.
    raw: details ? { title: event.title ?? null } : null,
  };
}

/**
 * Pull one account's calendars up to date.
 *
 * Returns rather than throws for a provider problem: one unreachable account
 * must not stop the others, and the account row already carries the evidence
 * an owner needs to act on.
 */
export async function syncAccountCalendars(
  tx: Tx,
  account: SyncableAccount,
  now: Date,
): Promise<CalendarSyncOutcome> {
  const outcome: CalendarSyncOutcome = {
    accountId: account.id,
    calendars: 0,
    events: 0,
    removed: 0,
  };
  const details = account.detailVisibility === "full";
  const window = syncWindow(now);
  const client = calendarSyncClient(account.provider);

  const accessToken = await accessTokenForAccount(tx, account);
  const discovered = await client.listCalendars(accessToken);
  for (const calendar of discovered) {
    await tx
      .insert(externalCalendars)
      .values({
        connectedAccountId: account.id,
        externalId: calendar.externalId,
        name: calendar.name,
        colour: calendar.colour ?? null,
        timezone: calendar.timezone ?? null,
      })
      .onConflictDoUpdate({
        target: [externalCalendars.connectedAccountId, externalCalendars.externalId],
        // Never the role: that is the owner's decision, and rediscovering a
        // calendar must not quietly re-enable one they told Freeholder to
        // ignore.
        set: {
          name: calendar.name,
          colour: calendar.colour ?? null,
          timezone: calendar.timezone ?? null,
          updatedAt: sql`now()`,
        },
      });
  }
  outcome.calendars = discovered.length;

  const rows = await tx
    .select({
      id: externalCalendars.id,
      externalId: externalCalendars.externalId,
      syncToken: externalCalendars.syncToken,
      lastSyncAt: externalCalendars.lastSyncAt,
    })
    .from(externalCalendars)
    .where(
      and(
        eq(externalCalendars.connectedAccountId, account.id),
        // An ignored calendar is not fetched at all. Not fetching is the only
        // form of "we do not look at that" a person can actually verify.
        sql`${externalCalendars.role} <> 'ignored'`,
      ),
    );

  for (const calendar of rows) {
    const stale =
      !calendar.lastSyncAt ||
      now.getTime() - calendar.lastSyncAt.getTime() >
        FULL_RESYNC_AFTER_HOURS * 3_600_000;
    let page = await client.listEvents(accessToken, {
      externalId: calendar.externalId,
      syncToken: stale ? null : calendar.syncToken,
      window,
    });
    const refused = page.resyncRequired;
    if (refused) {
      page = await client.listEvents(accessToken, {
        externalId: calendar.externalId,
        syncToken: null,
        window,
      });
    }
    /**
     * A pass that saw the whole window, and can therefore be trusted to say
     * what is *not* there any more. An incremental pass reports only changes,
     * and a pass that ran out of pages saw a prefix — treating either as the
     * complete truth would delete time somebody is genuinely busy.
     */
    const fullPass = (stale || !calendar.syncToken || refused) && page.complete;

    const gone = page.events.filter((event) => event.cancelled).map((e) => e.externalId);
    const live = page.events.filter(
      (event) =>
        !event.cancelled &&
        event.endsAt > window.startsAt &&
        event.startsAt < window.endsAt,
    );

    if (gone.length > 0) {
      const deleted = await tx
        .delete(externalEvents)
        .where(
          and(
            eq(externalEvents.externalCalendarId, calendar.id),
            inArray(externalEvents.externalId, gone),
          ),
        )
        .returning({ id: externalEvents.id });
      outcome.removed += deleted.length;
    }

    for (const event of live) {
      await tx
        .insert(externalEvents)
        .values(shadowOf(event, calendar.id, details))
        .onConflictDoUpdate({
          target: [externalEvents.externalCalendarId, externalEvents.externalId],
          set: {
            startsAt: event.startsAt,
            endsAt: event.endsAt,
            allDay: event.allDay,
            busy: event.busy,
            title: details ? (event.title ?? null) : null,
            raw: details ? { title: event.title ?? null } : null,
            updatedAt: sql`now()`,
          },
        });
    }
    outcome.events += live.length;

    // Everything the window has left behind, and — on a full pass — everything
    // inside it the provider no longer lists. Freeholder created events keep
    // their row: a booking is ours to forget, not the provider's.
    const expired = await tx
      .delete(externalEvents)
      .where(
        and(
          eq(externalEvents.externalCalendarId, calendar.id),
          isNull(externalEvents.bookingId),
          fullPass && live.length > 0
            ? or(
                lt(externalEvents.endsAt, window.startsAt),
                gt(externalEvents.startsAt, window.endsAt),
                notInArray(
                  externalEvents.externalId,
                  live.map((event) => event.externalId),
                ),
              )
            : or(
                lt(externalEvents.endsAt, window.startsAt),
                gt(externalEvents.startsAt, window.endsAt),
              ),
        ),
      )
      .returning({ id: externalEvents.id });
    outcome.removed += expired.length;

    await tx
      .update(externalCalendars)
      .set({
        syncToken: page.nextSyncToken ?? calendar.syncToken,
        lastSyncAt: now,
        updatedAt: sql`now()`,
      })
      .where(eq(externalCalendars.id, calendar.id));
  }

  // Claim the events that are Freeholder's own bookings looking back at it
  // (C6.06). Without this an appointment blocks its hour twice and cannot be
  // moved, because the exclusion constraint is quite right that something
  // already occupies it.
  const { reconcileMirroredBookings } = await import("@/core/scheduling/writeback");
  await reconcileMirroredBookings(tx);

  await tx
    .update(connectedAccounts)
    .set({ lastSyncAt: now, lastError: null })
    .where(eq(connectedAccounts.id, account.id));
  return outcome;
}

export const syncCalendars = defineService({
  name: "connections.syncCalendars",
  summary: "Fetch what an account's calendars say about when somebody is busy.",
  kind: "mutation",
  permission: "scoped",
  writeClass: "write",
  agentCallable: false,
  input: z.object({ id: z.uuid() }),
  output: z.object({
    accountId: uuid,
    calendars: z.number().int(),
    events: z.number().int(),
    removed: z.number().int(),
    failed: z.string().optional(),
  }),
  handler: async (input, ctx) => {
    const account = await readableAccount(ctx.tx, ctx.actor, input.id);
    if (!(await mayReadCalendars(ctx.tx, account.id))) {
      throw new ServiceError(
        "conflict",
        "Calendar reading is switched off for that connection.",
      );
    }
    ctx.setSubject("connected_account", account.id);
    return syncAccountCalendars(ctx.tx, account, new Date());
  },
});

export const listExternalCalendars = defineService({
  name: "connections.listCalendars",
  summary: "The calendars Freeholder has found on a connected account.",
  kind: "query",
  permission: "scoped",
  input: z.object({ id: z.uuid() }),
  output: listed(
    row({
      id: uuid,
      externalId: z.string(),
      name: z.string(),
      colour: z.string().nullable(),
      timezone: z.string().nullable(),
      role: z.enum(["busy_source", "bookable", "ignored"]),
      lastSyncAt: timestamp.nullable(),
      events: z.number().int(),
    }),
  ),
  handler: async (input, ctx) => {
    await readableAccount(ctx.tx, ctx.actor, input.id);
    const items = await ctx.tx
      .select({
        id: externalCalendars.id,
        externalId: externalCalendars.externalId,
        name: externalCalendars.name,
        colour: externalCalendars.colour,
        timezone: externalCalendars.timezone,
        role: externalCalendars.role,
        lastSyncAt: externalCalendars.lastSyncAt,
        createdAt: externalCalendars.createdAt,
        updatedAt: externalCalendars.updatedAt,
      })
      .from(externalCalendars)
      .where(eq(externalCalendars.connectedAccountId, input.id))
      .orderBy(externalCalendars.name);
    if (items.length === 0) return items.map((item) => ({ ...item, events: 0 }));

    const counts = await ctx.tx
      .select({
        calendarId: externalEvents.externalCalendarId,
        events: sql<number>`count(*)::int`,
      })
      .from(externalEvents)
      .where(
        inArray(
          externalEvents.externalCalendarId,
          items.map((item) => item.id),
        ),
      )
      .groupBy(externalEvents.externalCalendarId);
    const byCalendar = new Map(counts.map((c) => [c.calendarId, c.events]));
    return items.map((item) => ({ ...item, events: byCalendar.get(item.id) ?? 0 }));
  },
});

export const setCalendarRole = defineService({
  name: "connections.setCalendarRole",
  summary: "Say whether a calendar blocks time, can be booked into, or is ignored.",
  kind: "mutation",
  permission: "scoped",
  writeClass: "write",
  agentCallable: false,
  input: z.object({
    id: z.uuid(),
    role: z.enum(["busy_source", "bookable", "ignored"]),
  }),
  output: z.object({ id: uuid, role: z.enum(["busy_source", "bookable", "ignored"]) }),
  handler: async (input, ctx) => {
    const [calendar] = await ctx.tx
      .select({
        id: externalCalendars.id,
        accountId: externalCalendars.connectedAccountId,
      })
      .from(externalCalendars)
      .where(eq(externalCalendars.id, input.id))
      .limit(1);
    if (!calendar) throw new ServiceError("not_found", "No such calendar.");
    await readableAccount(ctx.tx, ctx.actor, calendar.accountId);

    // Ignoring a calendar has to erase what was already read from it, or the
    // setting would mean "stop looking" while the last look stayed on file.
    if (input.role === "ignored") {
      await ctx.tx
        .delete(externalEvents)
        .where(
          and(
            eq(externalEvents.externalCalendarId, calendar.id),
            isNull(externalEvents.bookingId),
          ),
        );
    }
    const [updated] = await ctx.tx
      .update(externalCalendars)
      .set({
        role: input.role,
        // The cursor described a stream nobody was reading; a calendar coming
        // back from `ignored` starts from a full pass.
        ...(input.role === "ignored" ? { syncToken: null, lastSyncAt: null } : {}),
        updatedAt: sql`now()`,
      })
      .where(eq(externalCalendars.id, calendar.id))
      .returning({ id: externalCalendars.id, role: externalCalendars.role });

    ctx.setSubject("connected_account", calendar.accountId);
    ctx.queueEvent("connection.updated", { id: calendar.accountId });
    return updated!;
  },
});

/**
 * Every account with calendar reading switched on, swept on a schedule.
 *
 * A failure here is an account-level event, not a run-level one. The loop
 * records what went wrong against the account it went wrong on and carries on,
 * because "one mailbox needs reconnecting" must not read as "calendar sync is
 * down".
 */
export async function syncDueCalendarAccounts(): Promise<{
  synced: number;
  failed: number;
  outcomes: CalendarSyncOutcome[];
}> {
  const due = await db()
    .select({ id: connectedAccounts.id })
    .from(connectedAccounts)
    .innerJoin(
      connectionCapabilities,
      eq(connectionCapabilities.connectedAccountId, connectedAccounts.id),
    )
    .where(
      and(
        eq(connectedAccounts.status, "active"),
        eq(connectionCapabilities.capability, "calendar_read"),
        eq(connectionCapabilities.enabled, true),
        sql`${connectedAccounts.provider} in ('google', 'microsoft')`,
      ),
    );

  const outcomes: CalendarSyncOutcome[] = [];
  let failed = 0;
  for (const account of due) {
    try {
      outcomes.push(
        (await syncCalendars.call({ id: account.id }, { kind: "system" })),
      );
    } catch (error) {
      failed += 1;
      const reason =
        error instanceof MailAdapterError || error instanceof ServiceError
          ? error.message
          : "The provider could not be reached.";
      outcomes.push({
        accountId: account.id,
        calendars: 0,
        events: 0,
        removed: 0,
        failed: reason,
      });
      // A transport wobble is not a reconnect prompt. Only an account the
      // refresh already gave up on is escalated to the owner, and that
      // decision was made where the credential is (see `oauth-core.ts`).
      const [state] = await db()
        .select({
          status: connectedAccounts.status,
          lastError: connectedAccounts.lastError,
        })
        .from(connectedAccounts)
        .where(eq(connectedAccounts.id, account.id))
        .limit(1);
      if (state?.status === "needs_reconnect") {
        await getService("connections.flag").call(
          {
            id: account.id,
            // The refresh already wrote what the provider actually said.
            // Flagging is here to *tell somebody*, not to replace a precise
            // reason with a vaguer one.
            status: "needs_reconnect",
            reason: state.lastError ?? "This connection needs to be reconnected.",
          },
          { kind: "system" },
        );
      }
    }
  }
  return { synced: outcomes.length - failed, failed, outcomes };
}

export default [syncCalendars, listExternalCalendars, setCalendarRole];
