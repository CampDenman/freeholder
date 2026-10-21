// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Images and video on posts, comments and messages (MASTER.md §44.4, C12.21).
//
// Files arrive through `media.upload` (validated, scanned, with responsive
// image variants). Attaching one makes the asset private, so the public media
// route refuses it; it is served only by `/m/file/[id]`, which asks
// `members.fileAccess` whether this viewer can see the file's parent — the
// same rules as the post, comment or conversation itself, so a file is never
// seen by anyone who could not see what it is attached to.
import { z } from "zod";
import { and, eq, isNull } from "drizzle-orm";
import { listed, row, uuid } from "@/core/contract";
import { assets } from "@/core/media/schema";
import { defineService, ServiceError, type ServiceContext } from "@/core/service";
import { attachmentShape, attachmentsFor, type Parent } from "./attachment-store";
import { relationBetween } from "./graph";
import { visiblePost } from "./posts";
export { attachFiles, attachmentInput, attachmentShape, attachmentsFor, MAX_ATTACHMENTS } from "./attachment-store";
import {
  ATTACHMENT_PARENTS,
  memberAttachments,
  memberComments,
  memberConversationParticipants,
  memberMessages,
  memberRelations,
} from "./schema";

async function canSeeParent(ctx: ServiceContext, viewerId: string | null, type: Parent, id: string): Promise<boolean> {
  try {
    if (type === "post") {
      await visiblePost(ctx, viewerId, id);
      return true;
    }
    if (type === "comment") {
      const [comment] = await ctx.tx.select().from(memberComments).where(and(eq(memberComments.id, id), isNull(memberComments.deletedAt)));
      if (!comment) return false;
      const { post } = await visiblePost(ctx, viewerId, comment.postId);
      const [restricted] = await ctx.tx
        .select({ kind: memberRelations.kind })
        .from(memberRelations)
        .where(and(eq(memberRelations.ownerId, post.authorId), eq(memberRelations.targetId, comment.authorId), eq(memberRelations.kind, "restrict")));
      if (restricted && viewerId !== comment.authorId && viewerId !== post.authorId) return false;
      if (viewerId && viewerId !== comment.authorId && (await relationBetween(ctx, viewerId, comment.authorId)).blocked) return false;
      return true;
    }
    if (!viewerId) return false;
    const [message] = await ctx.tx.select().from(memberMessages).where(and(eq(memberMessages.id, id), isNull(memberMessages.deletedAt)));
    if (!message) return false;
    const [seat] = await ctx.tx
      .select({ state: memberConversationParticipants.state })
      .from(memberConversationParticipants)
      .where(and(eq(memberConversationParticipants.conversationId, message.conversationId), eq(memberConversationParticipants.userId, viewerId)));
    return Boolean(seat && seat.state !== "left");
  } catch (error) {
    if (error instanceof ServiceError) return false;
    throw error;
  }
}

type Variants = Partial<Record<"webp" | "avif", { width: number; key: string; bytes?: number }[]>>;

export const fileAccess = defineService({
  name: "members.fileAccess",
  summary: "Where to read one attached file from, if you can see what it is attached to.",
  kind: "query",
  permission: "public",
  external: false,
  input: z.object({ id: uuid, width: z.number().int().min(1).max(4096).optional() }),
  output: row({ key: z.string(), contentType: z.string() }).nullable(),
  handler: async (input, ctx) => {
    const viewerId = ctx.actor.kind === "user" ? ctx.actor.userId : null;
    const [found] = await ctx.tx
      .select({ attachment: memberAttachments, asset: assets })
      .from(memberAttachments)
      .innerJoin(assets, eq(assets.id, memberAttachments.assetId))
      .where(eq(memberAttachments.id, input.id));
    if (!found || found.asset.status !== "ready") return null;
    if (!(await canSeeParent(ctx, viewerId, found.attachment.parentType, found.attachment.parentId))) return null;
    if (found.asset.kind === "image" && input.width) {
      const webp = ((found.asset.variants ?? {}) as Variants).webp ?? [];
      const pick = [...webp].sort((a, b) => a.width - b.width).find((v) => v.width >= input.width!);
      if (pick) return { key: pick.key, contentType: "image/webp" };
    }
    return { key: found.asset.storageKey, contentType: found.asset.mime };
  },
});

export const attachmentsOf = defineService({
  name: "members.attachments",
  summary: "The files attached to one post, comment or message you can see.",
  kind: "query",
  permission: "public",
  input: z.object({ parentType: z.enum(ATTACHMENT_PARENTS), parentId: uuid }),
  output: listed(attachmentShape),
  handler: async (input, ctx) => {
    const viewerId = ctx.actor.kind === "user" ? ctx.actor.userId : null;
    if (!(await canSeeParent(ctx, viewerId, input.parentType, input.parentId))) throw new ServiceError("not_found", "That is not available.");
    return (await attachmentsFor(ctx, input.parentType, [input.parentId])).get(input.parentId) ?? [];
  },
});

export default [fileAccess, attachmentsOf];
