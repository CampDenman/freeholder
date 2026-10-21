// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Attachment shapes and storage (C12.21). A leaf module: posts and messages
// use it while they load, so it imports neither.
import { z } from "zod";
import { and, asc, eq, inArray } from "drizzle-orm";
import { row, uuid } from "@/core/contract";
import { assets } from "@/core/media/schema";
import { ServiceError, type ServiceContext } from "@/core/service";
import type { ATTACHMENT_PARENTS} from "./schema";
import { memberAttachments } from "./schema";

export type Parent = (typeof ATTACHMENT_PARENTS)[number];

export const MAX_ATTACHMENTS = 4;

export const attachmentInput = z
  .array(z.object({ assetId: uuid, altText: z.string().trim().max(500).default("") }))
  .max(MAX_ATTACHMENTS)
  .default([]);

export const attachmentShape = row({
  id: uuid,
  kind: z.enum(["image", "video"]),
  altText: z.string(),
  width: z.number().int().nullable(),
  height: z.number().int().nullable(),
});

/** Attach the member's own ready, cleared images and videos to a parent. */
export async function attachFiles(
  ctx: ServiceContext,
  ownerId: string,
  parentType: Parent,
  parentId: string,
  items: z.infer<typeof attachmentInput>,
): Promise<void> {
  if (items.length === 0) return;
  const ids = items.map((i) => i.assetId);
  if (new Set(ids).size !== ids.length) throw new ServiceError("validation", "Attach each file once.");
  const rows = await ctx.tx.select().from(assets).where(inArray(assets.id, ids)).for("update");
  for (const id of ids) {
    const asset = rows.find((a) => a.id === id);
    const usable =
      asset &&
      (asset.kind === "image" || asset.kind === "video") &&
      asset.status === "ready" &&
      (asset.scanStatus === "clean" || asset.scanStatus === "not_configured") &&
      asset.uploadedBy === `user:${ownerId}`;
    if (!usable) throw new ServiceError("validation", "Attach images or videos you uploaded that have finished processing.");
  }
  const taken = await ctx.tx.select({ assetId: memberAttachments.assetId }).from(memberAttachments).where(inArray(memberAttachments.assetId, ids));
  if (taken.length) throw new ServiceError("conflict", "That file is already attached to something else.");
  await ctx.tx.insert(memberAttachments).values(
    items.map((item, position) => ({ ownerId, assetId: item.assetId, parentType, parentId, altText: item.altText, position })),
  );
  for (const item of items) {
    await ctx.tx.update(assets).set({ isPrivate: true, altText: item.altText || null, updatedAt: new Date() }).where(eq(assets.id, item.assetId));
  }
}

/** The attachments of these parents, keyed by parent id, in order. */
export async function attachmentsFor(ctx: ServiceContext, parentType: Parent, parentIds: string[]) {
  const out = new Map<string, z.infer<typeof attachmentShape>[]>();
  if (parentIds.length === 0) return out;
  const rows = await ctx.tx
    .select({ attachment: memberAttachments, kind: assets.kind, width: assets.width, height: assets.height, status: assets.status })
    .from(memberAttachments)
    .innerJoin(assets, eq(assets.id, memberAttachments.assetId))
    .where(and(eq(memberAttachments.parentType, parentType), inArray(memberAttachments.parentId, parentIds)))
    .orderBy(asc(memberAttachments.position));
  for (const r of rows) {
    if (r.status !== "ready" || (r.kind !== "image" && r.kind !== "video")) continue;
    const list = out.get(r.attachment.parentId) ?? [];
    list.push({ id: r.attachment.id, kind: r.kind, altText: r.attachment.altText, width: r.width, height: r.height });
    out.set(r.attachment.parentId, list);
  }
  return out;
}

