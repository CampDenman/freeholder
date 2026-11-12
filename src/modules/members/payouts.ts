// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Member marketplace payouts (MASTER.md §44.8, C12.09).
//
// The site collects the buyer's payment through its ordinary invoice path.
// This module records what each seller is owed for each order line, holds it
// for the site's window (or until the buyer confirms delivery), and moves it
// through due to paid. Which provider pays sellers is a marketplace payout
// adapter; the manual adapter here lets a site pay by hand while the ledger
// keeps every amount. Provider-backed adapters (Stripe Connect, PayPal
// Payouts, Razorpay Route: C12.26–C12.27) are in provider-payouts.ts.
import { z } from "zod";
import {publicMerchantSupport} from "@/core/commerce/merchant-identity";
import { and, desc, eq, inArray, isNotNull, lte, sql } from "drizzle-orm";
import { listed, okResult, row, timestamp, uuid } from "@/core/contract";
import { defineService, ServiceError, type ServiceContext } from "@/core/service";
import { orderForInvoice, orderInvoiceRevenue, orderSellers, registerSellerGate } from "@/modules/catalog/market";
import { PAYOUT_PROVIDER_IDS } from "@/adapters/payouts";
import { getInvoiceMarketPolicy, marketFeeMinor } from "@/modules/invoicing/market-policy";
import { merchantSettlement } from "@/modules/invoicing/merchant-settlement";
import { notifyMember } from "./notify";
import { openMessage, sealMessage } from "./message-crypto";
import {
  PAYOUT_MODELS,
  PAYOUT_STATES,
  memberPayoutAccounts,
  memberPayouts,
  memberProfiles,
  memberSettings,
} from "./schema";

export type PayoutModel = (typeof PAYOUT_MODELS)[number];

/**
 * C12.26: how a review raised by the payout provider check begins. Only such
 * a review — the provider may have paid, and the owner must check — can be
 * answered "provider did not pay — send again"; any other review (a partial
 * refund, a dispute) goes through "still owed" with its note.
 */
export const PROVIDER_CHECK = "Check with ";

/** Existing financial rows stay intact; an unverified amount cannot leave the site. */
export const ORIGINAL_REVENUE_CHECK = "Reconcile this payout with its original discounted invoice revenue before paying the seller.";

export async function matchesOriginalOrderRevenue(ctx: ServiceContext, payout: typeof memberPayouts.$inferSelect): Promise<boolean> {
  // Subscription earnings have their own immutable invoice settlement path.
  if (!payout.orderId) return true;
  if (!payout.orderItemId) return false;
  try {
    const order = await ctx.callAsSystem(orderSellers, { orderId: payout.orderId });
    if (!order.invoiceId || order.currency !== payout.currency || !order.lines.some(line => line.orderItemId === payout.orderItemId && line.sellerUserId === payout.sellerId)) return false;
    const revenue = await ctx.callAsSystem(orderInvoiceRevenue, { orderId: order.orderId, invoiceId: order.invoiceId });
    const original = revenue.find(line => line.orderItemId === payout.orderItemId);
    return Boolean(original && payout.grossMinor === original.revenueMinor && payout.feeMinor >= 0 && payout.feeMinor <= original.revenueMinor && payout.netMinor === original.revenueMinor - payout.feeMinor);
  } catch (error) {
    if (error instanceof ServiceError && (error.code === "conflict" || error.code === "not_found")) return false;
    throw error;
  }
}

/** A provider that moves money to sellers. Each declares the models it can run. */
export interface MarketplacePayoutAdapter {
  id: string;
  /** Payout models this adapter can carry out. */
  models: readonly PayoutModel[];
  /** True when payouts are recorded by a person rather than sent by a provider. */
  manual: boolean;
}

const adapters = new Map<string, MarketplacePayoutAdapter>();

export function registerPayoutAdapter(adapter: MarketplacePayoutAdapter): void {
  adapters.set(adapter.id, adapter);
}

export function payoutAdapters(): MarketplacePayoutAdapter[] {
  return [...adapters.values()];
}

/** The site pays sellers itself (bank transfer, e-transfer, cash) and records it here. */
registerPayoutAdapter({ id: "manual", models: ["hold", "instant"], manual: true });
// The site's balance pays sellers through a provider. Direct charges to the
// seller (seller_merchant) need checkout changes and are not offered yet.
for (const id of PAYOUT_PROVIDER_IDS) registerPayoutAdapter({ id, models: ["hold", "instant"], manual: false });

export async function marketRules(ctx: ServiceContext) {
  const [found] = await ctx.tx.select().from(memberSettings).where(eq(memberSettings.id, 1));
  return {
    enabled: found?.marketplaceEnabled ?? false,
    model: (found?.payoutModel ?? "hold"),
    holdDays: found?.holdDays ?? 14,
    siteFeeBps: found?.siteFeeBps ?? 0,
    adapter: found?.payoutAdapter ?? "manual",
  };
}

/** Called by the catalog before a member's listing goes in a cart or to checkout. */
registerSellerGate(async (ctx, sellerIds) => {
  const rules = await marketRules(ctx);
  if (!rules.enabled) return "This site does not have a member market.";
  const adapter = adapters.get(rules.adapter);
  if (!adapter || !adapter.models.includes(rules.model)) return "Buying from members is not set up on this site yet.";
  const members = sellerIds.filter((id): id is string => id !== null);
  if (rules.model === "seller_merchant" && sellerIds.length > 1) {
    return "Each seller is paid directly, so check out one seller at a time.";
  }
  if (members.length === 0) return null;
  const ready = await ctx.tx
    .select({ userId: memberPayoutAccounts.userId })
    .from(memberPayoutAccounts)
    .innerJoin(memberProfiles, eq(memberProfiles.userId, memberPayoutAccounts.userId))
    .where(
      and(
        inArray(memberPayoutAccounts.userId, members),
        eq(memberPayoutAccounts.status, "ready"),
        eq(memberPayoutAccounts.adapter, rules.adapter),
        eq(memberProfiles.status, "active"),
      ),
    );
  return ready.length === members.length ? null : "This seller cannot receive payments yet.";
});

const payoutRow = row({
  id: uuid,
  /** The order line paid for, or (C12.05) null for a subscription invoice. */
  orderId: uuid.nullable(),
  invoiceId: uuid.nullable(),
  sellerId: uuid,
  sellerHandle: z.string(),
  currency: z.string(),
  grossMinor: z.number().int(),
  feeMinor: z.number().int(),
  netMinor: z.number().int(),
  state: z.enum(PAYOUT_STATES),
  model: z.enum(PAYOUT_MODELS),
  releaseAt: timestamp.nullable(),
  paidAt: timestamp.nullable(),
  reference: z.string().nullable(),
  note: z.string().nullable(),
  /** Under review because the payout provider may have paid: the owner checks the provider. */
  providerCheck: z.boolean(),
  createdAt: timestamp,
});

async function payoutsWhere(ctx: ServiceContext, where: ReturnType<typeof and>, limit = 200) {
  const rows = await ctx.tx
    .select({
      payout: memberPayouts,
      handle: memberProfiles.handle,
      unknownTransfer: sql<boolean>`exists (select 1 from member_payout_transfers t where t.payout_id = ${memberPayouts.id} and t.kind = 'transfer' and t.state = 'unknown')`,
    })
    .from(memberPayouts)
    .innerJoin(memberProfiles, eq(memberProfiles.userId, memberPayouts.sellerId))
    .where(where)
    .orderBy(desc(memberPayouts.createdAt))
    .limit(limit);
  return rows.map(({ payout: p, handle, unknownTransfer }) => ({
    id: p.id,
    orderId: p.orderId,
    invoiceId: p.invoiceId,
    sellerId: p.sellerId,
    sellerHandle: handle,
    currency: p.currency,
    grossMinor: p.grossMinor,
    feeMinor: p.feeMinor,
    netMinor: p.netMinor,
    state: p.state,
    model: p.model,
    releaseAt: p.releaseAt,
    paidAt: p.paidAt,
    reference: p.reference,
    note: p.note,
    providerCheck: p.state === "review" && Boolean(unknownTransfer) && Boolean(p.note?.startsWith(PROVIDER_CHECK)),
    createdAt: p.createdAt,
  }));
}

export const recordPayouts = defineService({
  name: "members.recordPayouts",
  summary: "Record what each seller is owed for a paid order.",
  kind: "mutation",
  permission: "system",
  writeClass: "money",
  input: z.object({ orderId: uuid }),
  output: z.object({ recorded: z.number().int() }),
  handler: async (input, ctx) => {
    const order = await ctx.callAsSystem(orderSellers, { orderId: input.orderId });
    if (order.lines.length === 0) return { recorded: 0 };
    const prior=await ctx.tx.select({orderItemId:memberPayouts.orderItemId}).from(memberPayouts).where(eq(memberPayouts.orderId,order.orderId));
    const recordedItems=new Set(prior.map(item=>item.orderItemId));
    if(order.lines.every(line=>recordedItems.has(line.orderItemId)))return{recorded:0};
    if(!order.invoiceId)throw new ServiceError("conflict","This order needs its original invoice before seller earnings are recorded.");
    const revenue=await ctx.callAsSystem(orderInvoiceRevenue,{orderId:order.orderId,invoiceId:order.invoiceId});
    const originalLines=order.lines.map(line=>{
      const original=revenue.find(item=>item.orderItemId===line.orderItemId);
      if(!original)throw new ServiceError("conflict","This seller line has no original invoice revenue.");
      return{...line,...original};
    });
    const frozen = order.invoiceId ? await ctx.callAsSystem(getInvoiceMarketPolicy, { invoiceId: order.invoiceId }) : null;
    const rules = frozen ?? await marketRules(ctx);
    const settled = rules.model === "seller_merchant" && order.invoiceId && frozen?.sellerUserId ? await ctx.callAsSystem(merchantSettlement,{invoiceId:order.invoiceId,sellerUserId:frozen.sellerUserId}) : null;
    if(rules.model === "seller_merchant" && (!settled || order.lines.some(line=>line.sellerUserId!==frozen?.sellerUserId))) throw new ServiceError("conflict","The original seller payment needs reconciliation.");
    let fees=originalLines.map(line=>marketFeeMinor(line.revenueMinor,rules.siteFeeBps));
    if(frozen && fees.reduce((sum,fee)=>sum+fee,0)!==frozen.feeMinor){
      // Older invoices froze commission against pre-discount catalog totals.
      // Preserve that exact known fee; never reprice an issued provider charge.
      const legacy=originalLines.map(line=>marketFeeMinor(line.originalMinor,rules.siteFeeBps));
      if(legacy.reduce((sum,fee)=>sum+fee,0)!==frozen.feeMinor)throw new ServiceError("conflict","Reconcile the original seller fee allocation before recording earnings.");
      fees=legacy;
    }
    let recorded = 0;
    for (const [position,line] of originalLines.entries()) {
      if(recordedItems.has(line.orderItemId))continue;
      const fee=fees[position]!;
      if(fee>line.revenueMinor)throw new ServiceError("conflict","The original seller fee exceeds this line's invoice revenue. Reconcile its existing terms first.");
      const now = new Date();
      const [created] = await ctx.tx
        .insert(memberPayouts)
        .values({
          orderId: order.orderId,
          orderItemId: line.orderItemId,
          sellerId: line.sellerUserId,
          currency: order.currency,
          grossMinor: line.revenueMinor,
          feeMinor: fee,
          netMinor: line.revenueMinor - fee,
          model: rules.model,
          state: settled?.state ?? (line.revenueMinor === fee ? "paid" : rules.model === "hold" ? "held" : "due"),
          reference: settled?.reference,
          paidAt: settled?.paidAt ?? (line.revenueMinor === fee ? now : undefined),
          releaseAt: rules.model === "hold" ? new Date(now.getTime() + rules.holdDays * 86_400_000) : null,
          releasedAt: settled?.paidAt ?? (rules.model === "hold" ? null : now),
        })
        .onConflictDoNothing()
        .returning();
      if (!created) continue;
      recorded += 1;
      await notifyMember(ctx, {
        to: line.sellerUserId,
        from: line.sellerUserId,
        topic: "members.sale",
        key: "members.notify.sale",
        href: "/portal/payouts",
        idempotencyKey: `member-sale:${line.orderItemId}`,
      });
    }
    ctx.queueEvent("member.payoutsRecorded", { orderId: order.orderId, count: recorded });
    return { recorded };
  },
});

export const reversePayouts = defineService({
  name: "members.reversePayouts",
  summary: "Adjust sellers' payouts after a buyer is refunded.",
  kind: "mutation",
  permission: "system",
  writeClass: "money",
  input: z.object({ invoiceId: uuid, amountMinor: z.number().int().min(0) }),
  output: z.object({ changed: z.number().int() }),
  handler: async (input, ctx) => {
    const { orderId, totalMinor } = await ctx.callAsSystem(orderForInvoice, { invoiceId: input.invoiceId });
    // A refunded subscription invoice (C12.05) is its own payout's source.
    const [direct] = orderId ? [] : await ctx.tx.select({ grossMinor: memberPayouts.grossMinor }).from(memberPayouts).where(eq(memberPayouts.invoiceId, input.invoiceId));
    if (!orderId && !direct) return { changed: 0 };
    const source = orderId ? eq(memberPayouts.orderId, orderId) : eq(memberPayouts.invoiceId, input.invoiceId);
    const policy = await ctx.callAsSystem(getInvoiceMarketPolicy,{invoiceId:input.invoiceId});
    if(policy?.model === "seller_merchant" && policy.sellerUserId) {
      const settled = await ctx.callAsSystem(merchantSettlement,{invoiceId:input.invoiceId,sellerUserId:policy.sellerUserId});
      const changed = await ctx.tx.update(memberPayouts).set({state:settled.state,note:settled.state === "cancelled" ? "Original seller payment refunded in full." : "Review the original seller payment's refund or dispute."}).where(and(source,eq(memberPayouts.model,"seller_merchant"))).returning({id:memberPayouts.id});
      return {changed:changed.length};
    }
    const full = orderId ? totalMinor !== null && input.amountMinor >= totalMinor : input.amountMinor >= direct!.grossMinor;
    const open = await ctx.tx
      .update(memberPayouts)
      .set(full ? { state: "cancelled", note: "Buyer refunded in full." } : { state: "review", note: "Buyer partly refunded; decide what the seller is owed." })
      .where(and(source, inArray(memberPayouts.state, ["held", "due"])))
      .returning({ id: memberPayouts.id });
    const paid = await ctx.tx
      .update(memberPayouts)
      .set({ state: "review", note: "Buyer refunded after the seller was paid; recover or absorb it." })
      .where(and(source, eq(memberPayouts.state, "paid")))
      .returning({ id: memberPayouts.id });
    // C12.26: where a provider paid the seller, a full refund asks it to reverse the transfer.
    if (full && paid.length) {
      const { queueReversals } = await import("./provider-payouts");
      await queueReversals(ctx, paid.map((p) => p.id));
    }
    return { changed: open.length + paid.length };
  },
});

export const releaseDuePayouts = defineService({
  name: "members.releaseDuePayouts",
  summary: "Move held payouts whose window has passed to due.",
  kind: "mutation",
  permission: "system",
  writeClass: "money",
  input: z.object({}),
  output: z.object({ released: z.number().int() }),
  handler: async (_input, ctx) => {
    const released = await ctx.tx
      .update(memberPayouts)
      .set({ state: "due", releasedAt: new Date() })
      .where(
        and(
          eq(memberPayouts.state, "held"),
          isNotNull(memberPayouts.releaseAt),
          lte(memberPayouts.releaseAt, new Date()),
          // An open dispute freezes the sale until the site resolves it (C12.10).
          sql`not exists (select 1 from member_disputes d where d.order_id = ${memberPayouts.orderId} and d.seller_id = ${memberPayouts.sellerId} and d.state = 'open')`,
        ),
      )
      .returning({ id: memberPayouts.id });
    return { released: released.length };
  },
});

function me(ctx: ServiceContext): string {
  if (ctx.actor.kind !== "user") throw new ServiceError("permission", "Sign in to continue.");
  return ctx.actor.userId;
}

export const myPayoutAccount = defineService({
  name: "members.payoutAccount",
  summary: "How the site pays you, and whether you can sell yet.",
  kind: "query",
  permission: "authenticated",
  input: z.object({}),
  output: z.object({
    adapter: z.string(),
    manual: z.boolean(),
    status: z.enum(["none", "pending", "ready", "disabled"]),
    instructions: z.string().nullable(),
    merchantName:z.string().min(1).max(200).nullable(),
    merchantSupport:publicMerchantSupport.nullable(),
  }),
  handler: async (_input, ctx) => {
    const userId = me(ctx);
    const rules = await marketRules(ctx);
    const [account] = await ctx.tx.select().from(memberPayoutAccounts).where(eq(memberPayoutAccounts.userId, userId));
    return {
      adapter: rules.adapter,
      manual: adapters.get(rules.adapter)?.manual ?? true,
      status: account && account.adapter === rules.adapter ? account.status : "none",
      instructions: account?.instructionsSealed ? openMessage(account.instructionsSealed, `payout:${userId}`) : null,
      merchantName:account?.adapter===rules.adapter?account.merchantName:null,
      merchantSupport:account?.adapter===rules.adapter?account.merchantSupport:null,
    };
  },
});

export const savePayoutInstructions = defineService({
  name: "members.savePayoutInstructions",
  summary: "Tell the site how to pay you. The site confirms the details before you can sell.",
  kind: "mutation",
  permission: "authenticated",
  writeClass: "write",
  input: z.object({ instructions: z.string().trim().min(5).max(1000) }),
  output: okResult,
  handler: async (input, ctx) => {
    const userId = me(ctx);
    const rules = await marketRules(ctx);
    if (!rules.enabled) throw new ServiceError("permission", "This site does not have a member market.");
    const sealed = sealMessage(input.instructions, `payout:${userId}`);
    // Changing where the money goes needs the site to confirm again.
    await ctx.tx
      .insert(memberPayoutAccounts)
      .values({ userId, adapter: rules.adapter, status: "pending", instructionsSealed: sealed })
      .onConflictDoUpdate({
        target: memberPayoutAccounts.userId,
        set: { adapter: rules.adapter, status: "pending", instructionsSealed: sealed, updatedAt: new Date() },
      });
    ctx.setSubject("member_payout_account", userId);
    return { ok: true as const };
  },
});

export const myPayouts = defineService({
  name: "members.myPayouts",
  summary: "What you have earned: held, due and paid amounts, and each sale.",
  kind: "query",
  permission: "authenticated",
  input: z.object({}),
  output: z.object({
    totals: listed(row({ currency: z.string(), state: z.enum(PAYOUT_STATES), netMinor: z.number().int() })),
    payouts: listed(payoutRow),
  }),
  handler: async (_input, ctx) => {
    const userId = me(ctx);
    const totals = await ctx.tx
      .select({ currency: memberPayouts.currency, state: memberPayouts.state, netMinor: sql<number>`sum(${memberPayouts.netMinor})::int` })
      .from(memberPayouts)
      .where(eq(memberPayouts.sellerId, userId))
      .groupBy(memberPayouts.currency, memberPayouts.state);
    return { totals, payouts: await payoutsWhere(ctx, and(eq(memberPayouts.sellerId, userId)), 100) };
  },
});

export const sitePayouts = defineService({
  name: "members.payouts",
  summary: "Seller payouts by state, for the site to release, pay and resolve.",
  kind: "query",
  permission: "scoped",
  input: z.object({ state: z.enum(PAYOUT_STATES).optional() }),
  output: z.object({
    payouts: listed(payoutRow),
    accounts: listed(row({ userId: uuid, handle: z.string(), status: z.enum(["pending", "ready", "disabled"]), instructions: z.string().nullable() })),
  }),
  handler: async (input, ctx) => {
    const accounts = await ctx.tx
      .select({ account: memberPayoutAccounts, handle: memberProfiles.handle })
      .from(memberPayoutAccounts)
      .innerJoin(memberProfiles, eq(memberProfiles.userId, memberPayoutAccounts.userId))
      .orderBy(memberProfiles.handle);
    return {
      payouts: await payoutsWhere(ctx, and(input.state ? eq(memberPayouts.state, input.state) : undefined)),
      accounts: accounts.map(({ account, handle }) => ({
        userId: account.userId,
        handle,
        status: account.status,
        instructions: account.instructionsSealed ? openMessage(account.instructionsSealed, `payout:${account.userId}`) : null,
      })),
    };
  },
});

export const setPayoutAccountStatus = defineService({
  name: "members.setPayoutAccountStatus",
  summary: "Confirm a seller's payout details so they can sell, or disable them.",
  kind: "mutation",
  permission: "scoped",
  writeClass: "money",
  input: z.object({ userId: uuid, status: z.enum(["ready", "disabled", "pending"]) }),
  output: okResult,
  handler: async (input, ctx) => {
    const [updated] = await ctx.tx
      .update(memberPayoutAccounts)
      .set({ status: input.status, updatedAt: new Date() })
      .where(eq(memberPayoutAccounts.userId, input.userId))
      .returning({ userId: memberPayoutAccounts.userId });
    if (!updated) throw new ServiceError("not_found", "That seller has not set up payouts.");
    ctx.setSubject("member_payout_account", input.userId);
    return { ok: true as const };
  },
});

export const settlePayouts = defineService({
  name: "members.settlePayouts",
  summary: "Release held payouts now, record due payouts as paid with a reference, or resolve ones under review — including, after checking the payout provider, whether it paid.",
  kind: "mutation",
  permission: "scoped",
  writeClass: "money",
  input: z.object({
    ids: z.array(uuid).min(1).max(200),
    // providerPaid / sendAgain: the owner's answer, after checking the payout
    // provider, for a payout whose provider transfer outcome is unknown.
    action: z.enum(["release", "paid", "cancel", "owe", "providerPaid", "sendAgain"]),
    reference: z.string().trim().max(200).optional(),
    note: z.string().trim().max(500).optional(),
  }),
  output: z.object({ changed: z.number().int() }),
  handler: async (input, ctx) => {
    const direct = await ctx.tx.select({id:memberPayouts.id}).from(memberPayouts).where(and(inArray(memberPayouts.id,input.ids),eq(memberPayouts.model,"seller_merchant"))).limit(1);
    if (direct.length) throw new ServiceError("conflict", "Direct seller charges reconcile through their original payments, refunds and disputes; do not send another payout.");
    if (input.action === "providerPaid" || input.action === "sendAgain") {
      // Sending money again is answered for one payout at a time, never in bulk.
      if (input.action === "sendAgain" && input.ids.length !== 1) throw new ServiceError("validation", "Check and send one payout at a time.");
      const { resolveProviderCheck } = await import("./provider-payouts");
      const resolved = await resolveProviderCheck(ctx, input.ids, input.action === "providerPaid" ? "paid" : "not_paid", input.reference);
      for (const id of resolved) ctx.setSubject("member_payout", id);
      return { changed: resolved.length };
    }
    const from = { release: ["held"], paid: ["due"], cancel: ["held", "due", "review"], owe: ["review"] }[input.action] as (typeof PAYOUT_STATES)[number][];
    if (input.action === "paid" && !input.reference) throw new ServiceError("validation", "Record how each payout was paid.");
    if ((input.action === "cancel" || input.action === "owe") && !input.note) throw new ServiceError("validation", "Say why.");
    if (input.action === "release" || input.action === "owe") {
      const candidates = await ctx.tx.select().from(memberPayouts).where(and(inArray(memberPayouts.id, input.ids), inArray(memberPayouts.state, from))).for("update");
      for (const payout of candidates) {
        if (!await matchesOriginalOrderRevenue(ctx, payout)) throw new ServiceError("conflict", ORIGINAL_REVENUE_CHECK);
      }
    }
    const now = new Date();
    const set =
      input.action === "release" ? { state: "due" as const, releasedAt: now }
      : input.action === "paid" ? { state: "paid" as const, paidAt: now, reference: input.reference }
      : input.action === "owe" ? { state: "due" as const, note: input.note }
      : { state: "cancelled" as const, note: input.note };
    const changed = await ctx.tx
      .update(memberPayouts)
      .set(set)
      .where(
        and(
          inArray(memberPayouts.id, input.ids),
          inArray(memberPayouts.state, from),
          // Paying or releasing a disputed sale waits for the dispute (C12.10).
          input.action === "release" || input.action === "paid"
            ? sql`not exists (select 1 from member_disputes d where d.order_id = ${memberPayouts.orderId} and d.seller_id = ${memberPayouts.sellerId} and d.state = 'open')`
            : undefined,
        ),
      )
      .returning({ id: memberPayouts.id, sellerId: memberPayouts.sellerId });
    for (const row of changed) {
      ctx.setSubject("member_payout", row.id);
      if (input.action === "paid") {
        await notifyMember(ctx, {
          to: row.sellerId,
          from: row.sellerId,
          topic: "members.sale",
          key: "members.notify.paidOut",
          href: "/portal/payouts",
          idempotencyKey: `member-paid:${row.id}`,
        });
      }
    }
    return { changed: changed.length };
  },
});

/** Event listeners: the catalog says an order was paid or refunded. */
export async function onOrderPaid(payload: unknown): Promise<void> {
  const orderId = (payload as { orderId?: string } | null)?.orderId;
  if (!orderId) return;
  await recordPayouts.call({ orderId }, { kind: "system" });
}

export async function onRefundSucceeded(payload: unknown): Promise<void> {
  const { invoiceId, amountMinor } = (payload ?? {}) as { invoiceId?: string; amountMinor?: number };
  if (!invoiceId || typeof amountMinor !== "number") return;
  await reversePayouts.call({ invoiceId, amountMinor }, { kind: "system" });
}

export default [
  recordPayouts,
  reversePayouts,
  releaseDuePayouts,
  myPayoutAccount,
  savePayoutInstructions,
  myPayouts,
  sitePayouts,
  setPayoutAccountStatus,
  settlePayouts,
];
