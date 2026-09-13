// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
import { defineJob } from "@/core/jobs";
import {
  connectMarketplaceChannel,
  listMarketplaceChannels,
  syncMarketplaceChannel,
} from "./service";

export const retryFailedMarketplace = defineJob({
  name: "marketplace.retryFailed",
  summary: "Retry failed marketplace handshakes and channel syncs in place.",
  schedule: "13,43 * * * *",
  handler: async () => {
    const actor = { kind: "system" as const };
    const channels = await listMarketplaceChannels.call({}, actor);
    for (const channel of channels) {
      if (channel.status === "failed" || channel.status === "pending") {
        await connectMarketplaceChannel.call(
          {
            channelId: channel.id,
            name: channel.name,
            provider: channel.provider as "shopify" | "etsy" | "amazon" | "ebay",
          },
          actor,
        );
        continue;
      }
      if (channel.status === "syncing" || (channel.status === "connected" && channel.lastError)) {
        await syncMarketplaceChannel.call({ channelId: channel.id }, actor);
      }
    }
  },
});

export default [retryFailedMarketplace];
