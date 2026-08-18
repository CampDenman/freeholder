// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Analytics services (MASTER.md §4.7, §36).
//
// The claim in §4.7 is that a funnel is not a separate product: it is this
// table joined to the money tables through `contact_id`. That only works if
// the join key gets filled in, which is what `identify` is for — and if the
// pageviews are recorded during the server render. The small consent/runtime
// client exists only to apply the configured policy and report Web Vitals.
import { createHash } from "node:crypto";
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
  lt,
  ne,
  or,
  sql,
  type SQL,
} from "drizzle-orm";
import { listed, okResult, row, timestamp, uuid } from "@/core/contract";
import { defineService, ServiceError, type Tx } from "@/core/service";
import { db } from "@/core/db";
import { registerContactReference } from "@/core/contacts/service";
import { registerContactPrivacySource } from "@/core/privacy/service";
import { analyticsAttributions, analyticsEvents } from "./schema";
import { currentAnalyticsSettings } from "./read";
import type { VisitorKind } from "./classify";
import type { AnalyticsConsentState } from "./visitor";

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

registerContactPrivacySource({
  scope: "analytics.events",
  tables: ["analytics_events", "analytics_attributions"],
  exportData: async (tx, contactId) => {
    const events = await tx
      .select()
      .from(analyticsEvents)
      .where(eq(analyticsEvents.contactId, contactId))
      .orderBy(analyticsEvents.at);
    const anonIds = [...new Set(events.map((event) => event.anonId))];
    const attribution = anonIds.length > 0
      ? await tx
          .select()
          .from(analyticsAttributions)
          .where(inArray(analyticsAttributions.anonId, anonIds))
      : [];
    return { events, attribution };
  },
  erase: async (tx, contactId) => {
    const linked = await tx
      .selectDistinct({ anonId: analyticsEvents.anonId })
      .from(analyticsEvents)
      .where(eq(analyticsEvents.contactId, contactId));
    const attribution = linked.length > 0
      ? await tx
          .delete(analyticsAttributions)
          .where(inArray(
            analyticsAttributions.anonId,
            linked.map((row) => row.anonId),
          ))
          .returning({ anonId: analyticsAttributions.anonId })
      : [];
    const rows = await tx
      .update(analyticsEvents)
      .set({
        contactId: null,
        anonId: sql`'erased-' || ${analyticsEvents.id}::text`,
        sessionId: sql`'erased-' || ${analyticsEvents.id}::text`,
        referrer: null,
        locale: null,
        props: {},
        eventKey: null,
        classificationNote: null,
      })
      .where(eq(analyticsEvents.contactId, contactId))
      .returning({ id: analyticsEvents.id });
    return { affected: rows.length + attribution.length };
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

export interface CampaignTouch {
  source: string;
  medium: string | null;
  campaign: string | null;
  term: string | null;
  content: string | null;
}

const campaignTouchSchema = z.object({
  source: z.string().min(1).max(120),
  medium: z.string().max(120).nullable(),
  campaign: z.string().max(120).nullable(),
  term: z.string().max(120).nullable(),
  content: z.string().max(120).nullable(),
});

const visitorKind = z.enum(["human", "bot", "suspected"]);
const countInt = z.coerce.number().int();
const analyticsEventRow = row({
  id: uuid,
  eventKey: z.string().nullable(),
  anonId: z.string(),
  sessionId: z.string(),
  contactId: uuid.nullable(),
  name: z.string(),
  path: z.string(),
  referrer: z.string().nullable(),
  locale: z.string().nullable(),
  visitorKind,
  botReasons: listed(z.string()),
  classificationOverride: visitorKind.nullable(),
  classificationNote: z.string().nullable(),
  props: z.unknown(),
  at: timestamp,
});

function campaignValue(value: string | string[] | undefined): string | null {
  const raw = Array.isArray(value) ? value[0] : value;
  if (!raw) return null;
  const clean = raw
    .normalize("NFKC")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
  return clean || null;
}

/** Normalize campaign parameters and discard unique advertising click ids. */
export function campaignFromQuery(
  query: Record<string, string | string[] | undefined>,
): CampaignTouch | null {
  let source = campaignValue(query.utm_source);
  let medium = campaignValue(query.utm_medium);
  const campaign = campaignValue(query.utm_campaign);
  const term = campaignValue(query.utm_term);
  const content = campaignValue(query.utm_content);
  const clickSource = query.gclid
    ? "google"
    : query.msclkid
      ? "bing"
      : query.fbclid
        ? "facebook"
        : null;
  if (clickSource) {
    source ??= clickSource;
    medium ??= "paid";
  }
  if (!source && !medium && !campaign && !term && !content) return null;
  return {
    source: source ?? "unknown",
    medium,
    campaign,
    term,
    content,
  };
}

const visitor = {
  anonId: z.string().min(1).max(64),
  sessionId: z.string().min(1).max(64),
};

const effectiveVisitorKind = sql<VisitorKind>`coalesce(
  ${analyticsEvents.classificationOverride},
  ${analyticsEvents.visitorKind}
)`;

async function recordCampaignTouch(
  tx: Tx,
  input: {
    anonId: string;
    path: string;
    referrer: string | null;
    campaign: CampaignTouch;
  },
): Promise<void> {
  const now = new Date();
  await tx
    .insert(analyticsAttributions)
    .values({
      anonId: input.anonId,
      firstSource: input.campaign.source,
      firstMedium: input.campaign.medium,
      firstCampaign: input.campaign.campaign,
      firstTerm: input.campaign.term,
      firstContent: input.campaign.content,
      firstPath: input.path,
      firstReferrer: input.referrer,
      firstAt: now,
      lastSource: input.campaign.source,
      lastMedium: input.campaign.medium,
      lastCampaign: input.campaign.campaign,
      lastTerm: input.campaign.term,
      lastContent: input.campaign.content,
      lastPath: input.path,
      lastReferrer: input.referrer,
      lastAt: now,
    })
    .onConflictDoUpdate({
      target: analyticsAttributions.anonId,
      set: {
        lastSource: input.campaign.source,
        lastMedium: input.campaign.medium,
        lastCampaign: input.campaign.campaign,
        lastTerm: input.campaign.term,
        lastContent: input.campaign.content,
        lastPath: input.path,
        lastReferrer: input.referrer,
        lastAt: now,
      },
    });
}

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
    eventKey: z.string().min(1).max(160).nullish(),
    path: z.string().max(2000).default("/"),
    referrer: z.string().max(2000).nullish(),
    locale: z.string().max(20).nullish(),
    props: z.record(z.string(), z.unknown()).default({}),
    contactId: z.string().uuid().nullish(),
    visitorKind: z.enum(["human", "bot", "suspected"]).default("human"),
    botReasons: z.array(z.string().max(200)).max(10).default([]),
    campaign: campaignTouchSchema.nullish(),
  }),
  output: okResult,
  handler: async (input, ctx) => {
    const referrer = referrerHost(input.referrer);
    const inserted = await ctx.tx
      .insert(analyticsEvents)
      .values({
        anonId: input.anonId,
        sessionId: input.sessionId,
        contactId: input.contactId ?? null,
        eventKey: input.eventKey ?? null,
        name: input.name,
        path: input.path,
        referrer,
        locale: input.locale,
        props: input.campaign
          ? { ...input.props, campaign: input.campaign }
          : input.props,
        visitorKind: input.visitorKind,
        botReasons: input.botReasons,
      })
      .onConflictDoNothing()
      .returning({ id: analyticsEvents.id });
    if (inserted.length > 0 && input.campaign) {
      await recordCampaignTouch(ctx.tx, {
        anonId: input.anonId,
        path: input.path,
        referrer,
        campaign: input.campaign,
      });
    }
    return { ok: true };
  },
});

export const recordWebVital = defineService({
  name: "analytics.recordWebVital",
  summary: "Record one consented Core Web Vital for a rendered public page.",
  kind: "mutation",
  permission: "public",
  input: z.object({
    ...visitor,
    id: z.string().min(1).max(120),
    metric: z.enum(["CLS", "FCP", "INP", "LCP", "TTFB"]),
    value: z.number().finite().min(0).max(1_000_000_000),
    delta: z.number().finite().min(0).max(1_000_000_000),
    rating: z.enum(["good", "needs-improvement", "poor"]),
    navigationType: z.string().min(1).max(40),
  }),
  output: z.object({ recorded: z.boolean() }),
  handler: async (input, ctx) => {
    // A metric is accepted only when this browser/session already produced a
    // server-observed page view. This both supplies the trusted bot verdict and
    // prevents a standalone public POST becoming an arbitrary event writer.
    const [page] = await ctx.tx
      .select({
        contactId: analyticsEvents.contactId,
        visitorKind: analyticsEvents.visitorKind,
        botReasons: analyticsEvents.botReasons,
        classificationOverride: analyticsEvents.classificationOverride,
        path: analyticsEvents.path,
        locale: analyticsEvents.locale,
      })
      .from(analyticsEvents)
      .where(and(
        eq(analyticsEvents.anonId, input.anonId),
        eq(analyticsEvents.sessionId, input.sessionId),
        eq(analyticsEvents.name, "page.viewed"),
      ))
      .orderBy(desc(analyticsEvents.at))
      .limit(1);
    if (!page) return { recorded: false };

    const inserted = await ctx.tx
      .insert(analyticsEvents)
      .values({
        anonId: input.anonId,
        sessionId: input.sessionId,
        contactId: page.contactId,
        eventKey: `web-vital:${input.id}`,
        name: "web_vital.measured",
        path: page.path,
        locale: page.locale,
        visitorKind: page.visitorKind,
        botReasons: page.botReasons,
        classificationOverride: page.classificationOverride,
        props: {
          metric: input.metric,
          value: input.value,
          delta: input.delta,
          rating: input.rating,
          navigationType: input.navigationType,
        },
      })
      .onConflictDoNothing()
      .returning({ id: analyticsEvents.id });
    return { recorded: inserted.length > 0 };
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
  output: z.object({ linked: z.number().int() }),
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
  return include ? undefined : eq(effectiveVisitorKind, "human");
}

/**
 * The module's stored preference, so a screen need not be told each time.
 *
 * Read through the service layer like everything else, so a module's settings
 * are validated by the schema its own manifest declares (§11).
 */
export async function includeBotsSetting(): Promise<boolean> {
  return (await currentAnalyticsSettings()).includeBots;
}

export const overview = defineService({
  name: "analytics.overview",
  summary: "Visits, visitors and conversions over a window.",
  kind: "query",
  permission: "scoped",
  input: z.object({ days: since, includeBots }),
  output: z.object({
    days: z.number().int(),
    includeBots: z.boolean(),
    automated: countInt,
    views: countInt,
    visitors: countInt,
    sessions: countInt,
    conversions: countInt,
    identified: countInt,
  }),
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
          ne(effectiveVisitorKind, "human"),
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
  output: listed(
    row({
      path: z.string(),
      views: countInt,
      visitors: countInt,
    }),
  ),
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
  output: listed(
    row({
      referrer: z.string().nullable(),
      visitors: countInt,
    }),
  ),
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
  output: listed(
    row({
      day: z.string(),
      views: countInt,
      visitors: countInt,
    }),
  ),
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

export const webVitalsSummary = defineService({
  name: "analytics.webVitals",
  summary: "Core Web Vitals p75 and rating distribution over a window.",
  kind: "query",
  permission: "scoped",
  input: z.object({ days: since, includeBots }),
  output: listed(
    z.object({
      metric: z.string(),
      samples: z.number().int(),
      p75: z.number(),
      good: z.number().int(),
      needsImprovement: z.number().int(),
      poor: z.number().int(),
    }),
  ),
  handler: async (input, ctx) => {
    const metric = sql<string>`${analyticsEvents.props}->>'metric'`;
    const rows = await ctx.tx
      .select({
        metric,
        samples: count(),
        p75: sql<number>`percentile_cont(0.75) within group (
          order by ((${analyticsEvents.props}->>'value')::double precision)
        )`,
        good: sql<number>`count(*) filter (where ${analyticsEvents.props}->>'rating' = 'good')`,
        needsImprovement: sql<number>`count(*) filter (
          where ${analyticsEvents.props}->>'rating' = 'needs-improvement'
        )`,
        poor: sql<number>`count(*) filter (where ${analyticsEvents.props}->>'rating' = 'poor')`,
      })
      .from(analyticsEvents)
      .where(and(
        eq(analyticsEvents.name, "web_vital.measured"),
        gte(analyticsEvents.at, new Date(Date.now() - input.days * 86_400_000)),
        humansOnly(input.includeBots),
      ))
      .groupBy(metric)
      .orderBy(metric);
    return rows.map((row) => ({
      ...row,
      samples: Number(row.samples),
      p75: Number(row.p75),
      good: Number(row.good),
      needsImprovement: Number(row.needsImprovement),
      poor: Number(row.poor),
    }));
  },
});

export const campaignAttribution = defineService({
  name: "analytics.campaignAttribution",
  summary: "First- or last-touch campaign visitors and conversions.",
  kind: "query",
  permission: "scoped",
  input: z.object({
    days: since,
    includeBots,
    model: z.enum(["first_touch", "last_touch"]).default("first_touch"),
    limit: z.number().int().min(1).max(50).default(20),
  }),
  output: listed(
    z.object({
      source: z.string(),
      medium: z.string().nullable(),
      campaign: z.string().nullable(),
      visitors: z.number().int(),
      conversions: z.number().int(),
    }),
  ),
  handler: async (input, ctx) => {
    const first = input.model === "first_touch";
    const source = first
      ? analyticsAttributions.firstSource
      : analyticsAttributions.lastSource;
    const medium = first
      ? analyticsAttributions.firstMedium
      : analyticsAttributions.lastMedium;
    const campaign = first
      ? analyticsAttributions.firstCampaign
      : analyticsAttributions.lastCampaign;
    const touchedAt = first
      ? analyticsAttributions.firstAt
      : analyticsAttributions.lastAt;
    const human = sql`exists (
      select 1 from ${analyticsEvents} "human_event"
      where "human_event"."anon_id" = ${analyticsAttributions.anonId}
        and coalesce(
          "human_event"."classification_override",
          "human_event"."visitor_kind"
        ) = 'human'
    )`;
    const converted = sql`exists (
      select 1 from ${analyticsEvents} "conversion_event"
      where "conversion_event"."anon_id" = ${analyticsAttributions.anonId}
        and "conversion_event"."name" = 'form.submitted'
        and "conversion_event"."at" >= ${touchedAt}
    )`;
    const rows = await ctx.tx
      .select({
        source,
        medium,
        campaign,
        visitors: count(),
        conversions: sql<number>`count(*) filter (where ${converted})`,
      })
      .from(analyticsAttributions)
      .where(and(
        gte(touchedAt, new Date(Date.now() - input.days * 86_400_000)),
        input.includeBots ? undefined : human,
      ))
      .groupBy(source, medium, campaign)
      .orderBy(desc(count()))
      .limit(input.limit);
    return rows.map((row) => ({
      ...row,
      visitors: Number(row.visitors),
      conversions: Number(row.conversions),
    }));
  },
});

export const classificationCandidates = defineService({
  name: "analytics.classificationCandidates",
  summary: "Recent automated traffic an owner may correct.",
  kind: "query",
  permission: "scoped",
  input: z.object({ limit: z.number().int().min(1).max(50).default(20) }),
  output: listed(
    z.object({
      reviewId: uuid,
      visitorLabel: z.string(),
      originalKind: visitorKind,
      effectiveKind: visitorKind,
      reasons: listed(z.string()),
      lastPath: z.string(),
      lastAt: timestamp,
      views: z.number().int(),
    }),
  ),
  handler: async (input, ctx) => {
    const rows = await ctx.tx
      .select({
        id: analyticsEvents.id,
        anonId: analyticsEvents.anonId,
        originalKind: analyticsEvents.visitorKind,
        override: analyticsEvents.classificationOverride,
        reasons: analyticsEvents.botReasons,
        path: analyticsEvents.path,
        at: analyticsEvents.at,
      })
      .from(analyticsEvents)
      .where(and(
        eq(analyticsEvents.name, "page.viewed"),
        or(
          ne(analyticsEvents.visitorKind, "human"),
          isNotNull(analyticsEvents.classificationOverride),
        ),
      ))
      .orderBy(desc(analyticsEvents.at))
      .limit(500);
    const grouped = new Map<string, {
      reviewId: string;
      visitorLabel: string;
      originalKind: VisitorKind;
      effectiveKind: VisitorKind;
      reasons: Set<string>;
      lastPath: string;
      lastAt: Date;
      views: number;
    }>();
    for (const row of rows) {
      const current = grouped.get(row.anonId) ?? {
        reviewId: row.id,
        visitorLabel: createHash("sha256")
          .update(row.anonId, "utf8")
          .digest("hex")
          .slice(0, 8),
        originalKind: row.originalKind,
        effectiveKind: row.override ?? row.originalKind,
        reasons: new Set<string>(),
        lastPath: row.path,
        lastAt: row.at,
        views: 0,
      };
      current.views += 1;
      for (const reason of row.reasons) current.reasons.add(reason);
      grouped.set(row.anonId, current);
    }
    return [...grouped.values()].slice(0, input.limit).map((row) => ({
      ...row,
      reasons: [...row.reasons],
    }));
  },
});

export const correctClassification = defineService({
  name: "analytics.correctClassification",
  summary: "Override or restore the bot classification for one visitor.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({
    eventId: z.string().uuid(),
    kind: z.enum(["human", "bot", "suspected", "automatic"]),
    classificationNote: z.string().trim().max(500).default(""),
  }),
  output: z.object({
    updated: z.number().int(),
    effectiveKind: visitorKind.nullable(),
  }),
  handler: async (input, ctx) => {
    const [reviewed] = await ctx.tx
      .select({ anonId: analyticsEvents.anonId })
      .from(analyticsEvents)
      .where(eq(analyticsEvents.id, input.eventId))
      .limit(1);
    if (!reviewed) {
      throw new ServiceError("not_found", "That analytics visitor is no longer retained.");
    }
    const automatic = input.kind === "automatic";
    const updated = await ctx.tx
      .update(analyticsEvents)
      .set({
        classificationOverride: input.kind === "automatic" ? null : input.kind,
        classificationNote: automatic
          ? null
          : input.classificationNote || "Owner review.",
      })
      .where(eq(analyticsEvents.anonId, reviewed.anonId))
      .returning({ id: analyticsEvents.id });
    if (updated.length === 0) {
      throw new ServiceError("not_found", "That analytics visitor is no longer retained.");
    }
    ctx.setSubject("analyticsClassification", input.eventId);
    return { updated: updated.length, effectiveKind: automatic ? null : input.kind };
  },
});

/** Delete event history and campaign projections at the configured boundary. */
export async function pruneAnalytics(retentionDays?: number): Promise<{
  events: number;
  attributions: number;
  attributionsRebased: number;
  retentionDays: number;
}> {
  const days = z.number().int().min(30).max(730).parse(
    retentionDays ?? (await currentAnalyticsSettings()).retentionDays,
  );
  const cutoff = new Date(Date.now() - days * 86_400_000);
  const [events, attributions, attributionsRebased] = await db().transaction(async (tx) => {
    const oldEvents = await tx
      .delete(analyticsEvents)
      .where(lt(analyticsEvents.at, cutoff))
      .returning({ id: analyticsEvents.id });
    // A recent latest touch must not keep a first-touch receipt beyond the
    // configured boundary. Once the old event is gone, the latest retained
    // touch becomes the earliest fact this projection may remember.
    const rebasedAttributions = await tx
      .update(analyticsAttributions)
      .set({
        firstSource: sql`${analyticsAttributions.lastSource}`,
        firstMedium: sql`${analyticsAttributions.lastMedium}`,
        firstCampaign: sql`${analyticsAttributions.lastCampaign}`,
        firstTerm: sql`${analyticsAttributions.lastTerm}`,
        firstContent: sql`${analyticsAttributions.lastContent}`,
        firstPath: sql`${analyticsAttributions.lastPath}`,
        firstReferrer: sql`${analyticsAttributions.lastReferrer}`,
        firstAt: sql`${analyticsAttributions.lastAt}`,
      })
      .where(and(
        lt(analyticsAttributions.firstAt, cutoff),
        gte(analyticsAttributions.lastAt, cutoff),
      ))
      .returning({ anonId: analyticsAttributions.anonId });
    const oldAttributions = await tx
      .delete(analyticsAttributions)
      .where(lt(analyticsAttributions.lastAt, cutoff))
      .returning({ anonId: analyticsAttributions.anonId });
    return [
      oldEvents.length,
      oldAttributions.length,
      rebasedAttributions.length,
    ] as const;
  });
  return { events, attributions, attributionsRebased, retentionDays: days };
}

export const exportAnonymizedAnalytics = defineService({
  name: "analytics.exportAnonymized",
  summary: "Download aggregate analytics with no visitor, session or contact ids.",
  kind: "query",
  permission: "scoped",
  input: z.object({
    days: z.number().int().min(1).max(730).default(90),
    timezone: z.string().min(1).max(100).default("UTC"),
    includeBots,
  }),
  output: z.object({
    filename: z.string(),
    mime: z.string(),
    content: z.string(),
    sha256: z.string(),
  }),
  handler: async (input, ctx) => {
    const from = new Date(Date.now() - input.days * 86_400_000);
    const day = sql<string>`to_char(
      date_trunc('day', ${analyticsEvents.at} at time zone ${input.timezone}),
      'YYYY-MM-DD'
    )`;
    const pageVisitors = sql<number>`count(distinct ${analyticsEvents.anonId})
      filter (where ${analyticsEvents.name} = 'page.viewed')`;
    const effective = effectiveVisitorKind;
    const dailyRows = await ctx.tx
      .select({
        day,
        views: sql<number>`count(*) filter (where ${analyticsEvents.name} = 'page.viewed')`,
        visitors: pageVisitors,
        sessions: sql<number>`count(distinct ${analyticsEvents.sessionId})
          filter (where ${analyticsEvents.name} = 'page.viewed')`,
        conversions: sql<number>`count(*) filter (
          where ${analyticsEvents.name} = 'form.submitted'
        )`,
        automated: sql<number>`count(*) filter (
          where ${analyticsEvents.name} = 'page.viewed' and ${effective} <> 'human'
        )`,
      })
      .from(analyticsEvents)
      .where(and(
        gte(analyticsEvents.at, from),
        input.includeBots ? undefined : humansOnly(false),
      ))
      .groupBy(sql`1`)
      // A date with fewer than three visitors is omitted rather than exporting
      // a row that is effectively one person's browsing receipt.
      .having(gte(pageVisitors, 3))
      .orderBy(sql`1`);
    const daily = dailyRows.map((row) => ({
      ...row,
      views: Number(row.views),
      visitors: Number(row.visitors),
      sessions: Number(row.sessions),
      conversions: Number(row.conversions),
      automated: Number(row.automated),
    }));

    const visitors = countDistinct(analyticsEvents.anonId);
    const pages = await ctx.tx
      .select({
        path: analyticsEvents.path,
        views: count(),
        visitors,
      })
      .from(analyticsEvents)
      .where(and(
        eq(analyticsEvents.name, "page.viewed"),
        gte(analyticsEvents.at, from),
        humansOnly(input.includeBots),
      ))
      .groupBy(analyticsEvents.path)
      .having(gte(visitors, 3))
      .orderBy(desc(count()));

    const campaignVisitors = count();
    const campaignHuman = sql`exists (
      select 1 from ${analyticsEvents} "human_event"
      where "human_event"."anon_id" = ${analyticsAttributions.anonId}
        and coalesce(
          "human_event"."classification_override",
          "human_event"."visitor_kind"
        ) = 'human'
    )`;
    const campaignRows = await ctx.tx
      .select({
        source: analyticsAttributions.firstSource,
        medium: analyticsAttributions.firstMedium,
        campaign: analyticsAttributions.firstCampaign,
        visitors: campaignVisitors,
        conversions: sql<number>`count(*) filter (where exists (
          select 1 from ${analyticsEvents} "conversion_event"
          where "conversion_event"."anon_id" = ${analyticsAttributions.anonId}
            and "conversion_event"."name" = 'form.submitted'
            and "conversion_event"."at" >= ${analyticsAttributions.firstAt}
        ))`,
      })
      .from(analyticsAttributions)
      .where(and(
        gte(analyticsAttributions.firstAt, from),
        input.includeBots ? undefined : campaignHuman,
      ))
      .groupBy(
        analyticsAttributions.firstSource,
        analyticsAttributions.firstMedium,
        analyticsAttributions.firstCampaign,
      )
      .having(gte(campaignVisitors, 3))
      .orderBy(desc(campaignVisitors));
    const campaigns = campaignRows.map((row) => ({
      ...row,
      visitors: Number(row.visitors),
      conversions: Number(row.conversions),
    }));

    const metric = sql<string>`${analyticsEvents.props}->>'metric'`;
    const vitalSamples = count();
    const vitalVisitors = countDistinct(analyticsEvents.anonId);
    const vitalRows = await ctx.tx
      .select({
        metric,
        samples: vitalSamples,
        p75: sql<number>`percentile_cont(0.75) within group (
          order by ((${analyticsEvents.props}->>'value')::double precision)
        )`,
        poor: sql<number>`count(*) filter (
          where ${analyticsEvents.props}->>'rating' = 'poor'
        )`,
      })
      .from(analyticsEvents)
      .where(and(
        eq(analyticsEvents.name, "web_vital.measured"),
        gte(analyticsEvents.at, from),
        humansOnly(input.includeBots),
      ))
      .groupBy(metric)
      .having(gte(vitalVisitors, 3))
      .orderBy(metric);
    const vitals = vitalRows.map((row) => ({
      ...row,
      samples: Number(row.samples),
      p75: Number(row.p75),
      poor: Number(row.poor),
    }));

    const settings = await currentAnalyticsSettings();
    const content = JSON.stringify({
      schema: "freeholder.analytics.anonymized.v1",
      generatedAt: new Date().toISOString(),
      window: { days: input.days, timezone: input.timezone },
      privacy: {
        rowLevelIdentifiers: false,
        minimumVisitorsPerGroup: 3,
        retentionDays: settings.retentionDays,
        includesAutomatedTraffic: input.includeBots,
      },
      daily,
      pages,
      campaigns,
      webVitals: vitals,
    }, null, 2);
    return {
      filename: `freeholder-analytics-${new Date().toISOString().slice(0, 10)}.json`,
      mime: "application/json",
      content,
      sha256: createHash("sha256").update(content, "utf8").digest("hex"),
    };
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
  output: listed(analyticsEventRow),
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
  let consent: AnalyticsConsentState | null = null;
  try {
    const { cookies } = await import("next/headers");
    const jar = await cookies();
    const {
      ANALYTICS_BOOTSTRAP_COOKIE,
      ANALYTICS_CONSENT_COOKIE,
      ANON_COOKIE,
      SESSION_COOKIE_NAME,
      parseAnalyticsConsentState,
    } = await import("./visitor");
    const bootstrap = jar.get(ANALYTICS_BOOTSTRAP_COOKIE)?.value;
    anonId = jar.get(ANON_COOKIE)?.value ?? bootstrap;
    sessionId = jar.get(SESSION_COOKIE_NAME)?.value ?? bootstrap;
    consent = parseAnalyticsConsentState(
      jar.get(ANALYTICS_CONSENT_COOKIE)?.value,
    );
  } catch {
    // Outside a request. Nothing to link, and nothing to complain about.
  }

  if (!anonId || !sessionId) return;
  const settings = await currentAnalyticsSettings();
  const { analyticsCollectionAllowed } = await import("./settings");
  if (
    analyticsCollectionAllowed(settings.consentPolicy, consent)
  ) {
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
    const { recordExperimentConversion } = await import("./experiments");
    await recordExperimentConversion.call(
      { anonId, sessionId, contactId: contactId ?? undefined, kind: "form" },
      { kind: "system" },
    );
  }
}

async function convertFromEvent(
  kind: string,
  payload: unknown,
  amountMinor?: number,
  currency?: string,
): Promise<void> {
  const { contactId } = (payload ?? {}) as { contactId?: string };
  let anonId: string | undefined;
  let sessionId: string | undefined;
  try {
    const { cookies } = await import("next/headers");
    const jar = await cookies();
    const { ANON_COOKIE, SESSION_COOKIE_NAME, ANALYTICS_BOOTSTRAP_COOKIE } = await import("./visitor");
    const bootstrap = jar.get(ANALYTICS_BOOTSTRAP_COOKIE)?.value;
    anonId = jar.get(ANON_COOKIE)?.value ?? bootstrap;
    sessionId = jar.get(SESSION_COOKIE_NAME)?.value ?? bootstrap;
  } catch {
    return;
  }
  if (!anonId || !sessionId) return;
  const { recordExperimentConversion } = await import("./experiments");
  await recordExperimentConversion.call(
    {
      anonId,
      sessionId,
      contactId,
      kind,
      amountMinor,
      currency,
    },
    { kind: "system" },
  );
}

export async function onQuoteRequested(payload: unknown): Promise<void> {
  await convertFromEvent("quote", payload);
}

export async function onSiteChatStarted(payload: unknown): Promise<void> {
  await convertFromEvent("chat", payload);
}

export async function onTipIntended(payload: unknown): Promise<void> {
  const body = (payload ?? {}) as { amountMinor?: number; currency?: string };
  await convertFromEvent("tip", payload, body.amountMinor, body.currency);
}

export async function onEventRegistered(payload: unknown): Promise<void> {
  await convertFromEvent("booking", payload);
}

export async function onOrderPlaced(payload: unknown): Promise<void> {
  await convertFromEvent("order", payload);
}

export {
  experimentReport,
  recordExperimentConversion,
  recordExperimentImpressions,
} from "./experiments";
import {
  experimentReport,
  recordExperimentConversion,
  recordExperimentImpressions,
} from "./experiments";

export default [
  track,
  recordWebVital,
  identify,
  overview,
  topPages,
  topReferrers,
  dailyViews,
  webVitalsSummary,
  campaignAttribution,
  classificationCandidates,
  correctClassification,
  exportAnonymizedAnalytics,
  contactActivity,
  recordExperimentImpressions,
  recordExperimentConversion,
  experimentReport,
];
