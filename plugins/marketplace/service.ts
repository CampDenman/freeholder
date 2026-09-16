// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
import { randomUUID } from "node:crypto";
import { and, desc, eq, gt, isNull, lt, or } from "drizzle-orm";
import { z } from "zod";
import { registerSearchSource, matchesIlike } from "@/core/search/registry";
import { listed, okResult, row, timestamp, uuid } from "@/core/contract";
import { env } from "@/core/env";
import { isUniqueViolation } from "@/core/db";
import { invoices } from "@/modules/invoicing/schema";
import { attachPluginContactColumn } from "@/core/plugins/spine";
import {
  defineOrchestratedService,
  defineService,
  getService,
  ServiceError,
  type ServiceContext,
} from "@/core/service";
import { marketplaceProvider } from "./adapter";
import { marketplaceChannels, marketplaceOrders, marketplaceRefunds } from "./schema";

attachPluginContactColumn({
  table: "marketplace_orders",
  schema: marketplaceOrders,
  label: "A marketplace order",
  scope: "plugins.marketplace",
});

const PROVIDERS = ["shopify", "etsy", "amazon", "ebay"] as const;
const SYNC_PAGE_SIZE = 50;
const MAX_SYNC_PAGES = 500;
const SYNC_LEASE_MS = 10 * 60 * 1000;

function invoiceIdentity(channelId: string, externalRef: string): string {
  return `marketplace:${channelId}:${externalRef}`;
}

function refundIdentity(channelId: string, externalRef: string): string {
  return `marketplace-refund:${channelId}:${externalRef}`;
}

const channelRow = row({
  id: uuid,
  name: z.string(),
  provider: z.string(),
  status: z.string(),
  externalRef: z.string().nullable(),
  lastError: z.string().nullable(),
  lastSyncedAt: timestamp.nullable(),
  syncCursor: z.string().nullable(),
  syncLeaseExpiresAt: timestamp.nullable(),
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

const refundRow = row({
  id: uuid,
  channelId: uuid,
  orderExternalRef: z.string(),
  externalRef: z.string(),
  invoiceId: uuid.nullable(),
  creditNoteId: uuid.nullable(),
  amountMinor: z.number().int(),
  currency: z.string(),
  status: z.string(),
  lastError: z.string().nullable(),
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
  output: row({ channelId: uuid, name: z.string(), provider: z.string(), leaseToken: uuid }),
  handler: async (input, ctx) => {
    const leaseToken = randomUUID();
    const leaseExpiresAt = new Date(Date.now() + SYNC_LEASE_MS);
    if (input.channelId) {
      const [existing] = await ctx.tx
        .select()
        .from(marketplaceChannels)
        .where(eq(marketplaceChannels.id, input.channelId))
        .limit(1).for("update");
      if (!existing) throw new ServiceError("not_found", "No such marketplace channel.");
      if (["connected", "syncing"].includes(existing.status) || (existing.status === "pending" && existing.syncLeaseExpiresAt && existing.syncLeaseExpiresAt > new Date())) {
        throw new ServiceError("conflict", "That channel is already connected or has active provider work.");
      }
      await ctx.tx
        .update(marketplaceChannels)
        .set({ status: "pending", lastError: null, name: input.name, syncLeaseToken: leaseToken, syncLeaseExpiresAt: leaseExpiresAt })
        .where(eq(marketplaceChannels.id, existing.id));
      return { channelId: existing.id, name: input.name, provider: existing.provider, leaseToken };
    }
    try {
      const [created] = await ctx.tx
        .insert(marketplaceChannels)
        .values({ name: input.name, provider: input.provider, status: "pending", syncLeaseToken: leaseToken, syncLeaseExpiresAt: leaseExpiresAt })
        .returning();
      ctx.setSubject("marketplace_channel", created!.id);
      ctx.queueEvent("marketplace.channelAdded", { id: created!.id, provider: created!.provider });
      return { channelId: created!.id, name: created!.name, provider: created!.provider, leaseToken };
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
    leaseToken: z.string().uuid(),
    externalRef: z.string().max(200).optional(),
    lastError: z.string().max(500).optional(),
  }),
  output: okResult,
  handler: async (input, ctx) => {
    const [channel] = await ctx.tx.select().from(marketplaceChannels).where(eq(marketplaceChannels.id, input.channelId)).limit(1).for("update");
    if (!channel || channel.status !== "pending" || channel.syncLeaseToken !== input.leaseToken || !channel.syncLeaseExpiresAt || channel.syncLeaseExpiresAt <= new Date()) {
      throw new ServiceError("conflict", "That connection attempt no longer owns the channel.");
    }
    if (input.externalRef && channel.externalRef && input.externalRef !== channel.externalRef) {
      throw new ServiceError("conflict", "That channel belongs to a different merchant account.");
    }
    if (input.externalRef) {
      await ctx.tx
        .update(marketplaceChannels)
        .set({ status: "connected", externalRef: input.externalRef, lastError: null, syncLeaseToken: null, syncLeaseExpiresAt: null })
        .where(eq(marketplaceChannels.id, input.channelId));
    } else {
      await ctx.tx
        .update(marketplaceChannels)
        .set({
          status: "failed", syncLeaseToken: null, syncLeaseExpiresAt: null,
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
        { channelId: claimed.channelId, leaseToken: claimed.leaseToken, externalRef: result.externalRef },
        { kind: "system" },
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "The marketplace refused that connection.";
      await applyConnect.call(
        { channelId: claimed.channelId, leaseToken: claimed.leaseToken, lastError: message.slice(0, 500) },
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

const syncClaim = z.object({ channelId: z.string().uuid(), leaseToken: z.string().uuid() });

async function requireSyncLease(input: z.infer<typeof syncClaim>, ctx: ServiceContext) {
  const [channel] = await ctx.tx.select({ id: marketplaceChannels.id }).from(marketplaceChannels)
    .where(and(eq(marketplaceChannels.id, input.channelId),
      eq(marketplaceChannels.status, "syncing"), eq(marketplaceChannels.syncLeaseToken, input.leaseToken),
      gt(marketplaceChannels.syncLeaseExpiresAt, new Date())))
    .limit(1).for("update");
  if (!channel) throw new ServiceError("conflict", "That marketplace sync no longer owns its lease.");
}

const claimSync = defineService({
  name: "marketplace.claimSync",
  summary: "Exclusively lease a connected channel, or recover an expired sync.",
  kind: "mutation", permission: "scoped", external: false, writeClass: "write",
  input: z.object({ channelId: z.string().uuid() }),
  output: row({ channelId: uuid, provider: z.string(), externalRef: z.string(), cursor: z.string().nullable(), leaseToken: uuid }),
  handler: async (input, ctx) => {
    const now = new Date();
    const leaseToken = randomUUID();
    const [locked] = await ctx.tx.update(marketplaceChannels)
      .set({ status: "syncing", lastError: null, syncLeaseToken: leaseToken,
        syncLeaseExpiresAt: new Date(now.getTime() + SYNC_LEASE_MS) })
      .where(and(eq(marketplaceChannels.id, input.channelId), or(
        eq(marketplaceChannels.status, "connected"),
        and(eq(marketplaceChannels.status, "syncing"), or(
          isNull(marketplaceChannels.syncLeaseExpiresAt), lt(marketplaceChannels.syncLeaseExpiresAt, now))))))
      .returning();
    if (locked?.externalRef) return { channelId: locked.id, provider: locked.provider,
      externalRef: locked.externalRef, cursor: locked.syncCursor, leaseToken };
    throw new ServiceError("conflict", "Connect that channel or wait for its active sync to finish.");
  },
});

const applySync = defineService({
  name: "marketplace.applySync",
  summary: "Renew or finish the current marketplace sync lease and checkpoint.",
  kind: "mutation", permission: "scoped", external: false, writeClass: "write",
  input: syncClaim.extend({ lastError: z.string().max(500).optional(), cursor: z.string().max(500).nullable().optional(), completed: z.boolean().optional() }),
  output: okResult,
  handler: async (input, ctx) => {
    await requireSyncLease(input, ctx);
    const finished = Boolean(input.lastError || input.completed);
    await ctx.tx.update(marketplaceChannels).set({
      status: finished ? "connected" : "syncing", lastError: input.lastError ?? null,
      syncLeaseToken: finished ? null : input.leaseToken,
      syncLeaseExpiresAt: finished ? null : new Date(Date.now() + SYNC_LEASE_MS),
      ...(!input.lastError ? { syncCursor: input.cursor ?? null } : {}),
      ...(input.completed ? { lastSyncedAt: new Date() } : {}),
    }).where(eq(marketplaceChannels.id, input.channelId));
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

const importProviderOrder = defineService({
  name: "marketplace.importProviderOrder",
  summary: "Import one leased channel order atomically onto the contact and invoice spine.",
  kind: "mutation", permission: "system", writeClass: "money",
  input: syncClaim.extend({ order: z.object({ externalRef: z.string().min(1).max(200),
    description: z.string().min(1).max(1000), amountMinor: z.number().int().nonnegative(),
    currency: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/), buyerEmail: z.email(), buyerName: z.string().min(1).max(200) }) }),
  output: z.boolean(),
  handler: async ({ channelId, leaseToken, order }, ctx) => {
    await requireSyncLease({ channelId, leaseToken }, ctx);
    const already = await ctx.call(findImported,
      { channelId, externalRef: order.externalRef },
    );
    if (already.id) return false;
    const resolved = (await ctx.callAsSystem(getService("contacts.resolve"),
      { email: order.buyerEmail, name: order.buyerName, source: "marketplace" },
    )) as { contact: { id: string } };
    const identity = invoiceIdentity(channelId, order.externalRef);
    const draft = (await ctx.callAsSystem(getService("invoicing.createDraft"),
      {
        contactId: resolved.contact.id,
        currency: order.currency,
        sourceType: "order",
        sourceId: identity,
        idempotencyKey: identity,
        lines: [
          {
            description: order.description,
            quantityMicros: 1_000_000,
            unitAmountMinor: order.amountMinor,
          },
        ],
        tax: {
          mode: "not_applicable",
          reason: "Imported gross marketplace amount; review channel tax details before issuing.",
        },
      },
    )) as { invoice: { id: string } };
    const recorded = await ctx.call(recordImported,
      {
        channelId,
        contactId: resolved.contact.id,
        invoiceId: draft.invoice.id,
        externalRef: order.externalRef,
        description: order.description,
        amountMinor: order.amountMinor,
        currency: order.currency,
      },
    );
    return recorded.created;
  },
});

export const syncMarketplaceChannel = defineOrchestratedService({
  name: "marketplace.sync",
  summary: "Page marketplace orders onto invoices, then reconcile their refunds.",
  kind: "mutation",
  permission: "scoped",
  writeClass: "money",
  input: z.object({ channelId: z.string().uuid() }),
  output: row({ imported: z.number().int(), refundsReconciled: z.number().int(), lastError: z.string().nullable() }),
  handler: async (input) => {
    const claimed = await claimSync.call(input, { kind: "system" });
    let cursor = claimed.cursor;
    let imported = 0;
    let refundsReconciled = 0;
    let pages = 0;
    try {
      // Orders first: every page checkpoints the cursor, and a refund is only
      // reconciled after its order exists here, so re-syncs converge.
      for (;;) {
        pages += 1;
        if (pages > MAX_SYNC_PAGES) {
          throw new Error("The marketplace returned too many order pages.");
        }
        const page = await marketplaceProvider().listOrders({
          provider: claimed.provider,
          externalRef: claimed.externalRef,
          cursor,
          limit: SYNC_PAGE_SIZE,
        });
        for (const order of page.orders) {
          if (await importProviderOrder.call({ channelId: claimed.channelId, leaseToken: claimed.leaseToken, order }, { kind: "system" })) imported += 1;
        }
        const nextCursor = page.nextCursor;
        if (nextCursor && nextCursor === cursor) throw new Error("The marketplace repeated its sync cursor.");
        await applySync.call(
          { channelId: claimed.channelId, leaseToken: claimed.leaseToken, cursor: nextCursor, completed: false },
          { kind: "system" },
        );
        if (!nextCursor) break;
        cursor = nextCursor;
      }
      // Refunds ride the same lease. The pass starts from the beginning each
      // sync and skips already-reconciled rows, so a crash simply re-runs it.
      let refundCursor: string | null = null;
      let refundPages = 0;
      for (;;) {
        refundPages += 1;
        if (refundPages > MAX_SYNC_PAGES) {
          throw new Error("The marketplace returned too many refund pages.");
        }
        const page = await marketplaceProvider().listRefunds({
          provider: claimed.provider,
          externalRef: claimed.externalRef,
          cursor: refundCursor,
          limit: SYNC_PAGE_SIZE,
        });
        for (const refund of page.refunds) {
          if (await reconcileRefund.call({ channelId: claimed.channelId, leaseToken: claimed.leaseToken, refund }, { kind: "system" })) refundsReconciled += 1;
        }
        const nextCursor = page.nextCursor;
        if (nextCursor && nextCursor === refundCursor) throw new Error("The marketplace repeated its refund cursor.");
        if (!nextCursor) break;
        refundCursor = nextCursor;
      }
      await applySync.call(
        { channelId: claimed.channelId, leaseToken: claimed.leaseToken, cursor: null, completed: true },
        { kind: "system" },
      );
      return { imported, refundsReconciled, lastError: null };
    } catch (error) {
      const message = error instanceof Error ? error.message : "The marketplace could not list orders.";
      await applySync.call(
        { channelId: claimed.channelId, leaseToken: claimed.leaseToken, lastError: message.slice(0, 500) },
        { kind: "system" },
      );
      return { imported, refundsReconciled, lastError: message.slice(0, 500) };
    }
  },
});

const refundInput = z.object({
  channelId: z.string().uuid(),
  leaseToken: z.string().uuid(),
  refund: z.object({
    externalRef: z.string().min(1).max(200),
    orderExternalRef: z.string().min(1).max(200),
    amountMinor: z.number().int().positive(),
    currency: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/),
  }),
});

export const reconcileRefund = defineService({
  name: "marketplace.reconcileRefund",
  summary: "Reflect one provider refund as an idempotent issued credit note on the imported invoice.",
  kind: "mutation",
  permission: "system",
  writeClass: "money",
  input: refundInput,
  output: z.boolean(),
  handler: async ({ channelId, leaseToken, refund }, ctx) => {
    await requireSyncLease({ channelId, leaseToken }, ctx);
    const identity = refundIdentity(channelId, refund.externalRef);
    // Keyed on the provider refund id: re-syncs return the same row and never
    // double-create the credit note.
    let [record] = await ctx.tx.insert(marketplaceRefunds).values({
      channelId,
      orderExternalRef: refund.orderExternalRef,
      externalRef: refund.externalRef,
      amountMinor: refund.amountMinor,
      currency: refund.currency,
    }).onConflictDoNothing().returning();
    if (!record) {
      [record] = await ctx.tx.select().from(marketplaceRefunds)
        .where(and(eq(marketplaceRefunds.channelId, channelId), eq(marketplaceRefunds.externalRef, refund.externalRef)))
        .limit(1).for("update");
    }
    if (!record) throw new ServiceError("not_found", "That refund is not here.");
    if (record.status === "reconciled") return false;
    const [order] = await ctx.tx.select().from(marketplaceOrders)
      .where(and(eq(marketplaceOrders.channelId, channelId), eq(marketplaceOrders.externalRef, refund.orderExternalRef)))
      .limit(1);
    if (!order) {
      // The order import runs earlier in the same sync; a refund still ahead
      // of its order waits here and retries on the next sync.
      if (record.status !== "pending_order" || record.lastError) {
        await ctx.tx.update(marketplaceRefunds).set({ status: "pending_order", lastError: null }).where(eq(marketplaceRefunds.id, record.id));
      }
      return false;
    }
    const [invoice] = await ctx.tx.select().from(invoices).where(eq(invoices.id, order.invoiceId)).limit(1);
    if (!invoice) {
      await ctx.tx.update(marketplaceRefunds).set({ status: "pending_order", lastError: "The imported order has no invoice." }).where(eq(marketplaceRefunds.id, record.id));
      return false;
    }
    if (invoice.status === "draft" || invoice.status === "void") {
      // Imported invoices are reviewable drafts. The refund stays visible and
      // reconciles once the owner issues the invoice.
      if (record.status !== "pending_invoice" || record.invoiceId !== invoice.id) {
        await ctx.tx.update(marketplaceRefunds).set({ status: "pending_invoice", invoiceId: invoice.id, lastError: null }).where(eq(marketplaceRefunds.id, record.id));
      }
      return false;
    }
    if (record.creditNoteId) {
      // The credit note exists but the row update was lost; acknowledge it.
      await ctx.tx.update(marketplaceRefunds).set({ status: "reconciled", invoiceId: invoice.id, lastError: null }).where(eq(marketplaceRefunds.id, record.id));
      ctx.queueEvent("marketplace.refundReconciled", { id: record.id, channelId, invoiceId: invoice.id, creditNoteId: record.creditNoteId });
      return true;
    }
    const reason = `Shopify refund ${refund.externalRef.split("/").pop() ?? refund.externalRef}`;
    try {
      const note = (await ctx.callAsSystem(getService("invoicing.createCreditNote"), {
        invoiceId: invoice.id,
        idempotencyKey: identity,
        reason,
        lines: [{ description: reason, quantityMicros: 1_000_000, subtotalMinor: refund.amountMinor, taxMinor: 0 }],
      })) as { id: string };
      const issued = (await ctx.callAsSystem(getService("invoicing.issueCreditNote"), { id: note.id })) as { id: string };
      await ctx.tx.update(marketplaceRefunds).set({ status: "reconciled", invoiceId: invoice.id, creditNoteId: issued.id, lastError: null }).where(eq(marketplaceRefunds.id, record.id));
      ctx.queueEvent("marketplace.refundReconciled", { id: record.id, channelId, invoiceId: invoice.id, creditNoteId: issued.id });
      ctx.setSubject("marketplace_refund", record.id);
      return true;
    } catch (error) {
      // A bounds conflict (credit notes exceeding the invoice) or a lost
      // race stays on the row for the next sync instead of failing silently.
      const message = error instanceof Error ? error.message : "The refund could not be reconciled.";
      await ctx.tx.update(marketplaceRefunds).set({ status: "pending_invoice", invoiceId: invoice.id, lastError: message.slice(0, 500) }).where(eq(marketplaceRefunds.id, record.id));
      return false;
    }
  },
});

export const marketplaceConfiguration = defineService({
  name: "marketplace.configuration", summary: "Show the configured Shopify store without exposing app credentials.",
  kind: "query", permission: "scoped", input: z.object({}),
  output: z.object({ configured: z.boolean(), shop: z.string().nullable() }),
  handler: async () => {
    const settings = env();
    return { configured: Boolean(settings.SHOPIFY_SHOP && settings.SHOPIFY_CLIENT_ID && settings.SHOPIFY_CLIENT_SECRET), shop: settings.SHOPIFY_SHOP ?? null };
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

export const listMarketplaceRefunds = defineService({
  name: "marketplace.listRefunds",
  summary: "Provider refunds staged for, or completed in, reconciliation.",
  kind: "query",
  permission: "scoped",
  input: z.object({ channelId: z.string().uuid().optional() }),
  output: listed(refundRow),
  handler: (input, ctx) =>
    ctx.tx
      .select()
      .from(marketplaceRefunds)
      .where(input.channelId ? eq(marketplaceRefunds.channelId, input.channelId) : undefined)
      .orderBy(desc(marketplaceRefunds.createdAt)),
});

export default [
  insertPending,
  applyConnect,
  connectMarketplaceChannel,
  claimSync,
  applySync,
  findImported,
  recordImported,
  importProviderOrder,
  syncMarketplaceChannel,
  reconcileRefund,
  marketplaceConfiguration,
  listMarketplaceChannels,
  listMarketplaceOrders,
  listMarketplaceRefunds,
];

registerSearchSource({
  kind: "marketplaceOrder", module: "marketplace", readService: "marketplace.listOrders", tables: ["marketplace_orders"],
  search: async ({ tx, pattern, limit }) => {
    const rows = await tx.select({ id: marketplaceOrders.id, externalRef: marketplaceOrders.externalRef, contactId: marketplaceOrders.contactId })
      .from(marketplaceOrders).where(or(matchesIlike(marketplaceOrders.externalRef, pattern), matchesIlike(marketplaceOrders.description, pattern)))
      .orderBy(desc(marketplaceOrders.createdAt), desc(marketplaceOrders.id)).limit(limit);
    return rows.map(item => ({ kind: "marketplaceOrder", id: item.id, title: item.externalRef,
      href: `/admin/marketplace#order-${item.id}`, snippet: null, contactId: item.contactId, module: "marketplace" }));
  },
});
