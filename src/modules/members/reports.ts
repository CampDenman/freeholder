// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Trust and safety (MASTER.md §44.9, C12.12).
//
// Any member can report anything they can see: a post, a comment, a message
// sent to them, a listing, a review or a member. Reports land in one queue
// where site staff remove the thing, suspend the member responsible, or
// dismiss. Every decision goes through a service, so the core audit trail
// records who did what, and the report keeps the outcome and the reason. The
// author hears what was removed and why; reporters hear that it was handled.
import { z } from "zod";
import { and, desc, eq, isNull } from "drizzle-orm";
import { listed, okResult, row, timestamp, uuid } from "@/core/contract";
import { defineService, ServiceError, type ServiceContext } from "@/core/service";
import { archiveProduct, getProduct } from "@/modules/catalog/service";
import { openMessage } from "./message-crypto";
import { notifyMember } from "./notify";
import { applyMemberStatus } from "./status";
import { visiblePost } from "./posts";
import {
  memberComments,
  memberConversationParticipants,
  memberListings,
  memberMessages,
  memberPosts,
  memberProfiles,
  memberReports,
  memberReviews,
  REPORT_REASONS,
  REPORT_TARGETS,
} from "./schema";

type Target = (typeof REPORT_TARGETS)[number];

const unavailable = () => new ServiceError("not_found", "That is not available to report.");
const clip = (text: string) => (text.length > 500 ? `${text.slice(0, 499)}…` : text);

/** Who is responsible for a target, and what the reporter saw, if the reporter can see it. */
async function resolveTarget(ctx: ServiceContext, me: string, type: Target, id: string): Promise<{ subjectId: string; excerpt: string }> {
  switch (type) {
    case "post": {
      const { post } = await visiblePost(ctx, me, id).catch(() => { throw unavailable(); });
      return { subjectId: post.authorId, excerpt: clip(post.body) };
    }
    case "comment": {
      const [comment] = await ctx.tx.select().from(memberComments).where(and(eq(memberComments.id, id), isNull(memberComments.deletedAt)));
      if (!comment) throw unavailable();
      await visiblePost(ctx, me, comment.postId).catch(() => { throw unavailable(); });
      return { subjectId: comment.authorId, excerpt: clip(comment.body) };
    }
    case "message": {
      // Only a participant can report a message, which is also what lets the
      // site read that one message: the reporter chose to show it.
      const [message] = await ctx.tx.select().from(memberMessages).where(and(eq(memberMessages.id, id), isNull(memberMessages.deletedAt)));
      if (!message?.senderId) throw unavailable();
      const [seat] = await ctx.tx
        .select({ state: memberConversationParticipants.state })
        .from(memberConversationParticipants)
        .where(and(eq(memberConversationParticipants.conversationId, message.conversationId), eq(memberConversationParticipants.userId, me)));
      if (!seat || seat.state === "left") throw unavailable();
      return { subjectId: message.senderId, excerpt: clip(openMessage(message.bodySealed, message.id)) };
    }
    case "listing": {
      const [listing] = await ctx.tx.select().from(memberListings).where(and(eq(memberListings.productId, id), eq(memberListings.review, "approved")));
      if (!listing) throw unavailable();
      const { product } = await ctx.callAsSystem(getProduct, { id });
      if (product.status !== "active") throw unavailable();
      return { subjectId: listing.sellerId, excerpt: clip(product.name) };
    }
    case "review": {
      const [review] = await ctx.tx.select().from(memberReviews).where(and(eq(memberReviews.id, id), isNull(memberReviews.hiddenAt)));
      if (!review || (review.revealAt > new Date() && review.authorId !== me)) throw unavailable();
      return { subjectId: review.authorId, excerpt: clip(review.body || `${review.rating}/5`) };
    }
    case "member": {
      const [profile] = await ctx.tx.select().from(memberProfiles).where(and(eq(memberProfiles.userId, id), eq(memberProfiles.status, "active")));
      if (!profile) throw unavailable();
      return { subjectId: profile.userId, excerpt: clip(`${profile.displayName} (@${profile.handle})${profile.bio ? ` — ${profile.bio}` : ""}`) };
    }
  }
}

export const reportContent = defineService({
  name: "members.report",
  summary: "Report a post, comment, message, listing, review or member to the site's moderators.",
  kind: "mutation",
  permission: "authenticated",
  writeClass: "write",
  rateLimit: { limit: 30, windowSeconds: 3600, message: "You have sent a lot of reports. Please wait a little.", subject: (_i, actor) => (actor.kind === "user" ? actor.userId : undefined) },
  input: z.object({
    targetType: z.enum(REPORT_TARGETS),
    targetId: uuid,
    reason: z.enum(REPORT_REASONS),
    details: z.string().trim().max(2000).default(""),
  }),
  output: okResult,
  handler: async (input, ctx) => {
    if (ctx.actor.kind !== "user") throw new ServiceError("permission", "Sign in to continue.");
    const me = ctx.actor.userId;
    const [reporter] = await ctx.tx.select({ status: memberProfiles.status }).from(memberProfiles).where(eq(memberProfiles.userId, me));
    if (reporter?.status !== "active") throw new ServiceError("permission", "Join the site to report something.");
    const target = await resolveTarget(ctx, me, input.targetType, input.targetId);
    if (target.subjectId === me) throw new ServiceError("validation", "You cannot report your own content.");
    const [created] = await ctx.tx
      .insert(memberReports)
      .values({ reporterId: me, targetType: input.targetType, targetId: input.targetId, subjectId: target.subjectId, reason: input.reason, details: input.details, excerpt: target.excerpt })
      .onConflictDoNothing()
      .returning({ id: memberReports.id });
    // Reporting the same thing twice is not an error: the first report stands.
    if (created) {
      ctx.setSubject("member_report", created.id);
      ctx.queueEvent("member.reported", { reportId: created.id, targetType: input.targetType });
    }
    return { ok: true as const };
  },
});

const reportRow = row({
  id: uuid,
  targetType: z.enum(REPORT_TARGETS),
  targetId: uuid,
  reason: z.enum(REPORT_REASONS),
  details: z.string(),
  excerpt: z.string(),
  state: z.enum(["open", "actioned", "dismissed"]),
  action: z.enum(["removed", "suspended", "dismissed"]).nullable(),
  resolutionNote: z.string().nullable(),
  subject: row({ userId: uuid, handle: z.string(), displayName: z.string(), status: z.string() }),
  reporterCount: z.number().int(),
  createdAt: timestamp,
  resolvedAt: timestamp.nullable(),
});

export const listReports = defineService({
  name: "members.reports",
  summary: "The moderation queue: open reports grouped by what was reported, or recent decisions.",
  kind: "query",
  permission: "scoped",
  input: z.object({ state: z.enum(["open", "actioned", "dismissed"]).default("open") }),
  output: listed(reportRow),
  handler: async (input, ctx) => {
    const rows = await ctx.tx
      .select({ report: memberReports, handle: memberProfiles.handle, displayName: memberProfiles.displayName, status: memberProfiles.status })
      .from(memberReports)
      .innerJoin(memberProfiles, eq(memberProfiles.userId, memberReports.subjectId))
      .where(eq(memberReports.state, input.state))
      .orderBy(input.state === "open" ? memberReports.createdAt : desc(memberReports.resolvedAt))
      .limit(500);
    // One queue entry per reported thing; the earliest report leads.
    const byTarget = new Map<string, { lead: (typeof rows)[number]; count: number }>();
    for (const r of rows) {
      const key = `${r.report.targetType}:${r.report.targetId}`;
      const seen = byTarget.get(key);
      if (seen) seen.count += 1;
      else byTarget.set(key, { lead: r, count: 1 });
    }
    return [...byTarget.values()].slice(0, 200).map(({ lead: { report, handle, displayName, status }, count }) => ({
      id: report.id,
      targetType: report.targetType,
      targetId: report.targetId,
      reason: report.reason,
      details: report.details,
      excerpt: report.excerpt,
      state: report.state,
      action: report.action,
      resolutionNote: report.resolutionNote,
      subject: { userId: report.subjectId, handle, displayName, status },
      reporterCount: count,
      createdAt: report.createdAt,
      resolvedAt: report.resolvedAt,
    }));
  },
});

async function removeTarget(ctx: ServiceContext, type: Target, id: string, note: string): Promise<void> {
  const now = new Date();
  switch (type) {
    case "post": await ctx.tx.update(memberPosts).set({ deletedAt: now }).where(eq(memberPosts.id, id)); return;
    case "comment": await ctx.tx.update(memberComments).set({ deletedAt: now }).where(eq(memberComments.id, id)); return;
    case "message": await ctx.tx.update(memberMessages).set({ deletedAt: now }).where(eq(memberMessages.id, id)); return;
    case "review": await ctx.tx.update(memberReviews).set({ hiddenAt: now }).where(eq(memberReviews.id, id)); return;
    case "listing": {
      // Rejecting the listing keeps it down: a seller can only put back up a
      // listing the site approved.
      await ctx.tx.update(memberListings).set({ review: "rejected", reviewNote: note, reviewedAt: now }).where(eq(memberListings.productId, id));
      const { product } = await ctx.callAsSystem(getProduct, { id });
      if (product.status !== "archived") await ctx.callAsSystem(archiveProduct, { id, expectedVersion: product.version, reason: `Removed after a report: ${note}` });
      return;
    }
    case "member": throw new ServiceError("validation", "A member cannot be removed; suspend them instead.");
  }
}

export const resolveReport = defineService({
  name: "members.resolveReport",
  summary: "Decide a report: remove the reported thing, suspend the member responsible, both, or dismiss. Every open report on the same thing is decided together.",
  kind: "mutation",
  permission: "scoped",
  writeClass: "write",
  input: z.object({
    id: uuid,
    decision: z.enum(["remove", "suspend", "remove_and_suspend", "dismiss"]),
    note: z.string().trim().max(1000).default(""),
  }),
  output: z.object({ resolved: z.number().int() }),
  handler: async (input, ctx) => {
    const [report] = await ctx.tx.select().from(memberReports).where(eq(memberReports.id, input.id)).for("update");
    if (!report) throw new ServiceError("not_found", "That report does not exist.");
    if (report.state !== "open") throw new ServiceError("conflict", "That report was already decided.");
    if (input.decision !== "dismiss" && input.note.length < 5) {
      throw new ServiceError("validation", "Say why, in a sentence the member will see.");
    }
    const removes = input.decision === "remove" || input.decision === "remove_and_suspend";
    const suspends = input.decision === "suspend" || input.decision === "remove_and_suspend";
    if (removes) await removeTarget(ctx, report.targetType, report.targetId, input.note);
    if (suspends) await applyMemberStatus(ctx, report.subjectId, "suspended", input.note);
    const actorId = ctx.actor.kind === "user" ? ctx.actor.userId : null;
    const decided = await ctx.tx
      .update(memberReports)
      .set({
        state: input.decision === "dismiss" ? "dismissed" : "actioned",
        action: suspends ? "suspended" : removes ? "removed" : "dismissed",
        resolutionNote: input.note || null,
        resolvedBy: actorId,
        resolvedAt: new Date(),
      })
      .where(and(eq(memberReports.targetType, report.targetType), eq(memberReports.targetId, report.targetId), eq(memberReports.state, "open")))
      .returning({ id: memberReports.id, reporterId: memberReports.reporterId });
    if (removes) {
      await notifyMember(ctx, { to: report.subjectId, from: report.subjectId, topic: "members.safety", key: `members.notify.removed.${report.targetType}`, href: "/portal/member", idempotencyKey: `member-removed:${report.id}` });
    }
    if (input.decision !== "dismiss") {
      const reporters = decided.map((d) => d.reporterId).filter((r): r is string => r !== null);
      for (const to of reporters) {
        await notifyMember(ctx, { to, from: to, topic: "members.safety", key: "members.notify.reportActioned", href: "/portal/member", idempotencyKey: `member-report-actioned:${report.id}:${to}` });
      }
    }
    ctx.setSubject("member_report", report.id);
    return { resolved: decided.length };
  },
});

export const myReports = defineService({
  name: "members.myReports",
  summary: "Reports you sent and what happened to them.",
  kind: "query",
  permission: "authenticated",
  input: z.object({}),
  output: listed(row({ id: uuid, targetType: z.enum(REPORT_TARGETS), reason: z.enum(REPORT_REASONS), excerpt: z.string(), state: z.enum(["open", "actioned", "dismissed"]), createdAt: timestamp })),
  handler: async (_input, ctx) => {
    if (ctx.actor.kind !== "user") throw new ServiceError("permission", "Sign in to continue.");
    const rows = await ctx.tx.select().from(memberReports).where(eq(memberReports.reporterId, ctx.actor.userId)).orderBy(desc(memberReports.createdAt)).limit(100);
    return rows.map((r) => ({ id: r.id, targetType: r.targetType, reason: r.reason, excerpt: r.excerpt, state: r.state, createdAt: r.createdAt }));
  },
});

export default [reportContent, listReports, resolveReport, myReports];
