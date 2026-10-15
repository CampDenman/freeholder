// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Buyer protection (MASTER.md §44.8, C12.10).
//
// A "sale" is one seller's part of one order. The seller records shipment;
// the buyer confirms delivery, which releases the seller's held payout early;
// either side can talk in the sale's thread, which the site can read and join.
// A buyer can open a dispute while the money is still held or due; an open
// dispute freezes that sale's payouts until a site admin resolves it by
// paying the seller or by cancelling the payout so the buyer is refunded.
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { listed, okResult, row, timestamp, uuid } from "@/core/contract";
import { contacts } from "@/core/contacts/schema";
import { defineService, hasModuleAccess, ServiceError, type ServiceContext } from "@/core/service";
import { memberOrdersForContact, orderSellers } from "@/modules/catalog/market";
import { openMessage, sealMessage } from "./message-crypto";
import { notifyMember } from "./notify";
import {
  memberDisputes,
  memberPayouts,
  memberProfiles,
  memberSaleFulfilments,
  memberSaleMessages,
} from "./schema";

type Role = "buyer" | "seller" | "site";

async function buyerUserFor(ctx: ServiceContext, contactId: string): Promise<string | null> {
  const [contact] = await ctx.tx.select({ userId: contacts.userId }).from(contacts).where(eq(contacts.id, contactId));
  return contact?.userId ?? null;
}

/** The sale and the caller's part in it, or not_found for anyone else. */
async function sale(ctx: ServiceContext, orderId: string, sellerId: string) {
  const order = await ctx.callAsSystem(orderSellers, { orderId }).catch(() => null);
  const lines = order?.lines.filter((l) => l.sellerUserId === sellerId) ?? [];
  if (!order || lines.length === 0) throw new ServiceError("not_found", "That sale is not available.");
  const buyerUserId = await buyerUserFor(ctx, order.contactId);
  const actor = ctx.actor;
  let role: Role | null = null;
  if (actor.kind === "user" && actor.userId === sellerId) role = "seller";
  else if (actor.kind === "user" && buyerUserId && actor.userId === buyerUserId) role = "buyer";
  else if (hasModuleAccess(actor, "members", "view")) role = "site";
  if (!role) throw new ServiceError("not_found", "That sale is not available.");
  return { order, lines, buyerUserId, role };
}

async function fulfilment(ctx: ServiceContext, orderId: string, sellerId: string) {
  const [found] = await ctx.tx
    .select()
    .from(memberSaleFulfilments)
    .where(and(eq(memberSaleFulfilments.orderId, orderId), eq(memberSaleFulfilments.sellerId, sellerId)));
  return found ?? null;
}

async function openDispute(ctx: ServiceContext, orderId: string, sellerId: string) {
  const [found] = await ctx.tx
    .select()
    .from(memberDisputes)
    .where(and(eq(memberDisputes.orderId, orderId), eq(memberDisputes.sellerId, sellerId), eq(memberDisputes.state, "open")));
  return found ?? null;
}

const saleInput = z.object({ orderId: uuid, sellerId: uuid });
const saleShape = row({
  orderId: uuid,
  sellerId: uuid,
  sellerHandle: z.string(),
  sellerName: z.string(),
  role: z.enum(["buyer", "seller", "site"]),
  currency: z.string(),
  createdAt: timestamp,
  items: listed(row({ name: z.string(), quantity: z.number().int(), lineTotalMinor: z.number().int(), requiresShipping: z.boolean() })),
  fulfilment: z.enum(["awaiting", "shipped", "delivered"]),
  carrier: z.string().nullable(),
  tracking: z.string().nullable(),
  dispute: row({ id: uuid, reason: z.string(), state: z.string() }).nullable(),
  payout: z.enum(["held", "due", "paid", "cancelled", "review", "mixed", "none"]),
});

async function shape(ctx: ServiceContext, orderId: string, sellerId: string) {
  const s = await sale(ctx, orderId, sellerId);
  const [seller] = await ctx.tx
    .select({ handle: memberProfiles.handle, displayName: memberProfiles.displayName })
    .from(memberProfiles)
    .where(eq(memberProfiles.userId, sellerId));
  const f = await fulfilment(ctx, orderId, sellerId);
  const [dispute] = await ctx.tx
    .select()
    .from(memberDisputes)
    .where(and(eq(memberDisputes.orderId, orderId), eq(memberDisputes.sellerId, sellerId)))
    .orderBy(desc(memberDisputes.createdAt))
    .limit(1);
  const states = [
    ...new Set(
      (
        await ctx.tx
          .select({ state: memberPayouts.state })
          .from(memberPayouts)
          .where(and(eq(memberPayouts.orderId, orderId), eq(memberPayouts.sellerId, sellerId)))
      ).map((p) => p.state),
    ),
  ];
  return {
    orderId,
    sellerId,
    sellerHandle: seller?.handle ?? "",
    sellerName: seller?.displayName ?? "",
    role: s.role,
    currency: s.order.currency,
    createdAt: s.order.createdAt,
    items: s.lines.map(({ name, quantity, lineTotalMinor, requiresShipping }) => ({ name, quantity, lineTotalMinor, requiresShipping })),
    fulfilment: f?.state ?? "awaiting",
    carrier: f?.carrier ?? null,
    tracking: f?.tracking ?? null,
    dispute: dispute ? { id: dispute.id, reason: dispute.reason, state: dispute.state } : null,
    payout: states.length === 0 ? "none" : states.length === 1 ? states[0]! : "mixed",
  } as z.infer<typeof saleShape>;
}

export const viewSale = defineService({
  name: "members.sale",
  summary: "One seller's part of an order, as the buyer, the seller or the site sees it.",
  kind: "query",
  permission: "authenticated",
  input: saleInput,
  output: saleShape,
  handler: async (input, ctx) => shape(ctx, input.orderId, input.sellerId),
});

export const mySales = defineService({
  name: "members.mySales",
  summary: "Things you sold, newest first, with delivery, dispute and payout status.",
  kind: "query",
  permission: "authenticated",
  input: z.object({}),
  output: listed(saleShape),
  handler: async (_input, ctx) => {
    if (ctx.actor.kind !== "user") throw new ServiceError("permission", "Sign in to continue.");
    const sellerId = ctx.actor.userId;
    const orders = await ctx.tx
      .selectDistinct({ orderId: memberPayouts.orderId, createdAt: memberPayouts.createdAt })
      .from(memberPayouts)
      .where(eq(memberPayouts.sellerId, sellerId))
      .orderBy(desc(memberPayouts.createdAt))
      .limit(100);
    const out = [];
    for (const o of [...new Map(orders.map((x) => [x.orderId, x])).values()]) out.push(await shape(ctx, o.orderId, sellerId));
    return out;
  },
});

export const myPurchases = defineService({
  name: "members.myPurchases",
  summary: "Things you bought from members, newest first.",
  kind: "query",
  permission: "authenticated",
  input: z.object({}),
  output: listed(saleShape),
  handler: async (_input, ctx) => {
    if (ctx.actor.kind !== "user") throw new ServiceError("permission", "Sign in to continue.");
    const [contact] = await ctx.tx.select({ id: contacts.id }).from(contacts).where(eq(contacts.userId, ctx.actor.userId));
    if (!contact) return [];
    const orderIds = await ctx.callAsSystem(memberOrdersForContact, { contactId: contact.id });
    const out = [];
    for (const orderId of orderIds) {
      const order = await ctx.callAsSystem(orderSellers, { orderId });
      if (order.status === "pending_payment" || order.status === "cancelled") continue;
      for (const sellerId of new Set(order.lines.map((l) => l.sellerUserId))) out.push(await shape(ctx, orderId, sellerId));
    }
    return out;
  },
});

export const markShipped = defineService({
  name: "members.markShipped",
  summary: "Record that you shipped your part of an order, with the carrier and tracking number.",
  kind: "mutation",
  permission: "authenticated",
  writeClass: "write",
  input: saleInput.extend({ carrier: z.string().trim().max(80).optional(), tracking: z.string().trim().max(120).optional() }),
  output: okResult,
  handler: async (input, ctx) => {
    const s = await sale(ctx, input.orderId, input.sellerId);
    if (s.role !== "seller") throw new ServiceError("permission", "Only the seller records shipment.");
    const f = await fulfilment(ctx, input.orderId, input.sellerId);
    if (f?.state === "delivered") throw new ServiceError("conflict", "This sale is already delivered.");
    await ctx.tx
      .insert(memberSaleFulfilments)
      .values({ orderId: input.orderId, sellerId: input.sellerId, state: "shipped", carrier: input.carrier ?? null, tracking: input.tracking ?? null, shippedAt: new Date() })
      .onConflictDoUpdate({
        target: [memberSaleFulfilments.orderId, memberSaleFulfilments.sellerId],
        set: { state: "shipped", carrier: input.carrier ?? null, tracking: input.tracking ?? null, shippedAt: new Date(), updatedAt: new Date() },
      });
    if (s.buyerUserId) {
      await notifyMember(ctx, { to: s.buyerUserId, from: input.sellerId, topic: "members.sale", key: "members.notify.shipped", href: `/portal/purchases/${input.orderId}/${input.sellerId}`, idempotencyKey: `member-shipped:${input.orderId}:${input.sellerId}:${randomUUID()}` });
    }
    ctx.setSubject("member_sale", `${input.orderId}:${input.sellerId}`);
    return { ok: true as const };
  },
});

/** Release held payouts for a delivered, undisputed sale. */
async function releaseSale(ctx: ServiceContext, orderId: string, sellerId: string): Promise<void> {
  await ctx.tx
    .update(memberPayouts)
    .set({ state: "due", releasedAt: new Date() })
    .where(and(eq(memberPayouts.orderId, orderId), eq(memberPayouts.sellerId, sellerId), eq(memberPayouts.state, "held")));
}

export const confirmDelivery = defineService({
  name: "members.confirmDelivery",
  summary: "Confirm you received what you bought, which lets the site pay the seller now.",
  kind: "mutation",
  permission: "authenticated",
  writeClass: "money",
  input: saleInput,
  output: okResult,
  handler: async (input, ctx) => {
    const s = await sale(ctx, input.orderId, input.sellerId);
    if (s.role !== "buyer") throw new ServiceError("permission", "Only the buyer confirms delivery.");
    if (await openDispute(ctx, input.orderId, input.sellerId)) throw new ServiceError("conflict", "Withdraw your dispute first, or wait for the site to resolve it.");
    await ctx.tx
      .insert(memberSaleFulfilments)
      .values({ orderId: input.orderId, sellerId: input.sellerId, state: "delivered", deliveredAt: new Date(), deliveredBy: "buyer" })
      .onConflictDoUpdate({
        target: [memberSaleFulfilments.orderId, memberSaleFulfilments.sellerId],
        set: { state: "delivered", deliveredAt: new Date(), deliveredBy: "buyer", updatedAt: new Date() },
      });
    await releaseSale(ctx, input.orderId, input.sellerId);
    ctx.setSubject("member_sale", `${input.orderId}:${input.sellerId}`);
    return { ok: true as const };
  },
});

export const DISPUTE_REASONS = ["not_received", "not_as_described", "other"] as const;

export const raiseDispute = defineService({
  name: "members.openDispute",
  summary: "Ask the site to step in because something you bought did not arrive or was not as described.",
  kind: "mutation",
  permission: "authenticated",
  writeClass: "money",
  rateLimit: { limit: 10, windowSeconds: 86_400, message: "Please wait before opening another dispute.", subject: (_i, actor) => (actor.kind === "user" ? actor.userId : undefined) },
  input: saleInput.extend({ reason: z.enum(DISPUTE_REASONS), details: z.string().trim().min(10).max(4000) }),
  output: z.object({ id: uuid }),
  handler: async (input, ctx) => {
    const s = await sale(ctx, input.orderId, input.sellerId);
    if (s.role !== "buyer" || !s.buyerUserId) throw new ServiceError("permission", "Only the buyer can open a dispute.");
    const payouts = await ctx.tx
      .select({ state: memberPayouts.state })
      .from(memberPayouts)
      .where(and(eq(memberPayouts.orderId, input.orderId), eq(memberPayouts.sellerId, input.sellerId)));
    if (!payouts.some((p) => p.state === "held" || p.state === "due")) {
      throw new ServiceError("conflict", "The seller has already been paid for this sale. Message the site instead.");
    }
    const [created] = await ctx.tx
      .insert(memberDisputes)
      .values({ orderId: input.orderId, sellerId: input.sellerId, buyerUserId: s.buyerUserId, reason: input.reason })
      .onConflictDoNothing()
      .returning();
    if (!created) throw new ServiceError("conflict", "There is already an open dispute for this sale.");
    await postMessage(ctx, input.orderId, input.sellerId, "buyer", s.buyerUserId, input.details);
    await notifyMember(ctx, { to: input.sellerId, from: s.buyerUserId, topic: "members.sale", key: "members.notify.disputed", href: `/portal/sales/${input.orderId}/${input.sellerId}`, idempotencyKey: `member-dispute:${created.id}` });
    ctx.setSubject("member_dispute", created.id);
    ctx.queueEvent("member.disputeOpened", { disputeId: created.id, orderId: input.orderId, sellerId: input.sellerId });
    return { id: created.id };
  },
});

export const withdrawDispute = defineService({
  name: "members.withdrawDispute",
  summary: "Withdraw your dispute because it was sorted out.",
  kind: "mutation",
  permission: "authenticated",
  writeClass: "money",
  input: saleInput,
  output: okResult,
  handler: async (input, ctx) => {
    const s = await sale(ctx, input.orderId, input.sellerId);
    if (s.role !== "buyer") throw new ServiceError("permission", "Only the buyer can withdraw a dispute.");
    const open = await openDispute(ctx, input.orderId, input.sellerId);
    if (!open) throw new ServiceError("not_found", "There is no open dispute.");
    await ctx.tx.update(memberDisputes).set({ state: "withdrawn", resolvedAt: new Date() }).where(eq(memberDisputes.id, open.id));
    return { ok: true as const };
  },
});

export const listDisputes = defineService({
  name: "members.disputes",
  summary: "Disputes between buyers and sellers, open first.",
  kind: "query",
  permission: "scoped",
  input: z.object({ state: z.enum(["open", "released", "refunded", "withdrawn"]).optional() }),
  output: listed(row({ id: uuid, orderId: uuid, sellerId: uuid, sellerHandle: z.string(), reason: z.string(), state: z.string(), createdAt: timestamp })),
  handler: async (input, ctx) => {
    const rows = await ctx.tx
      .select({ d: memberDisputes, handle: memberProfiles.handle })
      .from(memberDisputes)
      .innerJoin(memberProfiles, eq(memberProfiles.userId, memberDisputes.sellerId))
      .where(input.state ? eq(memberDisputes.state, input.state) : undefined)
      .orderBy(asc(memberDisputes.state), desc(memberDisputes.createdAt))
      .limit(200);
    return rows.map(({ d, handle }) => ({ id: d.id, orderId: d.orderId, sellerId: d.sellerId, sellerHandle: handle, reason: d.reason, state: d.state, createdAt: d.createdAt }));
  },
});

export const resolveDispute = defineService({
  name: "members.resolveDispute",
  summary: "Resolve a dispute: pay the seller, or cancel their payout so the buyer is refunded.",
  kind: "mutation",
  permission: "scoped",
  writeClass: "money",
  input: z.object({ id: uuid, outcome: z.enum(["release", "refund"]), note: z.string().trim().min(3).max(2000) }),
  output: okResult,
  handler: async (input, ctx) => {
    const [dispute] = await ctx.tx.select().from(memberDisputes).where(eq(memberDisputes.id, input.id)).for("update");
    if (!dispute || dispute.state !== "open") throw new ServiceError("conflict", "That dispute is not open.");
    await ctx.tx
      .update(memberDisputes)
      .set({ state: input.outcome === "release" ? "released" : "refunded", resolutionNote: input.note, resolvedAt: new Date() })
      .where(eq(memberDisputes.id, dispute.id));
    if (input.outcome === "release") {
      await releaseSale(ctx, dispute.orderId, dispute.sellerId);
    } else {
      await ctx.tx
        .update(memberPayouts)
        .set({ state: "cancelled", note: `Dispute resolved for the buyer: ${input.note}` })
        .where(and(eq(memberPayouts.orderId, dispute.orderId), eq(memberPayouts.sellerId, dispute.sellerId), inArray(memberPayouts.state, ["held", "due", "review"])));
    }
    const actorId = ctx.actor.kind === "user" ? ctx.actor.userId : null;
    await postMessage(ctx, dispute.orderId, dispute.sellerId, "site", actorId, input.note);
    for (const to of [dispute.buyerUserId, dispute.sellerId]) {
      await notifyMember(ctx, { to, from: to, topic: "members.sale", key: "members.notify.disputeResolved", href: to === dispute.sellerId ? `/portal/sales/${dispute.orderId}/${dispute.sellerId}` : `/portal/purchases/${dispute.orderId}/${dispute.sellerId}`, idempotencyKey: `member-dispute-resolved:${dispute.id}:${to}` });
    }
    ctx.setSubject("member_dispute", dispute.id);
    return { ok: true as const };
  },
});

async function postMessage(ctx: ServiceContext, orderId: string, sellerId: string, role: Role, authorUserId: string | null, body: string) {
  const id = randomUUID();
  await ctx.tx.insert(memberSaleMessages).values({ id, orderId, sellerId, authorUserId, role, bodySealed: sealMessage(body, id) });
}

export const saleThread = defineService({
  name: "members.saleThread",
  summary: "Messages between the buyer, the seller and the site about one sale.",
  kind: "query",
  permission: "authenticated",
  input: saleInput,
  output: listed(row({ id: uuid, role: z.enum(["buyer", "seller", "site"]), body: z.string(), createdAt: timestamp, mine: z.boolean() })),
  handler: async (input, ctx) => {
    await sale(ctx, input.orderId, input.sellerId);
    const rows = await ctx.tx
      .select()
      .from(memberSaleMessages)
      .where(and(eq(memberSaleMessages.orderId, input.orderId), eq(memberSaleMessages.sellerId, input.sellerId)))
      .orderBy(asc(memberSaleMessages.createdAt))
      .limit(500);
    const me = ctx.actor.kind === "user" ? ctx.actor.userId : null;
    return rows.map((m) => ({ id: m.id, role: m.role, body: openMessage(m.bodySealed, m.id), createdAt: m.createdAt, mine: m.authorUserId === me }));
  },
});

export const postSaleMessage = defineService({
  name: "members.postSaleMessage",
  summary: "Write in a sale's thread as its buyer, its seller or the site.",
  kind: "mutation",
  permission: "authenticated",
  writeClass: "write",
  rateLimit: { limit: 200, windowSeconds: 3600, message: "Please slow down.", subject: (_i, actor) => (actor.kind === "user" ? actor.userId : undefined) },
  input: saleInput.extend({ body: z.string().trim().min(1).max(4000) }),
  output: okResult,
  handler: async (input, ctx) => {
    const s = await sale(ctx, input.orderId, input.sellerId);
    const me = ctx.actor.kind === "user" ? ctx.actor.userId : null;
    await postMessage(ctx, input.orderId, input.sellerId, s.role, me, input.body);
    const others = [s.role !== "seller" ? input.sellerId : null, s.role !== "buyer" ? s.buyerUserId : null].filter((x): x is string => Boolean(x));
    for (const to of others) {
      await notifyMember(ctx, { to, from: to, topic: "members.sale", key: "members.notify.saleMessage", href: to === input.sellerId ? `/portal/sales/${input.orderId}/${input.sellerId}` : `/portal/purchases/${input.orderId}/${input.sellerId}`, idempotencyKey: `member-sale-message:${randomUUID()}`, dedupeKey: `member-sale-thread:${input.orderId}:${input.sellerId}` });
    }
    return { ok: true as const };
  },
});

export default [
  viewSale,
  mySales,
  myPurchases,
  markShipped,
  confirmDelivery,
  raiseDispute,
  withdrawDispute,
  listDisputes,
  resolveDispute,
  saleThread,
  postSaleMessage,
];
