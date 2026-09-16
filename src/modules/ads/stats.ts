// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Daily rollup of first-party ad events (MASTER.md §4.16, C9.19).
import { and, eq, gte, inArray, lt, sql } from "drizzle-orm";
import type { Tx } from "@/core/service";
import { analyticsEvents } from "@/modules/analytics/schema";
import { adCampaigns, adLineItems, adStats } from "./schema";

export function utcDay(at: Date): string {
  return at.toISOString().slice(0, 10);
}

export function spendCents(
  pricing: "cpm" | "cpc" | "flat" | "house",
  rateCents: number,
  impressions: number,
  clicks: number,
): number {
  if (pricing === "cpm") return Math.round((rateCents * impressions) / 1000);
  if (pricing === "cpc") return rateCents * clicks;
  return 0;
}

export async function bumpStat(
  tx: Tx,
  grain: {
    lineItemId: string;
    creativeId: string;
    slotId: string;
    day: string;
  },
  patch: {
    impressions?: number;
    viewableImpressions?: number;
    clicks?: number;
    uniqueDelta?: number;
    spendCents?: number;
  },
): Promise<void> {
  await tx
    .insert(adStats)
    .values({
      lineItemId: grain.lineItemId,
      creativeId: grain.creativeId,
      slotId: grain.slotId,
      day: grain.day,
      impressions: patch.impressions ?? 0,
      viewableImpressions: patch.viewableImpressions ?? 0,
      uniques: patch.uniqueDelta ?? 0,
      clicks: patch.clicks ?? 0,
      spendCents: patch.spendCents ?? 0,
    })
    .onConflictDoUpdate({
      target: [adStats.lineItemId, adStats.creativeId, adStats.slotId, adStats.day],
      set: {
        impressions: sql`${adStats.impressions} + ${patch.impressions ?? 0}`,
        viewableImpressions: sql`${adStats.viewableImpressions} + ${patch.viewableImpressions ?? 0}`,
        uniques: sql`${adStats.uniques} + ${patch.uniqueDelta ?? 0}`,
        clicks: sql`${adStats.clicks} + ${patch.clicks ?? 0}`,
        spendCents: sql`${adStats.spendCents} + ${patch.spendCents ?? 0}`,
        updatedAt: new Date(),
      },
    });
}

export async function deliveryByLineItem(
  tx: Tx,
  lineItemIds: string[],
): Promise<Map<string, { impressions: number; clicks: number; spendCents: number }>> {
  const out = new Map<string, { impressions: number; clicks: number; spendCents: number }>();
  if (lineItemIds.length === 0) return out;
  const rows = await tx
    .select({
      lineItemId: adStats.lineItemId,
      impressions: sql<number>`coalesce(sum(${adStats.impressions}), 0)`,
      clicks: sql<number>`coalesce(sum(${adStats.clicks}), 0)`,
      spendCents: sql<number>`coalesce(sum(${adStats.spendCents}), 0)`,
    })
    .from(adStats)
    .where(inArray(adStats.lineItemId, lineItemIds))
    .groupBy(adStats.lineItemId);
  for (const row of rows) {
    out.set(row.lineItemId, {
      impressions: Number(row.impressions),
      clicks: Number(row.clicks),
      spendCents: Number(row.spendCents),
    });
  }
  return out;
}

export async function visitorImpressions(
  tx: Tx,
  anonId: string,
  lineItemIds: string[],
  since: Date,
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (lineItemIds.length === 0) return out;
  const rows = await tx
    .select({
      lineItemId: sql<string>`${analyticsEvents.props}->>'lineItemId'`,
      count: sql<number>`count(*)`,
    })
    .from(analyticsEvents)
    .where(
      and(
        eq(analyticsEvents.name, "ad.impression"),
        eq(analyticsEvents.anonId, anonId),
        gte(analyticsEvents.at, since),
      ),
    )
    .groupBy(sql`${analyticsEvents.props}->>'lineItemId'`);
  const wanted = new Set(lineItemIds);
  for (const row of rows) {
    if (row.lineItemId && wanted.has(row.lineItemId)) {
      out.set(row.lineItemId, Number(row.count));
    }
  }
  return out;
}

export async function rebuildDay(tx: Tx, day: string): Promise<number> {
  const start = new Date(`${day}T00:00:00.000Z`);
  const end = new Date(`${day}T00:00:00.000Z`);
  end.setUTCDate(end.getUTCDate() + 1);

  const events = await tx
    .select({
      name: analyticsEvents.name,
      anonId: analyticsEvents.anonId,
      props: analyticsEvents.props,
    })
    .from(analyticsEvents)
    .where(
      and(
        inArray(analyticsEvents.name, ["ad.impression", "ad.viewable", "ad.click"]),
        gte(analyticsEvents.at, start),
        lt(analyticsEvents.at, end),
      ),
    );

  type Grain = {
    impressions: number;
    viewable: number;
    clicks: number;
    anons: Set<string>;
  };
  const grains = new Map<string, Grain>();
  const keyOf = (lineItemId: string, creativeId: string, slotId: string) =>
    `${lineItemId}|${creativeId}|${slotId}`;

  for (const event of events) {
    const props = (event.props ?? {}) as Record<string, unknown>;
    const lineItemId = typeof props.lineItemId === "string" ? props.lineItemId : null;
    const creativeId = typeof props.creativeId === "string" ? props.creativeId : null;
    const slotId = typeof props.slotId === "string" ? props.slotId : null;
    if (!lineItemId || !creativeId || !slotId) continue;
    const key = keyOf(lineItemId, creativeId, slotId);
    const grain = grains.get(key) ?? {
      impressions: 0,
      viewable: 0,
      clicks: 0,
      anons: new Set<string>(),
    };
    if (event.name === "ad.impression") {
      grain.impressions += 1;
      grain.anons.add(event.anonId);
    } else if (event.name === "ad.viewable") grain.viewable += 1;
    else if (event.name === "ad.click") grain.clicks += 1;
    grains.set(key, grain);
  }

  await tx.delete(adStats).where(eq(adStats.day, day));
  if (grains.size === 0) return 0;

  const lineItemIds = [...new Set([...grains.keys()].map((key) => key.split("|")[0]!))];
  const campaigns = await tx
    .select({
      lineItemId: adLineItems.id,
      pricing: adCampaigns.pricing,
      rateCents: adCampaigns.rateCents,
    })
    .from(adLineItems)
    .innerJoin(adCampaigns, eq(adCampaigns.id, adLineItems.campaignId))
    .where(inArray(adLineItems.id, lineItemIds));
  const rate = new Map(campaigns.map((row) => [row.lineItemId, row]));

  let written = 0;
  for (const [key, grain] of grains) {
    const [lineItemId, creativeId, slotId] = key.split("|") as [string, string, string];
    const campaign = rate.get(lineItemId);
    await tx.insert(adStats).values({
      lineItemId,
      creativeId,
      slotId,
      day,
      impressions: grain.impressions,
      viewableImpressions: grain.viewable,
      uniques: grain.anons.size,
      clicks: grain.clicks,
      spendCents: campaign
        ? spendCents(campaign.pricing, campaign.rateCents, grain.impressions, grain.clicks)
        : 0,
    });
    written += 1;
  }
  return written;
}
