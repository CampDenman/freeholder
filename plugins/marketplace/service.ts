// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { listed, okResult, row, timestamp, uuid } from "@/core/contract";
import { isUniqueViolation } from "@/core/db";
import { attachPluginContactColumn } from "@/core/plugins/spine";
import {
  defineOrchestratedService,
  defineService,
  getService,
  ServiceError,
} from "@/core/service";
import { marketplaceProvider } from "./adapter";
import { marketplaceChannels, marketplaceOrders } from "./schema";

attachPluginContactColumn({
  table: "marketplace_orders",
  schema: marketplaceOrders,
  label: "A marketplace order",
  scope: "plugins.marketplace",
});

const PROVIDERS = ["shopify", "etsy", "amazon", "ebay"] as const;
const SYNC_PAGE_SIZE = 50;

const channelRow = row({
  id: uuid,
  name: z.string(),
  provider: z.string(),
  status: z.string(),
  externalRef: z.string().nullable(),
  lastError: z.string().nullable(),
  lastSyncedAt: timestamp.nullable(),
  syncCursor: z.string().nullable(),
});

const orderRow = row({
  id: uuid,
  channelId: uuid,
  contactId: uuid,
  invoiceId: uuid,
  externalRef: z.string(),
  description: z.string(),
  amountMinor: z.number().int(),
  currency: z.string(),
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
    provider: z.enum(PROVIDERS),
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
  summary: "Connect a marketplace channel. Orders still become invoices.",
  kind: "mutation",
  permission: "scoped",
  writeClass: "write",
  input: z.object({
    name: z.string().min(1).max(80),
    provider: z.enum(PROVIDERS),
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
    cursor: z.string().nullable(),
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
    return {
      channelId: channel.id,
      provider: channel.provider,
      externalRef: channel.externalRef,
      cursor: channel.syncCursor,
    };
  },
});

const applySync = defineService({
  name: "marketplace.applySync",
  summary: "Stamp the last marketplace sync page.",
  kind: "mutation",
  permission: "scoped",
  external: false,
  writeClass: "write",
  input: z.object({
    channelId: z.string().uuid(),
    lastError: z.string().max(500).optional(),
    cursor: z.string().max(500).nullable().optional(),
    completed: z.boolean().optional(),
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
        .set({
          lastError: null,
          syncCursor: input.cursor ?? null,
          ...(input.completed ? { lastSyncedAt: new Date() } : {}),
        })
        .where(eq(marketplaceChannels.id, input.channelId));
    }
    return { ok: true as const };
  },
});

const findImported = defineService({
  name: "marketplace.findImported",
  summary: "Look up an already-imported marketplace order.",
  kind: "query",
  permission: "scoped",
  external: false,
  input: z.object({
    channelId: z.string().uuid(),
    externalRef: z.string().min(1).max(200),
  }),
  output: row({ id: uuid.nullable() }),
  handler: async (input, ctx) => {
    const [existing] = await ctx.tx
      .select({ id: marketplaceOrders.id })
      .from(marketplaceOrders)
      .where(
        and(
          eq(marketplaceOrders.channelId, input.channelId),
          eq(marketplaceOrders.externalRef, input.externalRef),
        ),
      )
      .limit(1);
    return { id: existing?.id ?? null };
  },
});

const recordImported = defineService({
  name: "marketplace.recordImported",
  summary: "Record a marketplace order that has already become an invoice.",
  kind: "mutation",
  permission: "scoped",
  external: false,
  writeClass: "write",
  input: z.object({
    channelId: z.string().uuid(),
    contactId: z.string().uuid(),
    invoiceId: z.string().uuid(),
    externalRef: z.string().min(1).max(200),
    description: z.string().min(1).max(1_000),
    amountMinor: z.number().int().nonnegative(),
    currency: z.string().length(3),
  }),
  output: row({ id: uuid, created: z.boolean() }),
  handler: async (input, ctx) => {
    try {
      const [created] = await ctx.tx
        .insert(marketplaceOrders)
        .values({
          channelId: input.channelId,
          contactId: input.contactId,
          invoiceId: input.invoiceId,
          externalRef: input.externalRef,
          description: input.description,
          amountMinor: input.amountMinor,
          currency: input.currency,
        })
        .returning({ id: marketplaceOrders.id });
      ctx.setSubject("marketplace_order", created!.id);
      ctx.queueEvent("marketplace.orderImported", {
        id: created!.id,
        channelId: input.channelId,
        invoiceId: input.invoiceId,
      });
      return { id: created!.id, created: true };
    } catch (error) {
      if (isUniqueViolation(error, "marketplace_orders_channel_external_idx")) {
        const [existing] = await ctx.tx
          .select({ id: marketplaceOrders.id })
          .from(marketplaceOrders)
          .where(
            and(
              eq(marketplaceOrders.channelId, input.channelId),
              eq(marketplaceOrders.externalRef, input.externalRef),
            ),
          )
          .limit(1);
        if (existing) return { id: existing.id, created: false };
      }
      throw error;
    }
  },
});

async function importProviderOrder(
  channelId: string,
  order: {
    externalRef: string;
    description: string;
    amountMinor: number;
    currency: string;
    buyerEmail: string;
    buyerName: string;
  },
): Promise<boolean> {
  const already = await findImported.call(
    { channelId, externalRef: order.externalRef },
    { kind: "system" },
  );
  if (already.id) return false;
  const resolved = (await getService("contacts.resolve").call(
    { email: order.buyerEmail, name: order.buyerName, source: "marketplace" },
    { kind: "system" },
  )) as { contact: { id: string } };
  const draft = (await getService("invoicing.createDraft").call(
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
      tax: {
        mode: "not_applicable",
        reason: "Imported marketplace order; tax was collected on the channel.",
      },
    },
    { kind: "system" },
  )) as { invoice: { id: string } };
  const recorded = await recordImported.call(
    {
      channelId,
      contactId: resolved.contact.id,
      invoiceId: draft.invoice.id,
      externalRef: order.externalRef,
      description: order.description,
      amountMinor: order.amountMinor,
      currency: order.currency,
    },
    { kind: "system" },
  );
  return recorded.created;
}

export const syncMarketplaceChannel = defineOrchestratedService({
  name: "marketplace.sync",
  summary: "Page marketplace orders onto invoices.",
  kind: "mutation",
  permission: "scoped",
  writeClass: "money",
  input: z.object({ channelId: z.string().uuid() }),
  output: row({ imported: z.number().int(), lastError: z.string().nullable() }),
  handler: async (input) => {
    const claimed = await claimSync.call(input, { kind: "system" });
    let cursor = claimed.cursor;
    let imported = 0;
    try {
      for (;;) {
        const page = await marketplaceProvider().listOrders({
          provider: claimed.provider,
          externalRef: claimed.externalRef,
          cursor,
          limit: SYNC_PAGE_SIZE,
        });
        for (const order of page.orders) {
          if (await importProviderOrder(claimed.channelId, order)) imported += 1;
        }
        const nextCursor = page.nextCursor;
        const completed = !nextCursor;
        await applySync.call(
          { channelId: claimed.channelId, cursor: nextCursor, completed },
          { kind: "system" },
        );
        if (completed || nextCursor === cursor) break;
        cursor = nextCursor;
      }
      return { imported, lastError: null };
    } catch (error) {
      const message = error instanceof Error ? error.message : "The marketplace could not list orders.";
      await applySync.call(
        { channelId: claimed.channelId, lastError: message.slice(0, 500) },
        { kind: "system" },
      );
      return { imported, lastError: message.slice(0, 500) };
    }
  },
});

export const listMarketplaceChannels = defineService({
  name: "marketplace.list",
  summary: "Configured marketplace channels.",
  kind: "query",
  permission: "scoped",
  input: z.object({}),
  output: listed(channelRow),
  handler: (_input, ctx) =>
    ctx.tx.select().from(marketplaceChannels).orderBy(desc(marketplaceChannels.createdAt)),
});

export const listMarketplaceOrders = defineService({
  name: "marketplace.listOrders",
  summary: "Marketplace orders already pulled onto invoices.",
  kind: "query",
  permission: "scoped",
  input: z.object({ channelId: z.string().uuid().optional() }),
  output: listed(orderRow),
  handler: (input, ctx) =>
    ctx.tx
      .select()
      .from(marketplaceOrders)
      .where(input.channelId ? eq(marketplaceOrders.channelId, input.channelId) : undefined)
      .orderBy(desc(marketplaceOrders.createdAt)),
});

export default [
  insertPending,
  applyConnect,
  connectMarketplaceChannel,
  claimSync,
  applySync,
  findImported,
  recordImported,
  syncMarketplaceChannel,
  listMarketplaceChannels,
  listMarketplaceOrders,
];
