// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Reputation (MASTER.md §44.8, C12.11).
//
// Buyer and seller review each other only after a completed sale — the buyer
// confirmed delivery, the site settled delivery, or a dispute was resolved.
// Reviews are double-blind: neither side sees the other's until both are
// written or the window passes, so nobody can answer a rating in kind.
import { z } from "zod";
import { and, avg, count, desc, eq, isNull, lte, or } from "drizzle-orm";
import { listed, okResult, row, timestamp, uuid } from "@/core/contract";
import { defineService, ServiceError, type ServiceContext } from "@/core/service";
import { relationBetween } from "./graph";
import { notifyMember } from "./notify";
import { viewSale } from "./protection";
import { memberDisputes, memberProfiles, memberReviews, memberSaleFulfilments } from "./schema";

const REVEAL_DAYS = 14;

async function completed(ctx: ServiceContext, orderId: string, sellerId: string): Promise<boolean> {
  const [f] = await ctx.tx
    .select({ state: memberSaleFulfilments.state })
    .from(memberSaleFulfilments)
    .where(and(eq(memberSaleFulfilments.orderId, orderId), eq(memberSaleFulfilments.sellerId, sellerId)));
  if (f?.state === "delivered") return true;
  const [resolved] = await ctx.tx
    .select({ id: memberDisputes.id })
    .from(memberDisputes)
    .where(
      and(
        eq(memberDisputes.orderId, orderId),
        eq(memberDisputes.sellerId, sellerId),
        or(eq(memberDisputes.state, "released"), eq(memberDisputes.state, "refunded")),
      ),
    );
  return Boolean(resolved);
}

export const leaveReview = defineService({
  name: "members.leaveReview",
  summary: "Review the other side of a completed sale. It stays hidden until they review you too, or for two weeks.",
  kind: "mutation",
  permission: "authenticated",
  writeClass: "write",
  input: z.object({ orderId: uuid, sellerId: uuid, rating: z.number().int().min(1).max(5), body: z.string().trim().max(2000).default("") }),
  output: okResult,
  handler: async (input, ctx) => {
    if (ctx.actor.kind !== "user") throw new ServiceError("permission", "Sign in to continue.");
    const me = ctx.actor.userId;
    const sale = await ctx.call(viewSale, { orderId: input.orderId, sellerId: input.sellerId });
    if (sale.role === "site") throw new ServiceError("permission", "Only the buyer and the seller review a sale.");
    if (!(await completed(ctx, input.orderId, input.sellerId))) {
      throw new ServiceError("conflict", "You can review once the sale is complete.");
    }
    const subjectId = sale.role === "buyer" ? input.sellerId : await buyerOf(ctx, input.orderId, input.sellerId, me);
    if (!subjectId) throw new ServiceError("conflict", "The buyer is not a member, so there is nobody to review.");
    const now = new Date();
    const [created] = await ctx.tx
      .insert(memberReviews)
      .values({
        orderId: input.orderId,
        sellerId: input.sellerId,
        authorId: me,
        subjectId,
        direction: sale.role === "buyer" ? "of_seller" : "of_buyer",
        rating: input.rating,
        body: input.body,
        revealAt: new Date(now.getTime() + REVEAL_DAYS * 86_400_000),
      })
      .onConflictDoNothing()
      .returning();
    if (!created) throw new ServiceError("conflict", "You already reviewed this sale.");
    // When both sides have written, both reviews appear at once.
    const both = await ctx.tx
      .select({ id: memberReviews.id })
      .from(memberReviews)
      .where(and(eq(memberReviews.orderId, input.orderId), eq(memberReviews.sellerId, input.sellerId)));
    if (both.length === 2) {
      await ctx.tx
        .update(memberReviews)
        .set({ revealAt: now })
        .where(and(eq(memberReviews.orderId, input.orderId), eq(memberReviews.sellerId, input.sellerId)));
    }
    await notifyMember(ctx, { to: subjectId, from: me, topic: "members.sale", key: "members.notify.reviewed", href: `${sale.role === "buyer" ? "/portal/sales" : "/portal/purchases"}/${input.orderId}/${input.sellerId}`, idempotencyKey: `member-review:${created.id}` });
    ctx.setSubject("member_review", created.id);
    return { ok: true as const };
  },
});

/** The buyer's user, if they are a member who could be reviewed. */
async function buyerOf(ctx: ServiceContext, orderId: string, sellerId: string, me: string): Promise<string | null> {
  const { orderSellers } = await import("@/modules/catalog/market");
  const { contacts } = await import("@/core/contacts/schema");
  const order = await ctx.callAsSystem(orderSellers, { orderId });
  if (!order.lines.some((l) => l.sellerUserId === sellerId) || sellerId !== me) return null;
  const [contact] = await ctx.tx.select({ userId: contacts.userId }).from(contacts).where(eq(contacts.id, order.contactId));
  if (!contact?.userId) return null;
  const [member] = await ctx.tx.select({ userId: memberProfiles.userId }).from(memberProfiles).where(eq(memberProfiles.userId, contact.userId));
  return member?.userId ?? null;
}

const reviewShape = row({
  id: uuid,
  direction: z.enum(["of_seller", "of_buyer"]),
  rating: z.number().int(),
  body: z.string(),
  author: row({ handle: z.string(), displayName: z.string() }).nullable(),
  reply: z.string().nullable(),
  createdAt: timestamp,
});

export const reviewsFor = defineService({
  name: "members.reviews",
  summary: "Revealed reviews about a member as a seller and as a buyer, with averages.",
  kind: "query",
  permission: "public",
  input: z.object({ handle: z.string().trim().toLowerCase().max(60) }),
  output: z.object({
    asSeller: row({ average: z.number().nullable(), count: z.number().int() }),
    asBuyer: row({ average: z.number().nullable(), count: z.number().int() }),
    reviews: listed(reviewShape),
  }),
  handler: async (input, ctx) => {
    const [subject] = await ctx.tx
      .select()
      .from(memberProfiles)
      .where(and(eq(memberProfiles.handle, input.handle), eq(memberProfiles.status, "active")));
    if (!subject) throw new ServiceError("not_found", "That member is not available.");
    const viewer = ctx.actor.kind === "user" ? ctx.actor.userId : null;
    if ((await relationBetween(ctx, viewer, subject.userId)).blocked) throw new ServiceError("not_found", "That member is not available.");
    const visible = and(eq(memberReviews.subjectId, subject.userId), lte(memberReviews.revealAt, new Date()), isNull(memberReviews.hiddenAt));
    const summary = async (direction: "of_seller" | "of_buyer") => {
      const [r] = await ctx.tx
        .select({ average: avg(memberReviews.rating), count: count() })
        .from(memberReviews)
        .where(and(visible, eq(memberReviews.direction, direction)));
      return { average: r?.average ? Math.round(Number(r.average) * 10) / 10 : null, count: r?.count ?? 0 };
    };
    const rows = await ctx.tx
      .select({ review: memberReviews, handle: memberProfiles.handle, displayName: memberProfiles.displayName, status: memberProfiles.status })
      .from(memberReviews)
      .leftJoin(memberProfiles, eq(memberProfiles.userId, memberReviews.authorId))
      .where(visible)
      .orderBy(desc(memberReviews.createdAt))
      .limit(50);
    return {
      asSeller: await summary("of_seller"),
      asBuyer: await summary("of_buyer"),
      reviews: rows.map(({ review, handle, displayName, status }) => ({
        id: review.id,
        direction: review.direction,
        rating: review.rating,
        body: review.body,
        author: handle && displayName && status === "active" ? { handle, displayName } : null,
        reply: review.reply,
        createdAt: review.createdAt,
      })),
    };
  },
});

export const replyToReview = defineService({
  name: "members.replyToReview",
  summary: "Reply once, publicly, to a revealed review about you.",
  kind: "mutation",
  permission: "authenticated",
  writeClass: "write",
  input: z.object({ id: uuid, body: z.string().trim().min(1).max(2000) }),
  output: okResult,
  handler: async (input, ctx) => {
    if (ctx.actor.kind !== "user") throw new ServiceError("permission", "Sign in to continue.");
    const [updated] = await ctx.tx
      .update(memberReviews)
      .set({ reply: input.body, repliedAt: new Date() })
      .where(
        and(
          eq(memberReviews.id, input.id),
          eq(memberReviews.subjectId, ctx.actor.userId),
          lte(memberReviews.revealAt, new Date()),
          isNull(memberReviews.reply),
        ),
      )
      .returning({ id: memberReviews.id, reply: memberReviews.reply });
    if (!updated) throw new ServiceError("not_found", "That review is not available to reply to, or you already replied.");
    return { ok: true as const };
  },
});

export const myReviews = defineService({
  name: "members.myReviews",
  summary: "Reviews you wrote and reviews about you, including ones not yet revealed to you.",
  kind: "query",
  permission: "authenticated",
  input: z.object({}),
  output: z.object({
    written: listed(reviewShape.extend({ revealed: z.boolean() })),
    received: listed(reviewShape),
    waitingCount: z.number().int(),
  }),
  handler: async (_input, ctx) => {
    if (ctx.actor.kind !== "user") throw new ServiceError("permission", "Sign in to continue.");
    const me = ctx.actor.userId;
    const now = new Date();
    const written = await ctx.tx.select().from(memberReviews).where(eq(memberReviews.authorId, me)).orderBy(desc(memberReviews.createdAt)).limit(100);
    const received = await ctx.tx.select().from(memberReviews).where(eq(memberReviews.subjectId, me)).orderBy(desc(memberReviews.createdAt)).limit(100);
    const shape = (r: typeof memberReviews.$inferSelect) => ({ id: r.id, direction: r.direction, rating: r.rating, body: r.body, author: null, reply: r.reply, createdAt: r.createdAt });
    return {
      written: written.map((r) => ({ ...shape(r), revealed: r.revealAt <= now })),
      received: received.filter((r) => r.revealAt <= now).map(shape),
      waitingCount: received.filter((r) => r.revealAt > now).length,
    };
  },
});

export const saleReviews = defineService({
  name: "members.saleReviews",
  summary: "The reviews on one sale as its buyer or seller sees them: yours, and theirs once revealed.",
  kind: "query",
  permission: "authenticated",
  input: z.object({ orderId: uuid, sellerId: uuid }),
  output: z.object({
    canReview: z.boolean(),
    mine: row({ id: uuid, rating: z.number().int(), body: z.string(), revealed: z.boolean(), reply: z.string().nullable() }).nullable(),
    theirs: row({ id: uuid, rating: z.number().int(), body: z.string(), reply: z.string().nullable() }).nullable(),
    theyWrote: z.boolean(),
  }),
  handler: async (input, ctx) => {
    if (ctx.actor.kind !== "user") throw new ServiceError("permission", "Sign in to continue.");
    const me = ctx.actor.userId;
    const sale = await ctx.call(viewSale, input);
    const rows = await ctx.tx
      .select()
      .from(memberReviews)
      .where(and(eq(memberReviews.orderId, input.orderId), eq(memberReviews.sellerId, input.sellerId)));
    const now = new Date();
    const mine = rows.find((r) => r.authorId === me) ?? null;
    const theirs = rows.find((r) => r.subjectId === me) ?? null;
    return {
      canReview: sale.role !== "site" && !mine && (await completed(ctx, input.orderId, input.sellerId)),
      mine: mine ? { id: mine.id, rating: mine.rating, body: mine.body, revealed: mine.revealAt <= now, reply: mine.reply } : null,
      theirs: theirs && theirs.revealAt <= now ? { id: theirs.id, rating: theirs.rating, body: theirs.body, reply: theirs.reply } : null,
      theyWrote: Boolean(theirs),
    };
  },
});

export default [leaveReview, reviewsFor, replyToReview, myReviews, saleReviews];
