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

/** C12.36: encrypted files that were removed, or uploaded and never sent. */
export const purgeSealedBlobs = defineJob({
  name: "members.purgeSealedBlobs",
  summary: "Delete removed and abandoned end-to-end encrypted files from storage.",
  schedule: "*/10 * * * *",
  concurrency: 1,
  handler: async () => {
    const { purgeSealedBlobs: purge } = await import("./sealed-blobs");
    return purge();
  },
});

/** C12.26–C12.27: due payouts and reversals through the site's payout provider. */
export const sendProviderPayouts = defineJob({
  name: "members.sendProviderPayouts",
  summary: "Pay due seller payouts, and reverse refunded ones, through the payout provider.",
  schedule: "*/5 * * * *",
  concurrency: 1,
  handler: async () => {
    const { sendProviderPayouts: send } = await import("./provider-payouts");
    return send();
  },
});

export default [releaseDuePayouts, deliverFederation, purgeSealedBlobs, sendProviderPayouts];
