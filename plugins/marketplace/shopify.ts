// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C3.13: own-store Shopify integration. Contracts: https://shopify.dev/docs/api/admin-graphql/2026-07/queries/orders
// https://shopify.dev/docs/apps/build/authentication-authorization/client-credentials-grant
import { z } from "zod";
import { readBoundedBytes } from "@/core/http/body";
import { decimalToMinor } from "@/adapters/payments/currency";
import type { MarketplaceProvider } from "./adapter";

export interface ShopifyConfiguration { shop: string; clientId: string; clientSecret: string }
export class ShopifyError extends Error {
  constructor(message: string) { super(message); this.name = "ShopifyError"; }
}
const shopIdentity = z.object({ id: z.string().regex(/^gid:\/\/shopify\/Shop\/[0-9]+$/), myshopifyDomain: z.string() });
const orderSchema = z.object({
  id: z.string().regex(/^gid:\/\/shopify\/Order\/[0-9]+$/), name: z.string().min(1).max(200),
  email: z.string().nullable(), customer: z.object({ displayName: z.string().nullable() }).nullable(),
  displayFinancialStatus: z.string(), test: z.boolean(), cancelledAt: z.string().nullable(),
  currentTotalPriceSet: z.object({ shopMoney: z.object({ amount: z.string(), currencyCode: z.string().regex(/^[A-Z]{3}$/) }) }),
});
const REQUIRED_SCOPES = ["read_orders", "read_customers"];
const SHOP_QUERY = `query FreeholderShop { shop { id myshopifyDomain } currentAppInstallation { accessScopes { handle } } }`;
const ORDERS_QUERY = `query FreeholderOrders($first: Int!, $after: String) {
  shop { id myshopifyDomain }
  orders(first: $first, after: $after, sortKey: CREATED_AT, query: "financial_status:paid test:false") {
    nodes { id name email customer { displayName } displayFinancialStatus test cancelledAt currentTotalPriceSet { shopMoney { amount currencyCode } } }
    pageInfo { hasNextPage endCursor }
  }
}`;
const REFUNDS_QUERY = `query FreeholderRefunds($first: Int!, $after: String) {
  shop { id myshopifyDomain }
  orders(first: $first, after: $after, sortKey: UPDATED_AT, query: "financial_status:refunded OR financial_status:partially_refunded") {
    nodes { id name refunds(first: 50) { nodes { id createdAt totalRefundedSet { shopMoney { amount currencyCode } } } pageInfo { hasNextPage } } }
    pageInfo { hasNextPage endCursor }
  }
}`;

export function createShopifyProvider(configuration: ShopifyConfiguration, fetcher: typeof fetch = fetch, now = Date.now): MarketplaceProvider {
  const shop = configuration.shop.trim().toLowerCase();
  const clientId = configuration.clientId.trim();
  const clientSecret = configuration.clientSecret.trim();
  if (!/^[a-z0-9][a-z0-9-]{0,61}[a-z0-9]\.myshopify\.com$/.test(shop) || !clientId || !clientSecret || /[\r\n]/.test(clientId + clientSecret)) {
    throw new ShopifyError("Configure a myshopify.com shop domain, Shopify client ID and client secret.");
  }
  const origin = `https://${shop}`;
  let token: { value: string; expiresAt: number } | undefined;
  let refreshing: Promise<string> | undefined;

  async function request(path: string, body: string, headers: Record<string, string>): Promise<unknown> {
    let response: Response;
    try {
      response = await fetcher(origin + path, { method: "POST", body, headers,
        redirect: "error", signal: AbortSignal.timeout(20_000) });
    } catch { throw new ShopifyError("Shopify could not be reached. Retry this channel sync."); }
    if (!response.ok) {
      if (response.status === 401) token = undefined;
      await response.body?.cancel().catch(() => undefined);
      throw new ShopifyError(`Shopify refused the request (HTTP ${response.status}). Check the shop credentials and access scopes.`);
    }
    try { return JSON.parse(new TextDecoder().decode(await readBoundedBytes(response, 2_097_152))) as unknown; }
    catch { throw new ShopifyError("Shopify returned an unreadable or oversized response."); }
  }

  async function accessToken(): Promise<string> {
    if (token && token.expiresAt > now() + 60_000) return token.value;
    if (refreshing) return refreshing;
    refreshing = (async () => {
      const response = await request("/admin/oauth/access_token", new URLSearchParams({
        grant_type: "client_credentials", client_id: clientId, client_secret: clientSecret,
      }).toString(), { "Content-Type": "application/x-www-form-urlencoded" });
      const parsed = z.object({ access_token: z.string().min(1).max(4096).regex(/^[^\r\n]+$/), expires_in: z.number().int().positive().max(86_400), scope: z.string() }).safeParse(response);
      if (!parsed.success || !REQUIRED_SCOPES.every(scope => parsed.data.scope.split(",").map(value => value.trim()).includes(scope))) {
        throw new ShopifyError("The Shopify app must grant read_orders and read_customers and return a valid expiring access token.");
      }
      token = { value: parsed.data.access_token, expiresAt: now() + parsed.data.expires_in * 1000 };
      return token.value;
    })();
    try { return await refreshing; } finally { refreshing = undefined; }
  }

  async function graphql(query: string, variables: Record<string, unknown> = {}): Promise<unknown> {
    const response = await request("/admin/api/2026-07/graphql.json", JSON.stringify({ query, variables }), {
      "Content-Type": "application/json", "X-Shopify-Access-Token": await accessToken(),
    });
    const envelope = z.object({ data: z.unknown().optional(), errors: z.array(z.unknown()).optional() }).safeParse(response);
    if (!envelope.success || envelope.data.errors?.length || !envelope.data.data) {
      throw new ShopifyError("Shopify could not return complete order data. Check API access, customer-data permissions and rate limits.");
    }
    return envelope.data.data;
  }
  function verifyShop(identity: z.infer<typeof shopIdentity>, expected?: string) {
    if (identity.myshopifyDomain.toLowerCase() !== shop || (expected && identity.id !== expected)) {
      throw new ShopifyError("This channel belongs to a different Shopify shop. Restore its original configuration.");
    }
  }
  function shopMoneyToMinor(money: { amount: string; currencyCode: string }): number {
    let amountMinor: number;
    try {
      if (!/^(0|[1-9][0-9]*)(?:\.[0-9]+)?$/.test(money.amount)) throw new Error("Invalid amount");
      const [whole, fraction] = money.amount.split(".");
      const decimals = fraction?.replace(/0+$/, "");
      const normalized = money.amount.split(".").length > 2 ? money.amount : `${whole}${decimals ? `.${decimals}` : ""}`;
      amountMinor = decimalToMinor(normalized, money.currencyCode);
    } catch {
      throw new ShopifyError("A Shopify monetary amount is invalid.");
    }
    if (amountMinor < 0 || amountMinor > 2_147_483_647) throw new ShopifyError("A Shopify amount exceeds the supported import range.");
    return amountMinor;
  }
  function requireProvider(provider: string) {
    if (provider !== "shopify") throw new ShopifyError("Only the Shopify live marketplace provider is configured on this instance.");
  }
  return {
    async connect(input) {
      requireProvider(input.provider);
      const data = z.object({ shop: shopIdentity, currentAppInstallation: z.object({ accessScopes: z.array(z.object({ handle: z.string() })) }) }).safeParse(await graphql(SHOP_QUERY));
      if (!data.success || !REQUIRED_SCOPES.every(required => data.data.currentAppInstallation.accessScopes.some(scope => scope.handle === required))) {
        throw new ShopifyError("Shopify did not verify the shop identity and required order/customer permissions.");
      }
      verifyShop(data.data.shop);
      return { externalRef: data.data.shop.id };
    },
    async listOrders(input) {
      requireProvider(input.provider);
      if (!/^gid:\/\/shopify\/Shop\/[0-9]+$/.test(input.externalRef) || (input.cursor && input.cursor.length > 500)) {
        throw new ShopifyError("Reconnect this Shopify channel before syncing its orders.");
      }
      const first = Math.min(50, Math.max(1, Math.floor(input.limit ?? 50)));
      const data = z.object({ shop: shopIdentity, orders: z.object({ nodes: z.array(orderSchema).max(50), pageInfo: z.object({ hasNextPage: z.boolean(), endCursor: z.string().max(500).nullable() }) }) }).safeParse(await graphql(ORDERS_QUERY, { first, after: input.cursor ?? null }));
      if (!data.success) throw new ShopifyError("Shopify returned incomplete order data. Check access to customer email and order totals.");
      verifyShop(data.data.shop, input.externalRef);
      const page = data.data.orders;
      if (page.pageInfo.hasNextPage && (!page.pageInfo.endCursor || page.pageInfo.endCursor === input.cursor)) {
        throw new ShopifyError("Shopify returned an invalid pagination cursor.");
      }
      const orders = page.nodes.filter(order => !order.test && !order.cancelledAt && order.displayFinancialStatus === "PAID").map(order => {
        if (!z.email().safeParse(order.email).success) throw new ShopifyError("A Shopify order has no accessible customer email. Check customer-data permissions before retrying.");
        const money = order.currentTotalPriceSet.shopMoney;
        const amountMinor = shopMoneyToMinor(money);
        return { externalRef: order.id, description: `Shopify ${order.name}`, amountMinor, currency: money.currencyCode,
          buyerEmail: order.email!, buyerName: (order.customer?.displayName?.trim() || order.email!).slice(0, 200) };
      });
      return { orders, nextCursor: page.pageInfo.hasNextPage ? page.pageInfo.endCursor : null };
    },
    async listRefunds(input) {
      requireProvider(input.provider);
      if (!/^gid:\/\/shopify\/Shop\/[0-9]+$/.test(input.externalRef) || (input.cursor && input.cursor.length > 500)) {
        throw new ShopifyError("Reconnect this Shopify channel before syncing its refunds.");
      }
      const first = Math.min(50, Math.max(1, Math.floor(input.limit ?? 50)));
      const refundNode = z.object({ id: z.string().regex(/^gid:\/\/shopify\/Refund\/[0-9]+$/), createdAt: z.string(),
        totalRefundedSet: z.object({ shopMoney: z.object({ amount: z.string(), currencyCode: z.string().regex(/^[A-Z]{3}$/) }) }) });
      const data = z.object({ shop: shopIdentity, orders: z.object({ nodes: z.array(z.object({
        id: z.string().regex(/^gid:\/\/shopify\/Order\/[0-9]+$/),
        refunds: z.object({ nodes: z.array(refundNode).max(50), pageInfo: z.object({ hasNextPage: z.boolean() }) }),
      })).max(50), pageInfo: z.object({ hasNextPage: z.boolean(), endCursor: z.string().max(500).nullable() }) }) }).safeParse(await graphql(REFUNDS_QUERY, { first, after: input.cursor ?? null }));
      if (!data.success) throw new ShopifyError("Shopify returned incomplete refund data. Check API access and rate limits before retrying.");
      verifyShop(data.data.shop, input.externalRef);
      const page = data.data.orders;
      if (page.pageInfo.hasNextPage && (!page.pageInfo.endCursor || page.pageInfo.endCursor === input.cursor)) {
        throw new ShopifyError("Shopify returned an invalid pagination cursor.");
      }
      const refunds = page.nodes.flatMap(order => {
        if (order.refunds.pageInfo.hasNextPage) throw new ShopifyError("A Shopify order has more refunds than one bounded page. Reconcile it by hand before retrying.");
        return order.refunds.nodes.map(refund => {
          const money = refund.totalRefundedSet.shopMoney;
          return { externalRef: refund.id, orderExternalRef: order.id,
            amountMinor: shopMoneyToMinor(money), currency: money.currencyCode };
        });
      });
      return { refunds, nextCursor: page.pageInfo.hasNextPage ? page.pageInfo.endCursor : null };
    },
  };
}
