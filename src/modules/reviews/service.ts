// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Collected customer feedback (MASTER.md §4.6, C8.09).
//
// The rule this module is built around is the last clause of the checklist
// line: an `AggregateRating` that never misrepresents hidden reviews. Every
// other decision here follows from it — which is why hiding and rejecting are
// different states, and why the aggregate is computed rather than stored.
import { z } from "zod";
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { listed, row, timestamp, uuid } from "@/core/contract";
import { contacts } from "@/core/contacts/schema";
import { registerContactReference, resolveContact } from "@/core/contacts/service";
import { registerContactPrivacySource } from "@/core/privacy/service";
import { assets } from "@/core/media/schema";
import {
  defineService,
  ServiceError,
  type Actor,
  type ServiceContext,
} from "@/core/service";
import {
  REVIEW_SOURCES,
  REVIEW_STATES,
  REVIEW_SUBJECTS,
  reviewMedia,
  reviewRequests,
  reviews,
} from "./schema";
import { hashReviewToken, newReviewToken } from "./tokens";

const id = z.string().uuid();

function requirePerson(actor: Actor): void {
  if (actor.kind !== "user" && actor.kind !== "system") {
    throw new ServiceError("permission", "Sign in to manage reviews.");
  }
}

/**
 * The acting user, when there is a row for them.
 *
 * Tests and API keys can be user-shaped without a `users` row, so writing
 * the actor id straight into a foreign key fails on exactly the callers that
 * are allowed to moderate.
 */
async function actingUserId(ctx: ServiceContext): Promise<string | null> {
  if (ctx.actor.kind !== "user") return null;
  const { users } = await import("@/core/auth/schema");
  const [user] = await ctx.tx
    .select({ id: users.id })
    .from(users)
    .where(eq(users.id, ctx.actor.userId))
    .limit(1);
  return user?.id ?? null;
}

const reviewRow = row({
  id: uuid,
  contactId: uuid.nullable(),
  displayName: z.string().nullable(),
  source: z.enum(REVIEW_SOURCES),
  subjectType: z.enum(REVIEW_SUBJECTS),
  subjectId: uuid.nullable(),
  rating: z.number().int(),
  title: z.string().nullable(),
  body: z.string(),
  status: z.enum(REVIEW_STATES),
  displayLocations: z.array(z.string()),
  replyBody: z.string().nullable(),
  replyAt: timestamp.nullable(),
  incentiveDisclosed: z.boolean(),
  createdAt: timestamp,
});

/**
 * What the public may see.
 *
 * The contact id never leaves: a review wall that ships the reviewer's
 * identifier lets anyone join two reviews to one person.
 */
function publicReview(review: typeof reviews.$inferSelect) {
  const {
    contactId: _contactId,
    incentiveCouponId: _coupon,
    moderatedByUserId: _moderator,
    replyByUserId: _replier,
    moderatedAt: _moderatedAt,
    updatedAt: _updatedAt,
    ...rest
  } = review;
  return rest;
}

/**
 * The rating shown beside a business, product or service.
 *
 * **Hidden reviews count.** An owner may decline to publish a review — there
 * are good reasons, including ones the law requires — but the number beside
 * the stars must not improve because they did. Counting only what is displayed
 * turns moderation into rating inflation, which is the failure this item names
 * explicitly, so the aggregate is computed over everything except `rejected`.
 *
 * `rejected` is excluded because it is a finding that the text was never a
 * customer's opinion: spam, abuse, a competitor. Excluding those is not
 * flattery, and treating them as feedback would let anyone move the number.
 *
 * Computed, never stored. A cached average is a number that drifts from its
 * own reviews, and this is the one number a reader is entitled to trust.
 */
export const aggregateRating = defineService({
  name: "reviews.aggregate",
  summary: "The rating for one subject, counting every real review.",
  kind: "query",
  permission: "public",
  input: z.object({
    subjectType: z.enum(REVIEW_SUBJECTS).default("business"),
    subjectId: id.nullish(),
  }),
  output: row({
    ratingValue: z.number().nullable(),
    reviewCount: z.number().int(),
    displayedCount: z.number().int(),
    /** True when some counted reviews are not on display, so a surface can say so. */
    withheld: z.boolean(),
  }),
  handler: async (input, ctx) => {
    const scope = and(
      eq(reviews.subjectType, input.subjectType),
      input.subjectId ? eq(reviews.subjectId, input.subjectId) : isNull(reviews.subjectId),
      inArray(reviews.status, ["pending", "approved", "hidden"]),
    );
    const [counted] = await ctx.tx
      .select({
        count: sql<number>`count(*)::int`,
        average: sql<number | null>`avg(${reviews.rating})::float`,
      })
      .from(reviews)
      .where(scope);
    const [shown] = await ctx.tx
      .select({ count: sql<number>`count(*)::int` })
      .from(reviews)
      .where(
        and(
          eq(reviews.subjectType, input.subjectType),
          input.subjectId ? eq(reviews.subjectId, input.subjectId) : isNull(reviews.subjectId),
          eq(reviews.status, "approved"),
        ),
      );
    const reviewCount = counted?.count ?? 0;
    const displayedCount = shown?.count ?? 0;
    return {
      ratingValue:
        reviewCount === 0 ? null : Math.round((counted?.average ?? 0) * 100) / 100,
      reviewCount,
      displayedCount,
      withheld: reviewCount > displayedCount,
    };
  },
});

/**
 * Ask somebody what they thought, once (C8.09).
 *
 * Automated callers reach the spine through `contacts.resolve`, never
 * `contacts.create`. One ask per person per subject: chasing somebody twice
 * for the same purchase is how a review request becomes spam.
 */
export const requestReview = defineService({
  name: "reviews.request",
  summary: "Ask a customer to review what they bought or booked.",
  kind: "mutation",
  permission: "scoped",
  writeClass: "write",
  input: z.object({
    email: z.string().trim().email().toLowerCase(),
    name: z.string().trim().min(1).max(200).optional(),
    source: z.enum(REVIEW_SOURCES).default("manual"),
    subjectType: z.enum(REVIEW_SUBJECTS).default("business"),
    subjectId: id.nullish(),
    /** A coupon offered for answering. Disclosed on the review if used. */
    incentiveCouponId: id.nullish(),
    expiresAt: z.iso.datetime().nullish(),
  }),
  output: row({
    id: uuid,
    contactId: uuid,
    token: z.string(),
    alreadyAsked: z.boolean(),
  }),
  handler: async (input, ctx) => {
    requirePerson(ctx.actor);
    const resolved = await ctx.call(resolveContact, {
      email: input.email,
      name: input.name,
      source: "review-request",
    });
    const [existing] = await ctx.tx
      .select()
      .from(reviewRequests)
      .where(
        and(
          eq(reviewRequests.contactId, resolved.contact.id),
          eq(reviewRequests.subjectType, input.subjectType),
          input.subjectId
            ? eq(reviewRequests.subjectId, input.subjectId)
            : isNull(reviewRequests.subjectId),
        ),
      )
      .limit(1);
    if (existing) {
      // Re-asking issues no new link: the first one still works, and a second
      // email about the same purchase is the definition of nagging.
      return {
        id: existing.id,
        contactId: resolved.contact.id,
        token: "",
        alreadyAsked: true,
      };
    }
    const token = newReviewToken();
    const [created] = await ctx.tx
      .insert(reviewRequests)
      .values({
        contactId: resolved.contact.id,
        source: input.source,
        subjectType: input.subjectType,
        subjectId: input.subjectId ?? null,
        tokenHash: hashReviewToken(token),
        incentiveCouponId: input.incentiveCouponId ?? null,
        sentAt: new Date(),
        expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
      })
      .returning();
    ctx.setSubject("review", created!.id);
    await ctx.emitTimeline({
      contactId: resolved.contact.id,
      eventType: "review.requested",
      subjectType: "review",
      subjectId: created!.id,
    });
    ctx.queueEvent("review.requested", { id: created!.id });
    return {
      id: created!.id,
      contactId: resolved.contact.id,
      token,
      alreadyAsked: false,
    };
  },
});

/**
 * Answer the ask.
 *
 * Arrives `pending`: nothing a stranger writes appears on the site before a
 * person has read it. The incentive is copied onto the review and marked
 * disclosed, because an incentivised review that does not say so is the kind
 * of thing regulators fine people for.
 */
export const submitReview = defineService({
  name: "reviews.submit",
  summary: "Submit a review from a request link.",
  kind: "mutation",
  permission: "public",
  writeClass: "write",
  input: z.object({
    token: z.string().min(20).max(200),
    rating: z.number().int().min(1).max(5),
    title: z.string().trim().max(200).nullish(),
    body: z.string().trim().min(1).max(5000),
    displayName: z.string().trim().min(1).max(120).nullish(),
    assetIds: z.array(id).max(10).default([]),
  }),
  rateLimit: {
    limit: 10,
    windowSeconds: 15 * 60,
    subject: (input) => `review-submit:${hashReviewToken(input.token)}`,
    message: "Too many tries. Wait a few minutes and try again.",
  },
  output: reviewRow,
  handler: async (input, ctx) => {
    const [request] = await ctx.tx
      .select()
      .from(reviewRequests)
      .where(eq(reviewRequests.tokenHash, hashReviewToken(input.token)))
      .limit(1);
    if (!request) {
      throw new ServiceError("permission", "That did not work. Nothing has changed.");
    }
    if (request.expiresAt && request.expiresAt.getTime() <= Date.now()) {
      throw new ServiceError("permission", "That review link has expired.");
    }
    if (request.respondedAt) {
      throw new ServiceError("conflict", "This review has already been sent.");
    }
    const [person] = await ctx.tx
      .select({ name: contacts.name })
      .from(contacts)
      .where(eq(contacts.id, request.contactId))
      .limit(1);

    const [created] = await ctx.tx
      .insert(reviews)
      .values({
        contactId: request.contactId,
        displayName: input.displayName ?? person?.name ?? null,
        source: request.source,
        subjectType: request.subjectType,
        subjectId: request.subjectId,
        rating: input.rating,
        title: input.title?.length ? input.title : null,
        body: input.body,
        status: "pending",
        incentiveCouponId: request.incentiveCouponId,
        incentiveDisclosed: Boolean(request.incentiveCouponId),
      })
      .returning();

    if (input.assetIds.length) {
      const ready = await ctx.tx
        .select({ id: assets.id })
        .from(assets)
        .where(and(inArray(assets.id, input.assetIds), eq(assets.status, "ready")));
      for (const [index, asset] of ready.entries()) {
        await ctx.tx
          .insert(reviewMedia)
          .values({ reviewId: created!.id, assetId: asset.id, position: index })
          .onConflictDoNothing();
      }
    }

    await ctx.tx
      .update(reviewRequests)
      .set({ respondedAt: new Date(), reviewId: created!.id, updatedAt: new Date() })
      .where(eq(reviewRequests.id, request.id));

    ctx.setSubject("review", created!.id);
    await ctx.emitTimeline({
      contactId: request.contactId,
      eventType: "review.submitted",
      subjectType: "review",
      subjectId: created!.id,
      payload: { rating: input.rating },
    });
    ctx.queueEvent("review.submitted", { id: created!.id, rating: input.rating });
    return created!;
  },
});

/**
 * Decide what to do with a review.
 *
 * Approving publishes it; hiding withholds it and keeps it counted; rejecting
 * says it was never a customer's opinion and drops it from the rating. The
 * owner is told, in the copy on the screen, that hiding does not change the
 * number — that is enforced here, not merely explained.
 */
export const moderateReview = defineService({
  name: "reviews.moderate",
  summary: "Approve, hide or reject a review.",
  kind: "mutation",
  permission: "scoped",
  writeClass: "write",
  input: z.object({
    id,
    status: z.enum(["approved", "hidden", "rejected"]),
    displayLocations: z.array(z.string().trim().min(1).max(60)).max(20).optional(),
  }),
  output: reviewRow,
  handler: async (input, ctx) => {
    requirePerson(ctx.actor);
    const [existing] = await ctx.tx
      .select()
      .from(reviews)
      .where(eq(reviews.id, input.id))
      .limit(1);
    if (!existing) throw new ServiceError("not_found", "That review is not here.");
    const [saved] = await ctx.tx
      .update(reviews)
      .set({
        status: input.status,
        displayLocations:
          input.displayLocations ??
          (input.status === "approved" ? existing.displayLocations : []),
        moderatedAt: new Date(),
        moderatedByUserId: await actingUserId(ctx),
        updatedAt: new Date(),
      })
      .where(eq(reviews.id, input.id))
      .returning();
    ctx.setSubject("review", input.id);
    ctx.queueEvent(
      input.status === "approved" ? "review.approved" : "review.hidden",
      { id: input.id, status: input.status },
    );
    return saved!;
  },
});

/** The owner's public answer. One per review: a thread is a conversation. */
export const replyToReview = defineService({
  name: "reviews.reply",
  summary: "Reply publicly to a review.",
  kind: "mutation",
  permission: "scoped",
  writeClass: "write",
  input: z.object({ id, body: z.string().trim().min(1).max(4000) }),
  output: reviewRow,
  handler: async (input, ctx) => {
    requirePerson(ctx.actor);
    const [saved] = await ctx.tx
      .update(reviews)
      .set({
        replyBody: input.body,
        replyAt: new Date(),
        replyByUserId: await actingUserId(ctx),
        updatedAt: new Date(),
      })
      .where(eq(reviews.id, input.id))
      .returning();
    if (!saved) throw new ServiceError("not_found", "That review is not here.");
    ctx.setSubject("review", input.id);
    if (saved.contactId) {
      await ctx.emitTimeline({
        contactId: saved.contactId,
        eventType: "review.replied",
        subjectType: "review",
        subjectId: input.id,
      });
    }
    ctx.queueEvent("review.replied", { id: input.id });
    return saved;
  },
});

/** Everything, for the owner: pending, published, withheld and rejected. */
export const listReviews = defineService({
  name: "reviews.list",
  summary: "Every review, for moderation.",
  kind: "query",
  permission: "scoped",
  input: z.object({
    status: z.enum(REVIEW_STATES).optional(),
    limit: z.number().int().min(1).max(200).default(100),
  }),
  output: listed(reviewRow),
  handler: async (input, ctx) => {
    const rows = await ctx.tx
      .select()
      .from(reviews)
      .where(input.status ? eq(reviews.status, input.status) : undefined)
      .orderBy(desc(reviews.createdAt))
      .limit(input.limit);
    return rows;
  },
});

/** What a review wall shows: approved only, newest first. */
export const publishedReviews = defineService({
  name: "reviews.published",
  summary: "Approved reviews for one subject.",
  kind: "query",
  permission: "public",
  input: z.object({
    subjectType: z.enum(REVIEW_SUBJECTS).default("business"),
    subjectId: id.nullish(),
    location: z.string().trim().max(60).optional(),
    limit: z.number().int().min(1).max(50).default(12),
  }),
  output: listed(
    reviewRow.omit({ contactId: true }).extend({ assetIds: listed(uuid) }),
  ),
  handler: async (input, ctx) => {
    const rows = await ctx.tx
      .select()
      .from(reviews)
      .where(
        and(
          eq(reviews.status, "approved"),
          eq(reviews.subjectType, input.subjectType),
          input.subjectId
            ? eq(reviews.subjectId, input.subjectId)
            : isNull(reviews.subjectId),
          input.location
            ? sql`${input.location} = any(${reviews.displayLocations})`
            : undefined,
        ),
      )
      .orderBy(desc(reviews.createdAt))
      .limit(input.limit);
    const media = rows.length
      ? await ctx.tx
          .select()
          .from(reviewMedia)
          .where(inArray(reviewMedia.reviewId, rows.map((r) => r.id)))
          .orderBy(asc(reviewMedia.position))
      : [];
    return rows.map((review) => ({
      ...publicReview(review),
      assetIds: media.filter((m) => m.reviewId === review.id).map((m) => m.assetId),
    }));
  },
});

// ── Spine ────────────────────────────────────────────────────────────────────

registerContactReference({
  table: "reviews",
  repoint: (tx, duplicateId, survivingId) =>
    tx.update(reviews).set({ contactId: survivingId }).where(eq(reviews.contactId, duplicateId)),
  captureForUndo: async (tx, duplicateId, survivingId) => ({
    state: await tx
      .select({ id: reviews.id, contactId: reviews.contactId })
      .from(reviews)
      .where(inArray(reviews.contactId, [duplicateId, survivingId])),
    undoable: true,
  }),
  restoreAfterUndo: async (tx, beforeState, _afterState, duplicateId) => {
    const moved = z
      .array(z.object({ id: z.string().uuid(), contactId: z.string().uuid() }))
      .parse(beforeState)
      .filter((review) => review.contactId === duplicateId);
    if (moved.length) {
      await tx
        .update(reviews)
        .set({ contactId: duplicateId })
        .where(inArray(reviews.id, moved.map((review) => review.id)));
    }
  },
});

registerContactReference({
  table: "review_requests",
  // Unique per person and subject, so merging two people who were both asked
  // about one thing would collide. The survivor's ask wins; the duplicate's
  // is dropped, because two links to the same question is one question.
  repoint: async (tx, duplicateId, survivingId) => {
    const duplicates = await tx
      .select()
      .from(reviewRequests)
      .where(eq(reviewRequests.contactId, duplicateId));
    for (const request of duplicates) {
      const [survivor] = await tx
        .select({ id: reviewRequests.id })
        .from(reviewRequests)
        .where(
          and(
            eq(reviewRequests.contactId, survivingId),
            eq(reviewRequests.subjectType, request.subjectType),
            request.subjectId
              ? eq(reviewRequests.subjectId, request.subjectId)
              : isNull(reviewRequests.subjectId),
          ),
        )
        .limit(1);
      if (survivor) {
        await tx.delete(reviewRequests).where(eq(reviewRequests.id, request.id));
      } else {
        await tx
          .update(reviewRequests)
          .set({ contactId: survivingId })
          .where(eq(reviewRequests.id, request.id));
      }
    }
  },
  captureForUndo: async (tx, duplicateId, survivingId) => {
    const rows = await tx
      .select()
      .from(reviewRequests)
      .where(inArray(reviewRequests.contactId, [duplicateId, survivingId]));
    return { state: rows, undoable: rows.length === 0, blocker: rows.length > 0 ? "A review request was consolidated and cannot be restored." : undefined };
  },
  restoreAfterUndo: async () => undefined,
});

registerContactPrivacySource({
  scope: "contact.reviews",
  tables: ["reviews", "review_requests"],
  exportData: async (tx, contactId) => ({
    reviews: await tx.select().from(reviews).where(eq(reviews.contactId, contactId)),
    requests: await tx
      .select()
      .from(reviewRequests)
      .where(eq(reviewRequests.contactId, contactId)),
  }),
  erase: async (tx, contactId) => {
    // The rating stays and the name goes. A business's public rating is not
    // the reviewer's personal data to withdraw, and letting erasure move it
    // would make the number worth exactly nothing.
    const affected = await tx
      .update(reviews)
      .set({ contactId: null, displayName: null })
      .where(eq(reviews.contactId, contactId))
      .returning({ id: reviews.id });
    await tx.delete(reviewRequests).where(eq(reviewRequests.contactId, contactId));
    return { affected: affected.length };
  },
});

export default [
  aggregateRating,
  requestReview,
  submitReview,
  moderateReview,
  replyToReview,
  listReviews,
  publishedReviews,
];
