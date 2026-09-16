// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C3.13: Shopify refund reconciliation composed with the fenced sync lease and
// the invoicing credit-note spine.
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/core/db";
import { ready } from "@/core/runtime";
import { getService } from "@/core/service";
import { creditNotes, invoices } from "@/modules/invoicing/schema";
import * as adapter from "../../plugins/marketplace/adapter";
import { createShopifyProvider } from "../../plugins/marketplace/shopify";
import { connectMarketplaceChannel, syncMarketplaceChannel } from "../../plugins/marketplace/service";
import { marketplaceRefunds } from "../../plugins/marketplace/schema";
import { closeDb, hasDatabase, OWNER, truncateSpine } from "../helpers/spine";

const SYSTEM = { kind: "system" } as const;
const FOREIGN_LEASE = "00000000-0000-4000-8000-000000000099";
const shop = { id: "gid://shopify/Shop/123", myshopifyDomain: "test-shop.myshopify.com" };
const order = { id: "gid://shopify/Order/456", name: "#1001", email: "shop-buyer@example.test", customer: { displayName: "Shop Buyer" },
  displayFinancialStatus: "PAID", test: false, cancelledAt: null, currentTotalPriceSet: { shopMoney: { amount: "12.34", currencyCode: "CAD" } } };

interface Staged {
  orders: unknown[];
  refunds: unknown[];
  fetcher: ReturnType<typeof vi.fn<typeof fetch>>;
}

function stagedShopify(): Staged {
  const staged: Staged = { orders: [order], refunds: [], fetcher: vi.fn<typeof fetch>() };
  staged.fetcher.mockImplementation(async (url, init) => {
    if ((url as string).endsWith("access_token")) return Response.json({ access_token: "test-token", expires_in: 86399, scope: "read_orders,read_customers" });
    const body = JSON.parse(init!.body as string) as { query: string };
    if (body.query.includes("FreeholderShop")) {
      return Response.json({ data: { shop, currentAppInstallation: { accessScopes: [{ handle: "read_orders" }, { handle: "read_customers" }] } } });
    }
    if (body.query.includes("FreeholderRefunds")) {
      return Response.json({ data: { shop, orders: { nodes: staged.refunds, pageInfo: { hasNextPage: false, endCursor: null } } } });
    }
    return Response.json({ data: { shop, orders: { nodes: staged.orders, pageInfo: { hasNextPage: false, endCursor: null } } } });
  });
  vi.spyOn(adapter, "marketplaceProvider").mockReturnValue(
    createShopifyProvider({ shop: shop.myshopifyDomain, clientId: "client", clientSecret: "secret" }, staged.fetcher),
  );
  return staged;
}

function refundNode(id: string, orderId: string, amount: string, currency = "CAD") {
  return { id: orderId, name: "#1001", refunds: { nodes: [{ id, createdAt: "2026-09-15T00:00:00Z",
    totalRefundedSet: { shopMoney: { amount, currencyCode: currency } } }], pageInfo: { hasNextPage: false } } };
}

async function connectedChannel() {
  const channel = await connectMarketplaceChannel.call({ name: "My Shopify", provider: "shopify" }, OWNER);
  return channel;
}

async function importedInvoice(channelId: string) {
  const imported = await syncMarketplaceChannel.call({ channelId }, OWNER);
  expect(imported.lastError).toBeNull();
  const [row] = await db().select().from(invoices);
  return row!;
}

describe.runIf(hasDatabase)("Shopify refund reconciliation", { timeout: 30_000 }, () => {
  beforeEach(async () => { await ready(); await truncateSpine(); });
  afterEach(() => vi.restoreAllMocks());
  afterAll(closeDb);

  it("reconciles a full refund as one issued credit note once the invoice is issued", async () => {
    const staged = stagedShopify();
    const channel = await connectedChannel();
    const invoice = await importedInvoice(channel.id);
    expect(invoice.status).toBe("draft");
    staged.refunds = [refundNode("gid://shopify/Refund/9001", order.id, "12.34")];
    // The invoice is still a reviewable draft: the refund waits visibly.
    expect(await syncMarketplaceChannel.call({ channelId: channel.id }, OWNER))
      .toEqual({ imported: 0, refundsReconciled: 0, lastError: null });
    let [refund] = await db().select().from(marketplaceRefunds);
    expect(refund).toMatchObject({ externalRef: "gid://shopify/Refund/9001", status: "pending_invoice", invoiceId: invoice.id, creditNoteId: null });
    await getService("invoicing.issue").call({ id: invoice.id }, OWNER);
    expect(await syncMarketplaceChannel.call({ channelId: channel.id }, OWNER))
      .toEqual({ imported: 0, refundsReconciled: 1, lastError: null });
    [refund] = await db().select().from(marketplaceRefunds);
    expect(refund!.status).toBe("reconciled");
    const notes = await db().select().from(creditNotes);
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({ invoiceId: invoice.id, status: "issued", totalMinor: 1234, currency: "CAD" });
    expect(refund!.creditNoteId).toBe(notes[0]!.id);
    // Re-syncing must not double-create the refund document.
    expect(await syncMarketplaceChannel.call({ channelId: channel.id }, OWNER))
      .toEqual({ imported: 0, refundsReconciled: 0, lastError: null });
    expect(await db().select().from(creditNotes)).toHaveLength(1);
  });

  it("reconciles partial and repeated refunds separately without exceeding the invoice", async () => {
    const staged = stagedShopify();
    const channel = await connectedChannel();
    const invoice = await importedInvoice(channel.id);
    await getService("invoicing.issue").call({ id: invoice.id }, OWNER);
    staged.refunds = [refundNode("gid://shopify/Refund/9002", order.id, "5.00"), refundNode("gid://shopify/Refund/9003", order.id, "7.34")];
    expect(await syncMarketplaceChannel.call({ channelId: channel.id }, OWNER))
      .toEqual({ imported: 0, refundsReconciled: 2, lastError: null });
    const notes = await db().select().from(creditNotes).orderBy(creditNotes.totalMinor);
    expect(notes.map((note) => note.totalMinor)).toEqual([500, 734]);
    expect(notes.every((note) => note.status === "issued")).toBe(true);
    // A third refund beyond the remaining total stays visible, not silent.
    staged.refunds = [refundNode("gid://shopify/Refund/9002", order.id, "5.00"), refundNode("gid://shopify/Refund/9003", order.id, "7.34"),
      refundNode("gid://shopify/Refund/9004", order.id, "0.01")];
    expect(await syncMarketplaceChannel.call({ channelId: channel.id }, OWNER))
      .toEqual({ imported: 0, refundsReconciled: 0, lastError: null });
    expect(await db().select().from(creditNotes)).toHaveLength(2);
    const [stuck] = await db().select().from(marketplaceRefunds).where(eq(marketplaceRefunds.externalRef, "gid://shopify/Refund/9004"));
    expect(stuck!.status).toBe("pending_invoice");
    expect(stuck!.lastError).toContain("exceed");
  });

  it("orders a refund ahead of its order import and reconciles it afterwards", async () => {
    const staged = stagedShopify();
    const channel = await connectedChannel();
    // First sync: the refund's order is not importable yet (refunded before
    // the first sync excludes it from the paid-order query).
    staged.orders = [];
    staged.refunds = [refundNode("gid://shopify/Refund/9005", order.id, "12.34")];
    expect(await syncMarketplaceChannel.call({ channelId: channel.id }, OWNER))
      .toEqual({ imported: 0, refundsReconciled: 0, lastError: null });
    let [refund] = await db().select().from(marketplaceRefunds);
    expect(refund).toMatchObject({ status: "pending_order", invoiceId: null, creditNoteId: null });
    expect(await db().select().from(creditNotes)).toHaveLength(0);
    // The order appears on a later sync and imports first.
    staged.orders = [order];
    expect(await syncMarketplaceChannel.call({ channelId: channel.id }, OWNER))
      .toEqual({ imported: 1, refundsReconciled: 0, lastError: null });
    [refund] = await db().select().from(marketplaceRefunds);
    expect(refund!.status).toBe("pending_invoice");
    const [invoice] = await db().select().from(invoices);
    await getService("invoicing.issue").call({ id: invoice!.id }, OWNER);
    expect(await syncMarketplaceChannel.call({ channelId: channel.id }, OWNER))
      .toEqual({ imported: 0, refundsReconciled: 1, lastError: null });
    [refund] = await db().select().from(marketplaceRefunds);
    expect(refund!.status).toBe("reconciled");
    expect(await db().select().from(creditNotes)).toHaveLength(1);
  });

  it("refuses to reconcile without the owning sync lease", async () => {
    stagedShopify();
    const channel = await connectedChannel();
    await importedInvoice(channel.id);
    const claim = await getService("marketplace.claimSync").call({ channelId: channel.id }, SYSTEM) as { leaseToken: string };
    const refund = { externalRef: "gid://shopify/Refund/9006", orderExternalRef: order.id, amountMinor: 100, currency: "CAD" };
    await expect(getService("marketplace.reconcileRefund")
      .call({ channelId: channel.id, leaseToken: claim.leaseToken, refund }, OWNER)).rejects.toMatchObject({ code: "permission" });
    await expect(getService("marketplace.reconcileRefund")
      .call({ channelId: channel.id, leaseToken: FOREIGN_LEASE, refund }, SYSTEM)).rejects.toMatchObject({ code: "conflict" });
    await getService("marketplace.applySync").call({ channelId: channel.id, leaseToken: claim.leaseToken, lastError: "done" }, SYSTEM);
    expect(await db().select().from(marketplaceRefunds)).toHaveLength(0);
  });

  it("keeps one refund row per provider refund id and fences competing syncs", async () => {
    const staged = stagedShopify();
    const channel = await connectedChannel();
    const invoice = await importedInvoice(channel.id);
    await getService("invoicing.issue").call({ id: invoice.id }, OWNER);
    staged.refunds = [refundNode("gid://shopify/Refund/9007", order.id, "12.34")];
    const claim = await getService("marketplace.claimSync").call({ channelId: channel.id }, SYSTEM) as { leaseToken: string };
    await expect(syncMarketplaceChannel.call({ channelId: channel.id }, OWNER)).rejects.toMatchObject({ code: "conflict" });
    await expect(getService("marketplace.reconcileRefund").call({ channelId: channel.id, leaseToken: claim.leaseToken,
      refund: { externalRef: "gid://shopify/Refund/9007", orderExternalRef: order.id, amountMinor: 1234, currency: "CAD" } }, SYSTEM)).resolves.toBe(true);
    await getService("marketplace.applySync").call({ channelId: channel.id, leaseToken: claim.leaseToken, completed: true }, SYSTEM);
    expect(await db().select().from(marketplaceRefunds)).toHaveLength(1);
    expect(await db().select().from(creditNotes)).toHaveLength(1);
    // A later sync sees the reconciled row and creates nothing new.
    expect(await syncMarketplaceChannel.call({ channelId: channel.id }, OWNER))
      .toEqual({ imported: 0, refundsReconciled: 0, lastError: null });
    expect(await db().select().from(creditNotes)).toHaveLength(1);
  });
});
