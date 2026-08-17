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

export default [expireReservations, abandonStaleCarts, recoverAbandonedCarts];
