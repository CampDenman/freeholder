// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Avatars and profile sections (MASTER.md §44.3, C12.20).
//
// A member's avatar and portfolio images are ordinary media uploads
// (`media.upload`: validated, scanned, with responsive variants) that the
// member uploaded themselves. Each profile section carries its own
// visibility, checked with the same rules as posts.
import { z } from "zod";
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { listed, okResult, row, timestamp, uuid } from "@/core/contract";
import { assets } from "@/core/media/schema";
import { defineService, ServiceError, type ServiceContext } from "@/core/service";
import { storage } from "@/adapters/storage";
import { canSee, relationBetween } from "./graph";
import { memberPosts, memberProfileSections, memberProfiles, PROFILE_SECTION_KINDS } from "./schema";
import { VISIBILITIES } from "./visibility";

const MAX_SECTIONS = 10;
const MAX_ITEMS = 24;

type Variants = Partial<Record<"webp" | "avif", { width: number; key: string }[]>>;

/** A URL for the best rendition of an image at about this width. */
export async function imageUrl(asset: { storageKey: string; variants: unknown }, width: number): Promise<string> {
  const webp = ((asset.variants ?? {}) as Variants).webp ?? [];
  const pick = [...webp].sort((a, b) => a.width - b.width).find((v) => v.width >= width) ?? webp.at(-1);
  return storage().url(pick?.key ?? asset.storageKey);
}

/** The member's own ready, cleared images among these ids, in the order given. */
async function ownImages(ctx: ServiceContext, userId: string, ids: string[]) {
  if (ids.length === 0) return [];
  const rows = await ctx.tx.select().from(assets).where(inArray(assets.id, ids));
  const usable = rows.filter(
    (a) => a.kind === "image" && a.status === "ready" && (a.scanStatus === "clean" || a.scanStatus === "not_configured") && a.uploadedBy === `user:${userId}`,
  );
  return ids.map((id) => usable.find((a) => a.id === id)).filter((a): a is (typeof usable)[number] => Boolean(a));
}

export async function avatarUrlFor(ctx: ServiceContext, assetId: string | null, ownerId: string): Promise<string | null> {
  if (!assetId) return null;
  const [asset] = await ownImages(ctx, ownerId, [assetId]);
  return asset ? imageUrl(asset, 256) : null;
}

function me(ctx: ServiceContext): string {
  if (ctx.actor.kind !== "user") throw new ServiceError("permission", "Sign in to continue.");
  return ctx.actor.userId;
}

async function activeMember(ctx: ServiceContext) {
  const userId = me(ctx);
  const [profile] = await ctx.tx.select().from(memberProfiles).where(eq(memberProfiles.userId, userId));
  if (profile?.status !== "active") throw new ServiceError("permission", "Join the site first.");
  return profile;
}

export const setAvatar = defineService({
  name: "members.setAvatar",
  summary: "Use one of your uploaded images as your avatar, or remove it.",
  kind: "mutation",
  permission: "authenticated",
  writeClass: "write",
  input: z.object({ assetId: uuid.nullable() }),
  output: z.object({ avatarUrl: z.string().nullable() }),
  handler: async (input, ctx) => {
    const profile = await activeMember(ctx);
    if (input.assetId && !(await ownImages(ctx, profile.userId, [input.assetId])).length) {
      throw new ServiceError("validation", "Choose an image you uploaded that has finished processing.");
    }
    await ctx.tx.update(memberProfiles).set({ avatarAssetId: input.assetId, updatedAt: new Date() }).where(eq(memberProfiles.userId, profile.userId));
    ctx.setSubject("member", profile.userId);
    return { avatarUrl: await avatarUrlFor(ctx, input.assetId, profile.userId) };
  },
});

const sectionInput = z.object({
  id: uuid.optional(),
  kind: z.enum(PROFILE_SECTION_KINDS),
  title: z.string().trim().min(1).max(80),
  body: z.string().trim().max(5000).default(""),
  items: z.array(uuid).max(MAX_ITEMS).default([]),
  visibility: z.enum(VISIBILITIES).default("public"),
  position: z.number().int().min(0).max(100).default(0),
});

export const saveProfileSection = defineService({
  name: "members.saveProfileSection",
  summary: "Add or change a section on your profile — text, a portfolio of your images, the services you offer, or pinned posts — with its own visibility.",
  kind: "mutation",
  permission: "authenticated",
  writeClass: "write",
  input: sectionInput,
  output: z.object({ id: uuid }),
  handler: async (input, ctx) => {
    const profile = await activeMember(ctx);
    let items = input.items;
    if (input.kind === "portfolio") {
      items = (await ownImages(ctx, profile.userId, items)).map((a) => a.id);
      if (items.length !== input.items.length) throw new ServiceError("validation", "A portfolio can only hold images you uploaded.");
    } else if (input.kind === "pinned") {
      const own = items.length
        ? await ctx.tx
            .select({ id: memberPosts.id })
            .from(memberPosts)
            .where(and(inArray(memberPosts.id, items), eq(memberPosts.authorId, profile.userId), isNull(memberPosts.deletedAt)))
        : [];
      if (own.length !== items.length) throw new ServiceError("validation", "You can only pin your own posts.");
    } else {
      items = [];
    }
    const values = { kind: input.kind, title: input.title, body: input.body, items, visibility: input.visibility, position: input.position, updatedAt: new Date() };
    if (input.id) {
      const [updated] = await ctx.tx
        .update(memberProfileSections)
        .set(values)
        .where(and(eq(memberProfileSections.id, input.id), eq(memberProfileSections.userId, profile.userId)))
        .returning({ id: memberProfileSections.id });
      if (!updated) throw new ServiceError("not_found", "That section is not yours.");
      ctx.setSubject("member_profile_section", updated.id);
      return updated;
    }
    const existing = await ctx.tx.select({ id: memberProfileSections.id }).from(memberProfileSections).where(eq(memberProfileSections.userId, profile.userId));
    if (existing.length >= MAX_SECTIONS) throw new ServiceError("conflict", `A profile can have up to ${MAX_SECTIONS} sections.`);
    const [created] = await ctx.tx.insert(memberProfileSections).values({ userId: profile.userId, ...values }).returning({ id: memberProfileSections.id });
    ctx.setSubject("member_profile_section", created!.id);
    return created!;
  },
});

export const deleteProfileSection = defineService({
  name: "members.deleteProfileSection",
  summary: "Remove a section from your profile.",
  kind: "mutation",
  permission: "authenticated",
  writeClass: "write",
  input: z.object({ id: uuid }),
  output: okResult,
  handler: async (input, ctx) => {
    const userId = me(ctx);
    const [gone] = await ctx.tx
      .delete(memberProfileSections)
      .where(and(eq(memberProfileSections.id, input.id), eq(memberProfileSections.userId, userId)))
      .returning({ id: memberProfileSections.id });
    if (!gone) throw new ServiceError("not_found", "That section is not yours.");
    return { ok: true as const };
  },
});

export const profileSections = defineService({
  name: "members.profileSections",
  summary: "The sections on a member's profile that you are allowed to see.",
  kind: "query",
  permission: "public",
  input: z.object({ handle: z.string().trim().toLowerCase().max(60) }),
  output: listed(
    row({
      id: uuid,
      kind: z.enum(PROFILE_SECTION_KINDS),
      title: z.string(),
      body: z.string(),
      visibility: z.enum(VISIBILITIES),
      images: listed(row({ id: uuid, url: z.string(), altText: z.string().nullable() })),
      posts: listed(row({ id: uuid, body: z.string(), createdAt: timestamp })),
    }),
  ),
  handler: async (input, ctx) => {
    const viewerId = ctx.actor.kind === "user" ? ctx.actor.userId : null;
    const [owner] = await ctx.tx.select().from(memberProfiles).where(eq(memberProfiles.handle, input.handle));
    if (!owner || (owner.status !== "active" && owner.userId !== viewerId)) throw new ServiceError("not_found", "That member is not available.");
    const relation = await relationBetween(ctx, viewerId, owner.userId);
    if (relation.blocked) return [];
    const sections = (
      await ctx.tx.select().from(memberProfileSections).where(eq(memberProfileSections.userId, owner.userId)).orderBy(asc(memberProfileSections.position), asc(memberProfileSections.createdAt))
    ).filter((s) => canSee(s.visibility, relation));
    const out = [];
    for (const s of sections) {
      const images = s.kind === "portfolio" ? await ownImages(ctx, owner.userId, s.items) : [];
      // Pinning never widens a post's audience: each pinned post is checked on its own.
      const pinned = s.kind === "pinned" && s.items.length
        ? (await ctx.tx.select().from(memberPosts).where(and(inArray(memberPosts.id, s.items), isNull(memberPosts.deletedAt), eq(memberPosts.adult, false))))
            .filter((p) => canSee(p.visibility, relation))
        : [];
      out.push({
        id: s.id,
        kind: s.kind,
        title: s.title,
        body: s.body,
        visibility: s.visibility,
        images: await Promise.all(images.map(async (a) => ({ id: a.id, url: await imageUrl(a, 640), altText: a.altText }))),
        posts: s.items.map((id) => pinned.find((p) => p.id === id)).filter((p): p is (typeof pinned)[number] => Boolean(p)).map((p) => ({ id: p.id, body: p.body, createdAt: p.createdAt })),
      });
    }
    return out;
  },
});

export const pinPost = defineService({
  name: "members.pinPost",
  summary: "Pin one of your posts to your profile, or unpin it.",
  kind: "mutation",
  permission: "authenticated",
  writeClass: "write",
  input: z.object({ postId: uuid, pinned: z.boolean() }),
  output: okResult,
  handler: async (input, ctx) => {
    const profile = await activeMember(ctx);
    const [post] = await ctx.tx
      .select({ id: memberPosts.id })
      .from(memberPosts)
      .where(and(eq(memberPosts.id, input.postId), eq(memberPosts.authorId, profile.userId), isNull(memberPosts.deletedAt)));
    if (!post) throw new ServiceError("not_found", "You can only pin your own posts.");
    const [section] = await ctx.tx
      .select()
      .from(memberProfileSections)
      .where(and(eq(memberProfileSections.userId, profile.userId), eq(memberProfileSections.kind, "pinned")));
    const items = (section?.items ?? []).filter((id) => id !== post.id);
    if (input.pinned) items.unshift(post.id);
    if (items.length > MAX_ITEMS) throw new ServiceError("conflict", `You can pin up to ${MAX_ITEMS} posts.`);
    if (section) {
      await ctx.tx.update(memberProfileSections).set({ items, updatedAt: new Date() }).where(eq(memberProfileSections.id, section.id));
    } else if (input.pinned) {
      await ctx.call(saveProfileSection, { kind: "pinned", title: "Pinned", items, visibility: "public", position: 0 });
    }
    return { ok: true as const };
  },
});

export default [setAvatar, saveProfileSection, deleteProfileSection, profileSections, pinPost];
