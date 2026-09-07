// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import { listed, okResult, row, timestamp, uuid } from "@/core/contract";
import { isUniqueViolation } from "@/core/db";
import {
  defineOrchestratedService,
  defineService,
  getService,
  ServiceError,
} from "@/core/service";
import { marketplaceProvider } from "./adapter";
import { marketplaceChannels } from "./schema";

const channelRow = row({
  id: uuid,
  name: z.string(),
  provider: z.string(),
  status: z.string(),
  externalRef: z.string().nullable(),
  lastError: z.string().nullable(),
  lastSyncedAt: timestamp.nullable(),
});

const insertPending = defineService({
  name: "marketplace.claimConnect",
  summary: "Record a marketplace channel before the provider handshake.",
  kind: "mutation",
  permission: "scoped",
  external: false,
  writeClass: "write",
  input: z.object({
    name: z.string().min(1).max(80),
    provider: z.enum(["shopify", "etsy", "amazon", "ebay"]),
    channelId: z.string().uuid().optional(),
  }),
  output: row({ channelId: uuid, name: z.string(), provider: z.string() }),
  handler: async (input, ctx) => {
    if (input.channelId) {
      const [existing] = await ctx.tx
        .select()
        .from(marketplaceChannels)
        .where(eq(marketplaceChannels.id, input.channelId))
        .limit(1);
      if (!existing) throw new ServiceError("not_found", "No such marketplace channel.");
      if (existing.status === "connected") {
        throw new ServiceError("conflict", "That channel is already connected.");
      }
      await ctx.tx
        .update(marketplaceChannels)
        .set({ status: "pending", lastError: null, name: input.name })
        .where(eq(marketplaceChannels.id, existing.id));
      return { channelId: existing.id, name: input.name, provider: existing.provider };
    }
    try {
      const [created] = await ctx.tx
        .insert(marketplaceChannels)
        .values({ name: input.name, provider: input.provider, status: "pending" })
        .returning();
      ctx.setSubject("marketplace_channel", created!.id);
      ctx.queueEvent("marketplace.channelAdded", { id: created!.id, provider: created!.provider });
      return { channelId: created!.id, name: created!.name, provider: created!.provider };
    } catch (error) {
      if (isUniqueViolation(error, "marketplace_channels_provider_idx")) {
        throw new ServiceError("conflict", "That marketplace is already connected on this instance.");
      }
      throw error;
    }
  },
});

const applyConnect = defineService({
  name: "marketplace.applyConnect",
  summary: "Record the marketplace handshake outcome.",
  kind: "mutation",
  permission: "scoped",
  external: false,
  writeClass: "write",
  input: z.object({
    channelId: z.string().uuid(),
    externalRef: z.string().max(200).optional(),
    lastError: z.string().max(500).optional(),
  }),
  output: okResult,
  handler: async (input, ctx) => {
    if (input.externalRef) {
      await ctx.tx
        .update(marketplaceChannels)
        .set({ status: "connected", externalRef: input.externalRef, lastError: null })
        .where(eq(marketplaceChannels.id, input.channelId));
    } else {
      await ctx.tx
        .update(marketplaceChannels)
        .set({
          status: "failed",
          lastError: input.lastError ?? "The marketplace refused that connection.",
        })
        .where(eq(marketplaceChannels.id, input.channelId));
    }
    return { ok: true as const };
  },
});

export const connectMarketplaceChannel = defineOrchestratedService({
  name: "marketplace.connect",
  summary: "Connect a marketplace channel sync seam. Orders still become invoices.",
  kind: "mutation",
  permission: "scoped",
  writeClass: "write",
  input: z.object({
    name: z.string().min(1).max(80),
    provider: z.enum(["shopify", "etsy", "amazon", "ebay"]),
    channelId: z.string().uuid().optional(),
  }),
  output: channelRow,
  handler: async (input) => {
    const claimed = await insertPending.call(input, { kind: "system" });
    try {
      const result = await marketplaceProvider().connect({
        name: claimed.name,
        provider: claimed.provider,
      });
      await applyConnect.call(
        { channelId: claimed.channelId, externalRef: result.externalRef },
        { kind: "system" },
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "The marketplace refused that connection.";
      await applyConnect.call(
        { channelId: claimed.channelId, lastError: message.slice(0, 500) },
        { kind: "system" },
      );
    }
    const found = (await listMarketplaceChannels.call({}, { kind: "system" })).find(
      (row) => row.id === claimed.channelId,
    );
    if (!found) throw new ServiceError("not_found", "No such marketplace channel.");
    return found;
  },
});

const claimSync = defineService({
  name: "marketplace.claimSync",
  summary: "Read a connected channel before pulling orders.",
  kind: "query",
  permission: "scoped",
  external: false,
  input: z.object({ channelId: z.string().uuid() }),
  output: row({
    channelId: uuid,
    provider: z.string(),
    externalRef: z.string(),
  }),
  handler: async (input, ctx) => {
    const [channel] = await ctx.tx
      .select()
      .from(marketplaceChannels)
      .where(eq(marketplaceChannels.id, input.channelId))
      .limit(1);
    if (!channel) throw new ServiceError("not_found", "No such marketplace channel.");
    if (channel.status !== "connected" || !channel.externalRef) {
      throw new ServiceError("conflict", "Connect that channel before syncing orders.");
    }
    return { channelId: channel.id, provider: channel.provider, externalRef: channel.externalRef };
  },
});

const applySync = defineService({
  name: "marketplace.applySync",
  summary: "Stamp the last successful marketplace sync.",
  kind: "mutation",
  permission: "scoped",
  external: false,
  writeClass: "write",
  input: z.object({
    channelId: z.string().uuid(),
    lastError: z.string().max(500).optional(),
  }),
  output: okResult,
  handler: async (input, ctx) => {
    if (input.lastError) {
      await ctx.tx
        .update(marketplaceChannels)
        .set({ lastError: input.lastError })
        .where(eq(marketplaceChannels.id, input.channelId));
    } else {
      await ctx.tx
        .update(marketplaceChannels)
        .set({ lastError: null, lastSyncedAt: new Date() })
        .where(eq(marketplaceChannels.id, input.channelId));
    }
    return { ok: true as const };
  },
});

export const syncMarketplaceChannel = defineOrchestratedService({
  name: "marketplace.sync",
  summary: "Pull marketplace orders onto invoices.",
  kind: "mutation",
  permission: "scoped",
  writeClass: "money",
  input: z.object({ channelId: z.string().uuid() }),
  output: row({ imported: z.number().int(), lastError: z.string().nullable() }),
  handler: async (input) => {
    const claimed = await claimSync.call(input, { kind: "system" });
    try {
      const orders = await marketplaceProvider().listOrders({
        provider: claimed.provider,
        externalRef: claimed.externalRef,
      });
      for (const order of orders) {
        const resolved = (await getService("contacts.resolve").call(
          { email: order.buyerEmail, name: order.buyerName, source: "marketplace" },
          { kind: "system" },
        )) as { contact: { id: string } };
        await getService("invoicing.createDraft").call(
          {
            contactId: resolved.contact.id,
            currency: order.currency,
            sourceType: "order",
            sourceId: order.externalRef,
            idempotencyKey: `marketplace:${order.externalRef}`,
            lines: [
              {
                description: order.description,
                quantityMicros: 1_000_000,
                unitAmountMinor: order.amountMinor,
              },
            ],
            tax: { mode: "not_applicable", reason: "Imported marketplace order; tax was collected on the channel." },
          },
          { kind: "system" },
        );
      }
      await applySync.call({ channelId: claimed.channelId }, { kind: "system" });
      return { imported: orders.length, lastError: null };
    } catch (error) {
      const message = error instanceof Error ? error.message : "The marketplace could not list orders.";
      await applySync.call(
        { channelId: claimed.channelId, lastError: message.slice(0, 500) },
        { kind: "system" },
      );
      return { imported: 0, lastError: message.slice(0, 500) };
    }
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

export default [
  insertPending,
  applyConnect,
  connectMarketplaceChannel,
  claimSync,
  applySync,
  syncMarketplaceChannel,
  listMarketplaceChannels,
];
