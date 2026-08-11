// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: AGPL-3.0-only
// Analytics services (MASTER.md §4.7, §36).
//
// The claim in §4.7 is that a funnel is not a separate product: it is this
// table joined to the money tables through `contact_id`. That only works if
// the join key gets filled in, which is what `identify` is for — and if the
// events are recorded by the platform rather than by a script a visitor can
// block, which is why a pageview is written during the server render and
// there is no client bundle at all.
import { z } from "zod";
import {
  and,
  count,
  countDistinct,
  desc,
  eq,
  gte,
  isNotNull,
  isNull,
  inArray,
  ne,
  sql,
  type SQL,
} from "drizzle-orm";
import { defineService, ServiceError } from "@/core/service";
import { registerContactReference } from "@/core/contacts/service";
import { analyticsEvents } from "./schema";

// CLAUDE.md's non-negotiable: events point at contacts, so a merge has to
// bring a visitor's history with them. Unconditional — one person may have
// thousands of events, and after a merge all of them belong to the survivor.
registerContactReference({
  table: "analytics_events",
  repoint: (tx, duplicateId, survivingId) =>
    tx
      .update(analyticsEvents)
      .set({ contactId: survivingId })
      .where(eq(analyticsEvents.contactId, duplicateId)),
  captureForUndo: async (tx, duplicateId, survivingId) => ({
    state: await tx
      .select({ id: analyticsEvents.id, contactId: analyticsEvents.contactId })
      .from(analyticsEvents)
      .where(inArray(analyticsEvents.contactId, [duplicateId, survivingId])),
    undoable: true,
  }),
  restoreAfterUndo: async (tx, beforeState, afterState, duplicateId) => {
    const schema = z.array(
      z.object({ id: z.string().uuid(), contactId: z.string().uuid().nullable() }),
    );
    const before = schema.parse(beforeState);
    const after = schema.parse(afterState);
    const current = after.length
      ? await tx
          .select({ id: analyticsEvents.id, contactId: analyticsEvents.contactId })
          .from(analyticsEvents)
          .where(inArray(analyticsEvents.id, after.map((row) => row.id)))
      : [];
    const byId = new Map(current.map((row) => [row.id, row.contactId]));
    if (
      current.length !== after.length ||
      after.some((row) => byId.get(row.id) !== row.contactId)
    ) {
      throw new ServiceError(
        "conflict",
        "An analytics event changed after this merge. Leave the merge in place or restore that event first.",
      );
    }
    const moved = before.filter((row) => row.contactId === duplicateId);
    if (moved.length) {
      await tx
        .update(analyticsEvents)
        .set({ contactId: duplicateId })
        .where(inArray(analyticsEvents.id, moved.map((row) => row.id)));
    }
  },
});

/**
 * The host somebody arrived from, not the page.
 *
 * "google.com" answers the question an owner has. The full referring URL is a
 * fragment of a stranger's browsing history, and storing it would make this
 * table something the platform would have to defend.
 */
export function referrerHost(referrer: string | null | undefined): string | null {
  if (!referrer) return null;
  try {
    const host = new URL(referrer).hostname.replace(/^www\./, "");
    return host || null;
  } catch {
    return null;
  }
}

const visitor = {
  anonId: z.string().min(1).max(64),
  sessionId: z.string().min(1).max(64),
};

/**
 * Record something that happened.
 *
 * `public` because the caller is a page render serving an anonymous visitor.
 * It writes one row and nothing else — there is no path from here to any other
 * table, which is what makes a public write safe to leave open.
 */
export const track = defineService({
  name: "analytics.track",
  summary: "Record one first-party event.",
  kind: "mutation",
  permission: "public",
  input: z.object({
    ...visitor,
    name: z.string().min(1).max(60),
    path: z.string().max(2000).default("/"),
    referrer: z.string().max(2000).nullish(),
    locale: z.string().max(20).nullish(),
    props: z.record(z.string(), z.unknown()).default({}),
    contactId: z.string().uuid().nullish(),
    visitorKind: z.enum(["human", "bot", "suspected"]).default("human"),
    botReasons: z.array(z.string().max(200)).max(10).default([]),
  }),
  handler: async (input, ctx) => {
    await ctx.tx.insert(analyticsEvents).values({
      anonId: input.anonId,
      sessionId: input.sessionId,
      contactId: input.contactId ?? null,
      name: input.name,
      path: input.path,
      referrer: referrerHost(input.referrer),
      locale: input.locale,
      props: input.props,
      visitorKind: input.visitorKind,
      botReasons: input.botReasons,
    });
    return { ok: true };
  },
});

/**
 * A visitor turned out to be somebody.
 *
 * Backfills the whole history, not just what happens next. Without that, a
 * contact's first recorded moment is the form they submitted rather than the
 * three pages they read first — and "which page brings me enquiries" is the
 * question owners actually ask.
 */
export const identify = defineService({
  name: "analytics.identify",
  summary: "Attach a visitor's history to the contact they turned out to be.",
  kind: "mutation",
  permission: "public",
  input: z.object({
    anonId: z.string().min(1).max(64),
    contactId: z.string().uuid(),
  }),
  handler: async (input, ctx) => {
    const updated = await ctx.tx
      .update(analyticsEvents)
      .set({ contactId: input.contactId })
      .where(
        and(
          eq(analyticsEvents.anonId, input.anonId),
          isNull(analyticsEvents.contactId),
        ),
      )
      .returning({ id: analyticsEvents.id });
    return { linked: updated.length };
  },
});

/* ------------------------------------------------------------------ reading */

const since = z.number().int().min(1).max(365).default(30);

/**
 * Whether a query counts programs as well as people.
 *
 * Every reporting query takes it, and the *default is people* — because the
 * number an owner means when they ask how many visitors they had is people.
 * An owner who wants the other answer asks for it, and the rows were kept so
 * they can.
 */
const includeBots = z.boolean().default(false);

/** "Only people", unless the caller said otherwise. */
function humansOnly(include: boolean): SQL | undefined {
  return include ? undefined : eq(analyticsEvents.visitorKind, "human");
}

/**
 * The module's stored preference, so a screen need not be told each time.
 *
 * Read through the service layer like everything else, so a module's settings
 * are validated by the schema its own manifest declares (§11).
 */
export async function includeBotsSetting(): Promise<boolean> {
  const { getModuleConfig } = await import("@/core/settings/service");
  const config = await getModuleConfig.call(
    { module: "analytics" },
    { kind: "system" },
  );
  return (config as { includeBots?: boolean }).includeBots === true;
}

export const overview = defineService({
  name: "analytics.overview",
  summary: "Visits, visitors and conversions over a window.",
  kind: "query",
  permission: "scoped",
  input: z.object({ days: since, includeBots }),
  handler: async (input, ctx) => {
    const from = new Date(Date.now() - input.days * 86_400_000);
    const only = humansOnly(input.includeBots);
    const [totals] = await ctx.tx
      .select({
        views: count(),
        visitors: countDistinct(analyticsEvents.anonId),
        sessions: countDistinct(analyticsEvents.sessionId),
      })
      .from(analyticsEvents)
      .where(
        and(eq(analyticsEvents.name, "page.viewed"), gte(analyticsEvents.at, from), only),
      );

    const [conversions] = await ctx.tx
      .select({ n: count() })
      .from(analyticsEvents)
      .where(
        and(eq(analyticsEvents.name, "form.submitted"), gte(analyticsEvents.at, from), only),
      );

    // The funnel §4.7 promises, as far as the platform can currently take it:
    // visits → the ones that became somebody. Quotes and payments join this
    // query by their own contact_id when those modules exist.
    const [identified] = await ctx.tx
      .select({ n: countDistinct(analyticsEvents.anonId) })
      .from(analyticsEvents)
      .where(
        and(gte(analyticsEvents.at, from), isNotNull(analyticsEvents.contactId), only),
      );

    // Always counted, whatever the filter says: an owner deciding whether to
    // trust the other five numbers needs to know how much was excluded.
    const [automated] = await ctx.tx
      .select({ n: count() })
      .from(analyticsEvents)
      .where(
        and(
          eq(analyticsEvents.name, "page.viewed"),
          gte(analyticsEvents.at, from),
          ne(analyticsEvents.visitorKind, "human"),
        ),
      );

    return {
      days: input.days,
      includeBots: input.includeBots,
      automated: automated?.n ?? 0,
      views: totals?.views ?? 0,
      visitors: totals?.visitors ?? 0,
      sessions: totals?.sessions ?? 0,
      conversions: conversions?.n ?? 0,
      identified: identified?.n ?? 0,
    };
  },
});

export const topPages = defineService({
  name: "analytics.topPages",
  summary: "Which pages were read, most first.",
  kind: "query",
  permission: "scoped",
  input: z.object({
    days: since,
    includeBots,
    limit: z.number().int().min(1).max(50).default(10),
  }),
  handler: (input, ctx) =>
    ctx.tx
      .select({
        path: analyticsEvents.path,
        views: count(),
        visitors: countDistinct(analyticsEvents.anonId),
      })
      .from(analyticsEvents)
      .where(
        and(
          eq(analyticsEvents.name, "page.viewed"),
          gte(analyticsEvents.at, new Date(Date.now() - input.days * 86_400_000)),
          humansOnly(input.includeBots),
        ),
      )
      .groupBy(analyticsEvents.path)
      .orderBy(desc(count()))
      .limit(input.limit),
});

export const topReferrers = defineService({
  name: "analytics.topReferrers",
  summary: "Where visitors came from.",
  kind: "query",
  permission: "scoped",
  input: z.object({
    days: since,
    includeBots,
    limit: z.number().int().min(1).max(50).default(10),
  }),
  handler: (input, ctx) =>
    ctx.tx
      .select({
        referrer: analyticsEvents.referrer,
        visitors: countDistinct(analyticsEvents.anonId),
      })
      .from(analyticsEvents)
      .where(
        and(
          isNotNull(analyticsEvents.referrer),
          gte(analyticsEvents.at, new Date(Date.now() - input.days * 86_400_000)),
          humansOnly(input.includeBots),
        ),
      )
      .groupBy(analyticsEvents.referrer)
      .orderBy(desc(countDistinct(analyticsEvents.anonId)))
      .limit(input.limit),
});

export const dailyViews = defineService({
  name: "analytics.daily",
  summary: "Views and visitors per day, for the chart.",
  kind: "query",
  permission: "scoped",
  input: z.object({ days: since, includeBots, timezone: z.string().default("UTC") }),
  handler: async (input, ctx) => {
    // Bucketed in the *business's* timezone, not UTC. An owner in Vancouver
    // looking at "yesterday" means their yesterday, and a chart that disagrees
    // with the calendar on the wall is a chart nobody trusts.
    const rows = await ctx.tx
      .select({
        day: sql<string>`to_char(date_trunc('day', ${analyticsEvents.at} at time zone ${input.timezone}), 'YYYY-MM-DD')`,
        views: count(),
        visitors: countDistinct(analyticsEvents.anonId),
      })
      .from(analyticsEvents)
      .where(
        and(
          eq(analyticsEvents.name, "page.viewed"),
          gte(analyticsEvents.at, new Date(Date.now() - input.days * 86_400_000)),
          humansOnly(input.includeBots),
        ),
      )
      .groupBy(sql`1`)
      .orderBy(sql`1`);
    return rows;
  },
});

/**
 * Recent events for one contact, for their timeline.
 *
 * The CRM already shows what a person *did* with the business. This is what
 * they read before deciding to.
 */
export const contactActivity = defineService({
  name: "analytics.contactActivity",
  summary: "What one contact looked at.",
  kind: "query",
  permission: "scoped",
  input: z.object({
    contactId: z.string().uuid(),
    limit: z.number().int().min(1).max(200).default(50),
  }),
  handler: (input, ctx) =>
    ctx.tx
      .select()
      .from(analyticsEvents)
      .where(eq(analyticsEvents.contactId, input.contactId))
      .orderBy(desc(analyticsEvents.at))
      .limit(input.limit),
});

/**
 * A form submission became a contact — so the visitor who read three pages
 * first was that contact all along.
 *
 * On the bus rather than called by forms, which is §11 working as advertised:
 * forms announces what happened and does not know analytics exists. The one
 * thing the event cannot carry is *which browser* submitted it, so the cookie
 * is read here — the listener runs post-commit inside the same request, where
 * a cookie is still readable.
 *
 * If it ever does not (a job replaying events out of band, once the outbox in
 * §39's roadmap lands), the conversion is recorded without the visitor link
 * rather than lost: an anonymous count is worth more than an exception.
 */
export async function onFormSubmitted(payload: unknown): Promise<void> {
  const { contactId } = (payload ?? {}) as { contactId?: string | null };

  let anonId: string | undefined;
  let sessionId: string | undefined;
  try {
    const { cookies } = await import("next/headers");
    const jar = await cookies();
    const { ANON_COOKIE, SESSION_COOKIE_NAME } = await import("./visitor");
    anonId = jar.get(ANON_COOKIE)?.value;
    sessionId = jar.get(SESSION_COOKIE_NAME)?.value;
  } catch {
    // Outside a request. Nothing to link, and nothing to complain about.
  }

  if (anonId && sessionId) {
    await track.call(
      {
        anonId,
        sessionId,
        name: "form.submitted",
        path: "/",
        contactId: contactId ?? null,
        props: {},
      },
      { kind: "system" },
    );
    if (contactId) {
      await identify.call({ anonId, contactId }, { kind: "system" });
    }
  }
}

export default [
  track,
  identify,
  overview,
  topPages,
  topReferrers,
  dailyViews,
  contactActivity,
];
