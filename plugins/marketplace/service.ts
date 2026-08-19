// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
import { desc } from "drizzle-orm";
import { z } from "zod";
import { listed, row, uuid } from "@/core/contract";
import { defineService } from "@/core/service";
import { marketplaceChannels } from "./schema";

const channelRow = row({
  id: uuid,
  name: z.string(),
  provider: z.string(),
  status: z.string(),
});

export const connectMarketplaceChannel = defineService({
  name: "marketplace.connect",
  summary: "Connect a marketplace channel sync seam. Orders still become invoices.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({
    name: z.string().min(1).max(80),
    provider: z.enum(["shopify", "etsy", "amazon", "ebay"]),
  }),
  output: channelRow,
  handler: async (input, ctx) => {
    const [row] = await ctx.tx
      .insert(marketplaceChannels)
      .values({ ...input, status: "connected" })
      .returning();
    ctx.setSubject("marketplace_channel", row!.id);
    ctx.queueEvent("marketplace.connected", { id: row!.id, provider: row!.provider });
    return row!;
  },
});

export const listMarketplaceChannels = defineService({
  name: "marketplace.list",
  summary: "Configured marketplace channel seams.",
  kind: "query",
  permission: "scoped",
  input: z.object({}),
  output: listed(channelRow),
  handler: (_input, ctx) =>
    ctx.tx.select().from(marketplaceChannels).orderBy(desc(marketplaceChannels.createdAt)),
});

export default [connectMarketplaceChannel, listMarketplaceChannels];
