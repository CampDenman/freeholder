// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Presence, comments, mentions and review threads (C2.03, C2.04).
import { and, asc, desc, eq, gt, isNull, lt } from "drizzle-orm";
import { z } from "zod";
import { actorString, defineService, ServiceError } from "@/core/service";
import {
  contentComments,
  contentPresence,
  contentRevisions,
  pages,
} from "./schema";

const pageId = z.string().uuid();
const commentId = z.string().uuid();
const PRESENCE_MS = 2 * 60 * 1000;
const ACTOR_MENTION =
  /user:[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/gi;

function collectMentions(body: string, explicit: string[] = []): string[] {
  const found = new Set<string>();
  for (const mention of explicit) {
    const trimmed = mention.trim();
    if (trimmed) found.add(trimmed);
  }
  for (const match of body.matchAll(ACTOR_MENTION)) {
    found.add(match[0].toLowerCase());
  }
  return [...found];
}

export const heartbeatPresence = defineService({
  name: "cms.heartbeatPresence",
  summary: "Record that this actor is looking at or editing a page.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({
    pageId,
    editing: z.boolean().default(false),
  }),
  handler: async (input, ctx) => {
    const [page] = await ctx.tx
      .select({ id: pages.id })
      .from(pages)
      .where(eq(pages.id, input.pageId))
      .limit(1);
    if (!page) throw new ServiceError("not_found", `no page with id ${input.pageId}`);
    const actor = actorString(ctx.actor);
    const now = new Date();
    await ctx.tx
      .insert(contentPresence)
      .values({
        pageId: input.pageId,
        actor,
        editing: input.editing,
        lastSeenAt: now,
      })
      .onConflictDoUpdate({
        target: [contentPresence.pageId, contentPresence.actor],
        set: { editing: input.editing, lastSeenAt: now },
      });
    ctx.setSubject("page", input.pageId);
    return { pageId: input.pageId, actor, lastSeenAt: now, editing: input.editing };
  },
});

export const listPresence = defineService({
  name: "cms.listPresence",
  summary: "Actors seen on a page inside the presence window.",
  kind: "query",
  permission: "scoped",
  input: z.object({ pageId }),
  handler: async (input, ctx) => {
    const since = new Date(Date.now() - PRESENCE_MS);
    return ctx.tx
      .select({
        actor: contentPresence.actor,
        editing: contentPresence.editing,
        lastSeenAt: contentPresence.lastSeenAt,
      })
      .from(contentPresence)
      .where(
        and(eq(contentPresence.pageId, input.pageId), gt(contentPresence.lastSeenAt, since)),
      )
      .orderBy(desc(contentPresence.lastSeenAt));
  },
});

export const leavePresence = defineService({
  name: "cms.leavePresence",
  summary: "Drop this actor's presence on a page.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({ pageId }),
  handler: async (input, ctx) => {
    const actor = actorString(ctx.actor);
    await ctx.tx
      .delete(contentPresence)
      .where(
        and(eq(contentPresence.pageId, input.pageId), eq(contentPresence.actor, actor)),
      );
    ctx.setSubject("page", input.pageId);
    return { pageId: input.pageId };
  },
});

export const expireStalePresence = defineService({
  name: "cms.expireStalePresence",
  summary: "Delete presence rows whose heartbeat has gone quiet.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({}),
  handler: async (_input, ctx) => {
    const cutoff = new Date(Date.now() - PRESENCE_MS);
    const deleted = await ctx.tx
      .delete(contentPresence)
      .where(lt(contentPresence.lastSeenAt, cutoff))
      .returning({ id: contentPresence.id });
    return { removed: deleted.length };
  },
});

export const addComment = defineService({
  name: "cms.addComment",
  summary: "Leave a comment or reply on a page's working draft, never on live copy.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({
    pageId,
    body: z.string().trim().min(1).max(4000),
    blockId: z.string().trim().min(1).max(80).optional(),
    revisionId: z.string().uuid().optional(),
    parentId: commentId.optional(),
    mentions: z.array(z.string().trim().min(1).max(80)).max(20).default([]),
  }),
  handler: async (input, ctx) => {
    const [page] = await ctx.tx
      .select({ id: pages.id })
      .from(pages)
      .where(eq(pages.id, input.pageId))
      .limit(1);
    if (!page) throw new ServiceError("not_found", `no page with id ${input.pageId}`);

    let parent: typeof contentComments.$inferSelect | undefined;
    if (input.parentId) {
      const [found] = await ctx.tx
        .select()
        .from(contentComments)
        .where(eq(contentComments.id, input.parentId))
        .limit(1);
      if (!found || found.pageId !== input.pageId) {
        throw new ServiceError("not_found", "that thread is gone");
      }
      if (found.parentId) {
        throw new ServiceError("validation", "Reply to the first comment in the thread.");
      }
      if (found.resolvedAt) {
        throw new ServiceError("conflict", "That thread is resolved. Reopen it to reply.");
      }
      parent = found;
    }

    if (input.revisionId) {
      const [revision] = await ctx.tx
        .select({ id: contentRevisions.id, subjectId: contentRevisions.subjectId })
        .from(contentRevisions)
        .where(eq(contentRevisions.id, input.revisionId))
        .limit(1);
      if (!revision || revision.subjectId !== input.pageId) {
        throw new ServiceError("not_found", "that version no longer exists");
      }
    }

    const mentions = collectMentions(input.body, input.mentions);
    const [row] = await ctx.tx
      .insert(contentComments)
      .values({
        pageId: input.pageId,
        revisionId: input.revisionId ?? parent?.revisionId ?? null,
        blockId: input.blockId ?? parent?.blockId ?? null,
        parentId: input.parentId ?? null,
        body: input.body,
        mentions,
        kind: "comment",
        createdBy: actorString(ctx.actor),
      })
      .returning();
    ctx.setSubject("page", input.pageId);
    ctx.queueEvent("cms.commentCreated", {
      pageId: input.pageId,
      commentId: row!.id,
      mentions,
    });
    return row!;
  },
});

export const listComments = defineService({
  name: "cms.listComments",
  summary: "Comments and review threads for a page, including resolved ones when asked.",
  kind: "query",
  permission: "scoped",
  input: z.object({
    pageId,
    includeResolved: z.boolean().default(false),
  }),
  handler: async (input, ctx) => {
    const rows = await ctx.tx
      .select()
      .from(contentComments)
      .where(eq(contentComments.pageId, input.pageId))
      .orderBy(asc(contentComments.createdAt));
    if (input.includeResolved) return rows;
    const resolvedRoots = new Set(
      rows.filter((row) => !row.parentId && row.resolvedAt).map((row) => row.id),
    );
    return rows.filter((row) => {
      if (row.resolvedAt) return false;
      if (row.parentId && resolvedRoots.has(row.parentId)) return false;
      return true;
    });
  },
});

export const resolveThread = defineService({
  name: "cms.resolveThread",
  summary: "Mark a comment thread resolved without deleting it.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({ id: commentId }),
  handler: async (input, ctx) => {
    const [row] = await ctx.tx
      .select()
      .from(contentComments)
      .where(eq(contentComments.id, input.id))
      .limit(1);
    if (!row) throw new ServiceError("not_found", "that thread is gone");
    const rootId = row.parentId ?? row.id;
    const actor = actorString(ctx.actor);
    const now = new Date();
    await ctx.tx
      .update(contentComments)
      .set({ resolvedAt: now, resolvedBy: actor })
      .where(
        and(
          eq(contentComments.pageId, row.pageId),
          isNull(contentComments.resolvedAt),
          eq(contentComments.id, rootId),
        ),
      );
    ctx.setSubject("page", row.pageId);
    ctx.queueEvent("cms.commentResolved", { pageId: row.pageId, commentId: rootId });
    const [updated] = await ctx.tx
      .select()
      .from(contentComments)
      .where(eq(contentComments.id, rootId))
      .limit(1);
    return updated!;
  },
});

export const reopenThread = defineService({
  name: "cms.reopenThread",
  summary: "Reopen a resolved comment thread.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({ id: commentId }),
  handler: async (input, ctx) => {
    const [row] = await ctx.tx
      .select()
      .from(contentComments)
      .where(eq(contentComments.id, input.id))
      .limit(1);
    if (!row) throw new ServiceError("not_found", "that thread is gone");
    const rootId = row.parentId ?? row.id;
    const [updated] = await ctx.tx
      .update(contentComments)
      .set({ resolvedAt: null, resolvedBy: null })
      .where(eq(contentComments.id, rootId))
      .returning();
    ctx.setSubject("page", row.pageId);
    ctx.queueEvent("cms.commentReopened", { pageId: row.pageId, commentId: rootId });
    return updated!;
  },
});

export const requestReview = defineService({
  name: "cms.requestReview",
  summary: "Ask a specific person to review a working draft or a block on it.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({
    pageId,
    reviewer: z.string().trim().min(1).max(80),
    body: z.string().trim().min(1).max(4000),
    blockId: z.string().trim().min(1).max(80).optional(),
    revisionId: z.string().uuid().optional(),
    mentions: z.array(z.string().trim().min(1).max(80)).max(20).default([]),
  }),
  handler: async (input, ctx) => {
    const [page] = await ctx.tx
      .select({ id: pages.id })
      .from(pages)
      .where(eq(pages.id, input.pageId))
      .limit(1);
    if (!page) throw new ServiceError("not_found", `no page with id ${input.pageId}`);
    if (input.revisionId) {
      const [revision] = await ctx.tx
        .select({ id: contentRevisions.id, subjectId: contentRevisions.subjectId })
        .from(contentRevisions)
        .where(eq(contentRevisions.id, input.revisionId))
        .limit(1);
      if (!revision || revision.subjectId !== input.pageId) {
        throw new ServiceError("not_found", "that version no longer exists");
      }
    }
    const mentions = collectMentions(input.body, [...input.mentions, input.reviewer]);
    const [row] = await ctx.tx
      .insert(contentComments)
      .values({
        pageId: input.pageId,
        revisionId: input.revisionId ?? null,
        blockId: input.blockId ?? null,
        body: input.body,
        mentions,
        kind: "review_request",
        reviewer: input.reviewer,
        reviewState: "requested",
        createdBy: actorString(ctx.actor),
      })
      .returning();
    ctx.setSubject("page", input.pageId);
    ctx.queueEvent("cms.reviewRequested", {
      pageId: input.pageId,
      commentId: row!.id,
      reviewer: input.reviewer,
    });
    return row!;
  },
});

export const decideReview = defineService({
  name: "cms.decideReview",
  summary: "Approve a review request or send the draft back with notes.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({
    id: commentId,
    approved: z.boolean(),
    note: z.string().trim().min(1).max(4000).optional(),
  }),
  handler: async (input, ctx) => {
    const [row] = await ctx.tx
      .select()
      .from(contentComments)
      .where(eq(contentComments.id, input.id))
      .limit(1);
    if (!row) throw new ServiceError("not_found", "that review request is gone");
    if (row.kind !== "review_request" || row.reviewState !== "requested") {
      throw new ServiceError("conflict", "That review is not waiting for a decision.");
    }
    const actor = actorString(ctx.actor);
    const reviewState = input.approved ? "approved" : "changes_requested";
    const [updated] = await ctx.tx
      .update(contentComments)
      .set({
        reviewState,
        resolvedAt: input.approved ? new Date() : row.resolvedAt,
        resolvedBy: input.approved ? actor : row.resolvedBy,
      })
      .where(eq(contentComments.id, row.id))
      .returning();
    if (input.note) {
      await ctx.tx.insert(contentComments).values({
        pageId: row.pageId,
        revisionId: row.revisionId,
        blockId: row.blockId,
        parentId: row.id,
        body: input.note,
        mentions: collectMentions(input.note),
        kind: "comment",
        createdBy: actor,
      });
    }
    ctx.setSubject("page", row.pageId);
    ctx.queueEvent("cms.reviewDecided", {
      pageId: row.pageId,
      commentId: row.id,
      approved: input.approved,
    });
    return updated!;
  },
});


