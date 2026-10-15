// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
import { defineJob } from "@/core/jobs";

export const releaseDuePayouts = defineJob({
  name: "members.releaseDuePayouts",
  summary: "Move sellers' held payouts to due once the site's holding window has passed.",
  schedule: "*/15 * * * *",
  concurrency: 1,
  handler: async () => {
    const { releaseDuePayouts: release } = await import("./payouts");
    return release.call({}, { kind: "system" });
  },
});

/** C12.18: signed activities to fediverse inboxes, retried with backoff. */
export const deliverFederation = defineJob({
  name: "members.deliverFederation",
  summary: "Deliver queued ActivityPub activities to remote inboxes.",
  schedule: "* * * * *",
  concurrency: 1,
  handler: async () => {
    const { deliverFederation: deliver } = await import("./federation/core");
    return deliver();
  },
});

export default [releaseDuePayouts, deliverFederation];
