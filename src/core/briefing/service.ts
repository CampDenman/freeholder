// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Assembling and reading the daily briefing (MASTER.md §42, C4.15).
//
// The screen is a read. Everything expensive — asking each contributor, waking
// whatever they wake — happens in `briefing.assemble`, which a scheduled job
// runs before the owner arrives. §42 is explicit about why: a briefing
// produced on demand is either a slow screen or an empty one.
//
// Sections are stored as they were when the briefing was assembled, not
// recomputed on read. "Three invoices were overdue this morning" is a
// statement about a moment, and a briefing that quietly rewrote itself as the
// day went on would be one nobody could act on.
import { z } from "zod";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/core/db";
import { listed, row, timestamp, uuid } from "@/core/contract";
import { users } from "@/core/auth/schema";
import {
  briefings,
  briefingContributions,
  briefingPreferences,
} from "@/core/briefing/schema";
import {
  briefingContribution,
  briefingContributors,
  briefingItem,
  SEVERITY_ORDER,
  type BriefingContribution,
} from "@/core/briefing/registry";
import { zonedDate } from "@/core/i18n/zoned";
import { getBusiness } from "@/core/settings/service";
import {
  defineService,
  getService,
  ServiceError,
  type Actor,
  type ServiceContext,
} from "@/core/service";

const SEVERITY = ["attention", "today", "changed"] as const;

const sectionRow = z.object({
  key: z.string(),
  source: z.enum(["core", "module", "playbook"]),
  title: z.string(),
  body: z.string().nullable(),
  items: z.array(briefingItem),
  severity: z.enum(SEVERITY),
  playbookRunId: uuid.nullable(),
});

function requirePerson(actor: Actor): string {
  if (actor.kind !== "user") {
    throw new ServiceError(
      "permission",
      "A briefing belongs to a person. Sign in to read yours.",
    );
  }
  return actor.userId;
}

/** The business's today, which is the only "today" a briefing is about. */
function todayIn(timezone: string): { onDate: string; timezone: string } {
  const date = zonedDate(new Date(), timezone);
  return {
    onDate: `${date.year}-${String(date.month).padStart(2, "0")}-${String(date.day).padStart(2, "0")}`,
    timezone,
  };
}

export async function businessToday(): Promise<{ onDate: string; timezone: string }> {
  const business = await getBusiness.call({}, { kind: "anonymous" }).catch(() => null);
  const timezone = business?.timezone ?? "UTC";
  return todayIn(timezone);
}

async function businessTodayIn(
  ctx: ServiceContext,
): Promise<{ onDate: string; timezone: string }> {
  const business = await ctx.call(getBusiness, {}).catch(() => null);
  return todayIn(business?.timezone ?? "UTC");
}

/**
 * Ask one contributor what it has to say.
 *
 * A contributor that throws costs its own section and nothing else. §42's
 * briefing carries the warnings about the platform being unhappy, so it is
 * exactly the screen that must survive one unhappy part of the platform.
 */
async function askContributor(
  ctx: ServiceContext,
  serviceName: string,
  request: Record<string, string>,
): Promise<BriefingContribution> {
  try {
    const service = getService(serviceName);
    const answer = await ctx.call(service, request);
    return briefingContribution.parse(answer ?? null);
  } catch (error) {
    console.warn(`[briefing] contributor "${serviceName}" failed`, error);
    return null;
  }
}

export const assembleBriefing = defineService({
  name: "briefing.assemble",
  summary: "Build one person's briefing for one day, before they arrive.",
  kind: "mutation",
  permission: "system",
  input: z.object({
    userId: z.uuid(),
    onDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    timezone: z.string().min(1).max(80).optional(),
  }),
  output: z.object({
    id: uuid,
    onDate: z.string(),
    sections: z.number().int(),
    status: z.enum(["assembling", "ready", "failed"]),
  }),
  handler: async (input, ctx) => {
    if (ctx.actor.kind !== "system") {
      throw new ServiceError(
        "permission",
        "Briefings are assembled by the scheduler, not on request.",
      );
    }
    const today = await businessTodayIn(ctx);
    const onDate = input.onDate ?? today.onDate;
    const timezone = input.timezone ?? today.timezone;

    const [briefing] = await ctx.tx
      .insert(briefings)
      .values({ userId: input.userId, onDate, status: "assembling" })
      .onConflictDoUpdate({
        target: [briefings.userId, briefings.onDate],
        // Re-assembly replaces the day's sections rather than producing a
        // second Tuesday. Read state survives: somebody who read this
        // morning's briefing has read it.
        set: { status: "assembling", updatedAt: sql`now()` },
      })
      .returning();

    await ctx.tx
      .delete(briefingContributions)
      .where(eq(briefingContributions.briefingId, briefing!.id));

    const registered = await briefingContributors();
    let sections = 0;
    for (const contributor of registered) {
      const said = await askContributor(ctx, contributor.service, {
        userId: input.userId,
        onDate,
        timezone,
        ...contributor.params,
      });
      // Nothing to say and an empty list are the same answer, and §42 omits
      // both: a briefing that lists everything is one nobody finishes.
      if (!said || (said.items.length === 0 && !said.body)) continue;
      await ctx.tx.insert(briefingContributions).values({
        briefingId: briefing!.id,
        key: contributor.key,
        source: contributor.source,
        title: said.title,
        body: said.body ?? null,
        items: said.items,
        severity: said.severity,
        position: contributor.position,
        playbookRunId: said.playbookRunId ?? null,
      });
      sections += 1;
    }

    await ctx.tx
      .update(briefings)
      .set({ status: "ready", assembledAt: sql`now()`, updatedAt: sql`now()` })
      .where(eq(briefings.id, briefing!.id));

    // Delivery is not only a screen (§42): a business owner who does not open
    // the admin until Thursday still needs to know about Monday. This goes
    // through the ordinary notification path, so which channels it reaches —
    // inbox, email, SMS, push — is the person's existing preference and not a
    // second set of settings to keep in step. A briefing with nothing in it is
    // not worth anybody's phone buzzing.
    if (sections > 0) {
      await ctx.call(getService("notifications.create"), {
        recipient: { kind: "user", id: input.userId },
        topic: "briefing.ready",
        priority: "information",
        titleKey: "notifications.event.briefing.title",
        bodyKey: "notifications.event.briefing.body",
        messageParams: { count: sections },
        href: "/admin/briefing",
        idempotencyKey: `briefing:${briefing!.id}`,
        // One a day, however many times the day is re-assembled.
        dedupeKey: `briefing:${input.userId}:${onDate}`,
      });
    }

    ctx.setSubject("briefing", briefing!.id);
    ctx.queueEvent("briefing.assembled", {
      id: briefing!.id,
      userId: input.userId,
      onDate,
      sections,
    });
    return { id: briefing!.id, onDate, sections, status: "ready" as const };
  },
});

export const readBriefing = defineService({
  name: "briefing.today",
  summary: "Your briefing: what is today, what changed, what needs you.",
  kind: "query",
  permission: "authenticated",
  input: z.object({ onDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() }),
  output: z
    .object({
      id: uuid,
      onDate: z.string(),
      status: z.enum(["assembling", "ready", "failed"]),
      assembledAt: timestamp.nullable(),
      readAt: timestamp.nullable(),
      sections: listed(sectionRow),
      /** Sections this person has switched off, so the screen can offer them back. */
      hidden: z.array(z.object({ key: z.string(), title: z.string() })),
    })
    .nullable(),
  handler: async (input, ctx) => {
    const userId = requirePerson(ctx.actor);
    const onDate = input.onDate ?? (await businessTodayIn(ctx)).onDate;

    const [briefing] = await ctx.tx
      .select()
      .from(briefings)
      .where(and(eq(briefings.userId, userId), eq(briefings.onDate, onDate)))
      .limit(1);
    // Null rather than an empty shell: "today's briefing has not been built
    // yet" and "today has nothing in it" are different things to be told.
    if (!briefing) return null;

    const stored = await ctx.tx
      .select()
      .from(briefingContributions)
      .where(eq(briefingContributions.briefingId, briefing.id));

    const switchedOff = new Set(
      (
        await ctx.tx
          .select({ key: briefingPreferences.key })
          .from(briefingPreferences)
          .where(
            and(
              eq(briefingPreferences.userId, userId),
              eq(briefingPreferences.enabled, false),
            ),
          )
      ).map((preference) => preference.key),
    );

    const visible = stored
      .filter((section) => !switchedOff.has(section.key))
      .sort(
        (a, b) =>
          (SEVERITY_ORDER[a.severity] ?? 9) - (SEVERITY_ORDER[b.severity] ?? 9) ||
          a.position - b.position,
      )
      .map((section) => ({
        key: section.key,
        source: section.source,
        title: section.title,
        body: section.body,
        items: z.array(briefingItem).parse(section.items),
        severity: section.severity,
        playbookRunId: section.playbookRunId,
      }));

    return {
      id: briefing.id,
      onDate: briefing.onDate,
      status: briefing.status,
      assembledAt: briefing.assembledAt,
      readAt: briefing.readAt,
      sections: visible,
      hidden: stored
        .filter((section) => switchedOff.has(section.key))
        .map((section) => ({ key: section.key, title: section.title })),
    };
  },
});

export const markBriefingRead = defineService({
  name: "briefing.markRead",
  summary: "Record that you have read today's briefing.",
  kind: "mutation",
  permission: "authenticated",
  agentCallable: false,
  writeClass: "write",
  input: z.object({ id: z.uuid() }),
  output: z.object({ id: uuid, readAt: timestamp.nullable() }),
  handler: async (input, ctx) => {
    const userId = requirePerson(ctx.actor);
    const [updated] = await ctx.tx
      .update(briefings)
      .set({ readAt: sql`coalesce(${briefings.readAt}, now())`, updatedAt: sql`now()` })
      // Scoped to the reader: a briefing is one person's, and marking
      // somebody else's as read is not a thing that should be possible.
      .where(and(eq(briefings.id, input.id), eq(briefings.userId, userId)))
      .returning({ id: briefings.id, readAt: briefings.readAt });
    if (!updated) throw new ServiceError("not_found", "No such briefing.");
    return updated;
  },
});

export const setBriefingSection = defineService({
  name: "briefing.setSection",
  summary: "Show or hide one section of your briefing.",
  kind: "mutation",
  permission: "authenticated",
  agentCallable: false,
  writeClass: "write",
  input: z.object({ key: z.string().min(1).max(200), enabled: z.boolean() }),
  output: row({ key: z.string(), enabled: z.boolean() }),
  handler: async (input, ctx) => {
    const userId = requirePerson(ctx.actor);
    // A preference, never a delete: switching off "overdue invoices" must not
    // stop invoices being chased, and switching it back on must not need the
    // work rebuilding.
    const [preference] = await ctx.tx
      .insert(briefingPreferences)
      .values({ userId, key: input.key, enabled: input.enabled })
      .onConflictDoUpdate({
        target: [briefingPreferences.userId, briefingPreferences.key],
        set: { enabled: input.enabled, updatedAt: sql`now()` },
      })
      .returning();
    return preference!;
  },
});

export const listBriefings = defineService({
  name: "briefing.recent",
  summary: "The last fortnight of your briefings, read and unread.",
  kind: "query",
  permission: "authenticated",
  input: z.object({}),
  output: listed(
    z.object({
      id: uuid,
      onDate: z.string(),
      status: z.enum(["assembling", "ready", "failed"]),
      readAt: timestamp.nullable(),
      sections: z.number().int(),
    }),
  ),
  handler: async (_input, ctx) => {
    const userId = requirePerson(ctx.actor);
    const recent = await ctx.tx
      .select()
      .from(briefings)
      .where(eq(briefings.userId, userId))
      .orderBy(desc(briefings.onDate))
      .limit(14);
    if (recent.length === 0) return [];

    const counts = await ctx.tx
      .select({
        briefingId: briefingContributions.briefingId,
        sections: sql<number>`count(*)::int`,
      })
      .from(briefingContributions)
      .where(
        inArray(
          briefingContributions.briefingId,
          recent.map((briefing) => briefing.id),
        ),
      )
      .groupBy(briefingContributions.briefingId);
    const byBriefing = new Map(counts.map((count) => [count.briefingId, count.sections]));

    return recent.map((briefing) => ({
      id: briefing.id,
      onDate: briefing.onDate,
      status: briefing.status,
      readAt: briefing.readAt,
      sections: byBriefing.get(briefing.id) ?? 0,
    }));
  },
});

/**
 * Assemble today's briefing for everybody who signs in to the admin.
 *
 * Staff, not contacts: a briefing is a working document about the business.
 * One transaction per person, so a contributor that breaks for one owner does
 * not cost everybody else their morning.
 */
export async function assembleDueBriefings(): Promise<{
  assembled: number;
  failed: number;
}> {
  const { onDate, timezone } = await businessToday();
  const staff = await db()
    .select({ id: users.id })
    .from(users)
    .where(sql`${users.role} <> 'customer'`)
    .orderBy(asc(users.createdAt));

  let assembled = 0;
  let failed = 0;
  for (const person of staff) {
    try {
      await assembleBriefing.call({ userId: person.id, onDate, timezone }, { kind: "system" });
      assembled += 1;
    } catch (error) {
      failed += 1;
      console.warn(`[briefing] could not assemble for ${person.id}`, error);
    }
  }
  return { assembled, failed };
}

export default [assembleBriefing, readBriefing, markBriefingRead, setBriefingSection, listBriefings];
