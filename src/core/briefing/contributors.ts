// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// What core has to say each morning (MASTER.md §42, C4.16).
//
// §42 names two kinds of section, and they are different in an important way.
//
// The first is *what is happening*: today's appointments. The second is
// **anything the platform itself is unhappy about** — an agent that stopped
// and is waiting, a webhook endpoint that paused itself, a connected account
// that needs reconnecting. That second kind is why the briefing is worth
// opening on a quiet day: those failures are silent by design everywhere else,
// because nothing retries into a lockout and nothing pages anybody at 3am.
// This is where they surface, once, in a place somebody actually reads.
//
// Every contributor here answers `null` when it has nothing to say. An empty
// section is worse than no section: it teaches people to skim.
import { z } from "zod";
import { and, asc, eq, gt, lt, sql } from "drizzle-orm";
import { agentTasks } from "@/core/agents/schema";
import {
  connectedAccounts,
  externalCalendars,
  externalEvents,
} from "@/core/connections/schema";
import { webhookSubscriptions } from "@/core/webhooks/schema";
import { zonedInstant } from "@/core/i18n/zoned";
import { defineService, type Tx } from "@/core/service";
import { briefingContribution, type BriefingContribution } from "@/core/briefing/registry";
import { pendingUpdate } from "@/core/briefing/update";

const request = z.object({
  userId: z.uuid(),
  onDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  timezone: z.string().min(1).max(80),
});

/** A contributor is a query with a fixed shape; this is the shape. */
function contributor(
  name: string,
  summary: string,
  produce: (
    tx: Tx,
    input: { userId: string; onDate: string; timezone: string },
  ) => Promise<BriefingContribution>,
) {
  return defineService({
    name,
    summary,
    kind: "query" as const,
    // Assembly runs as system on everybody's behalf; a contributor is never
    // reachable from outside, which is why it may read across the business.
    permission: "system" as const,
    input: request,
    output: briefingContribution,
    handler: (input, ctx) => produce(ctx.tx, input),
  });
}

/** The business's day, as the two instants that bound it. */
function dayBounds(onDate: string, timezone: string): { from: Date; to: Date } {
  const [year, month, day] = onDate.split("-").map(Number) as [number, number, number];
  const from = zonedInstant(timezone, { year, month, day });
  const to = zonedInstant(timezone, {
    year,
    month,
    // A day is 23, 24 or 25 hours long; asking for "the next date" rather than
    // "+24 hours" is what makes that true twice a year.
    day: day + 1,
  });
  return { from, to };
}

/**
 * Today's appointments, across every calendar shared with the business.
 *
 * Titles appear only where the account already allows detail (C4.12); where it
 * does not, the honest line is the time and the word "busy". A briefing is not
 * a way around a privacy setting.
 */
export const appointmentsToday = contributor(
  "briefing.appointments",
  "Today's appointments from connected calendars.",
  async (tx, input) => {
    const { from, to } = dayBounds(input.onDate, input.timezone);
    const rows = await tx
      .select({
        startsAt: externalEvents.startsAt,
        endsAt: externalEvents.endsAt,
        allDay: externalEvents.allDay,
        title: externalEvents.title,
      })
      .from(externalEvents)
      .innerJoin(
        externalCalendars,
        eq(externalCalendars.id, externalEvents.externalCalendarId),
      )
      .innerJoin(
        connectedAccounts,
        eq(connectedAccounts.id, externalCalendars.connectedAccountId),
      )
      .where(
        and(
          eq(connectedAccounts.sharedWithBusiness, true),
          sql`${externalCalendars.role} <> 'ignored'`,
          eq(externalEvents.busy, true),
          gt(externalEvents.endsAt, from),
          lt(externalEvents.startsAt, to),
        ),
      )
      .orderBy(asc(externalEvents.startsAt))
      .limit(20);
    if (rows.length === 0) return null;

    const clock = new Intl.DateTimeFormat("en-GB", {
      timeZone: input.timezone,
      hour: "2-digit",
      minute: "2-digit",
    });
    return {
      title: "Today",
      severity: "today" as const,
      items: rows.map((row) => ({
        label: row.title ?? "Busy",
        detail: row.allDay
          ? "All day"
          : `${clock.format(row.startsAt)}–${clock.format(row.endsAt)}`,
      })),
    };
  },
);

/**
 * Work that stopped and is waiting for a person.
 *
 * §40's whole autonomy design means an agent that hits its ceiling waits
 * rather than pressing on. Waiting is correct and completely silent, so
 * without this section the safety feature reads as the work never happening.
 */
export const agentAttention = contributor(
  "briefing.agentAttention",
  "Agent work that failed or is waiting for you.",
  async (tx) => {
    const rows = await tx
      .select({
        id: agentTasks.id,
        title: agentTasks.title,
        status: agentTasks.status,
      })
      .from(agentTasks)
      .where(
        sql`${agentTasks.status} in ('needs_attention', 'failed', 'waiting_approval')`,
      )
      .orderBy(asc(agentTasks.createdAt))
      .limit(15);
    if (rows.length === 0) return null;

    const waiting = rows.filter((row) => row.status === "waiting_approval").length;
    return {
      title: "Work waiting on you",
      severity: "attention" as const,
      body:
        waiting > 0
          ? `${waiting} of these cannot go any further until you answer.`
          : undefined,
      items: rows.map((row) => ({
        label: row.title,
        href:
          row.status === "waiting_approval"
            ? "/admin/work/approvals"
            : `/admin/work/tasks/${row.id}`,
        detail:
          row.status === "waiting_approval"
            ? "Waiting for approval"
            : row.status === "failed"
              ? "Failed"
              : "Needs attention",
      })),
    };
  },
);

/**
 * Endpoints the platform switched off to stop hammering a dead server.
 *
 * Pausing is the right behaviour and it is invisible: the owner's other
 * system simply stops hearing about orders. This is the only place that says
 * so before somebody notices a week of missing data.
 */
export const webhookFailures = contributor(
  "briefing.webhookFailures",
  "Webhook endpoints the platform paused.",
  async (tx) => {
    const rows = await tx
      .select({
        id: webhookSubscriptions.id,
        url: webhookSubscriptions.url,
        reason: webhookSubscriptions.pausedReason,
      })
      .from(webhookSubscriptions)
      .where(eq(webhookSubscriptions.status, "paused"))
      .limit(10);
    if (rows.length === 0) return null;
    return {
      title: "Webhooks that stopped",
      severity: "attention" as const,
      body: "These paused themselves after repeated failures. Nothing is being sent to them.",
      items: rows.map((row) => ({
        label: safeHost(row.url),
        href: "/admin/settings",
        detail: row.reason ?? undefined,
      })),
    };
  },
);

/**
 * Connections that have stopped working.
 *
 * §41 treats a revoked grant as a state rather than an error, precisely so
 * nothing retries into a lockout. The cost of that correctness is that a dead
 * mailbox is silent until somebody looks, so it is named here.
 */
export const connectionsNeedingAttention = contributor(
  "briefing.reconnects",
  "Connected accounts that need reconnecting.",
  async (tx) => {
    const rows = await tx
      .select({
        id: connectedAccounts.id,
        email: connectedAccounts.email,
        provider: connectedAccounts.provider,
        status: connectedAccounts.status,
        lastError: connectedAccounts.lastError,
      })
      .from(connectedAccounts)
      .where(sql`${connectedAccounts.status} in ('needs_reconnect', 'revoked')`)
      .limit(10);
    if (rows.length === 0) return null;
    return {
      title: "Connections that need you",
      severity: "attention" as const,
      items: rows.map((row) => ({
        label: row.email ?? row.provider,
        detail: row.lastError ?? "Reconnect this account.",
      })),
    };
  },
);

/**
 * An available update (§39).
 *
 * The check itself is C10.04 — a jittered GET of a signed static file that
 * reports nothing about this instance. Until it lands, the seam answers "no
 * update known" and this section is simply absent, which is the same thing
 * the section does on an instance that is already current.
 */
export const updateAvailable = contributor(
  "briefing.update",
  "An available Freeholder update.",
  async () => {
    const update = await pendingUpdate();
    if (!update) return null;
    return {
      title: "An update is available",
      severity: update.security ? ("attention" as const) : ("changed" as const),
      body: update.summary,
      items: [{ label: update.version, detail: update.security ? "Security" : undefined }],
    };
  },
);

/** A URL an owner recognises, without pasting a signed callback into a page. */
function safeHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "an endpoint";
  }
}

export default [
  appointmentsToday,
  agentAttention,
  webhookFailures,
  connectionsNeedingAttention,
  updateAvailable,
];
