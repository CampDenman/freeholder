// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Catalog background work (C5.16, C5.20).
import { defineJob } from "@/core/jobs";

export const expireReservations = defineJob({
  name: "catalog.expireReservations",
  summary: "Release stock holds whose expiry has passed.",
  schedule: "*/5 * * * *",
  concurrency: 1,
  handler: async () => {
    const { expireReservations: expire } = await import("./inventory");
    return expire.call({}, { kind: "system" });
  },
});

export const abandonStaleCarts = defineJob({
  name: "catalog.abandonStaleCarts",
  summary: "Mark inactive open carts abandoned and release their stock holds.",
  schedule: "17 * * * *",
  concurrency: 1,
  handler: async () => {
    const { abandonStaleCarts: abandon } = await import("./cart");
    return abandon.call({}, { kind: "system" });
  },
});

export const recoverAbandonedCarts = defineJob({
  name: "catalog.recoverAbandonedCarts",
  summary: "Send one recovery coupon and notice for each abandoned contact cart.",
  schedule: "47 * * * *",
  concurrency: 1,
  handler: async () => {
    const { recoverAbandonedCarts: recover } = await import("./promotions");
    return recover.call({}, { kind: "system" });
  },
});

/**
 * Segment collections follow an audience, so their membership is a derived
 * answer with a freshness date on it, not a fact that keeps itself true.
 * Hourly is the same cadence as the cart sweeps: often enough that a
 * collection a customer sees is near-current, bounded enough that a job run
 * is one pass over the segment collections that exist.
 */
export const recomputeSegmentCollections = defineJob({
  name: "catalog.recomputeSegmentCollections",
  summary: "Re-derive every segment-driven collection's membership from its segment.",
  schedule: "23 * * * *",
  concurrency: 1,
  handler: async () => {
    const { db } = await import("@/core/db");
    const { and, eq, isNull } = await import("drizzle-orm");
    const { collections } = await import("./schema");
    const { recomputeCollectionMembership } = await import("./collections");
    const rows = await db()
      .select({ id: collections.id })
      .from(collections)
      .where(and(eq(collections.ruleType, "segment"), isNull(collections.trashedAt)));
    let recomputed = 0;
    for (const row of rows) {
      await recomputeCollectionMembership.call({ id: row.id }, { kind: "system" });
      recomputed += 1;
    }
    return { recomputed };
  },
});

export default [
  expireReservations,
  abandonStaleCarts,
  recoverAbandonedCarts,
  recomputeSegmentCollections,
];
