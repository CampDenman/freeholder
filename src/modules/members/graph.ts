// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Profiles and the social graph (MASTER.md §44.3–44.4, C12.02–C12.03).
//
// Every read that shows one member to another goes through `relationBetween`
// and `canSee`, so a block, a private account or a field's visibility is
// enforced in one place rather than remembered by each screen. Blocking is
// symmetric for visibility: neither side can see or reach the other.
import { avatarUrlFor } from "./profile";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { and, eq, inArray, or, sql } from "drizzle-orm";
import { listed, okResult, row } from "@/core/contract";
import { defineService, ServiceError, type Actor, type ServiceContext } from "@/core/service";
import {
  RELATION_KINDS,
  VISIBILITIES,
  memberFollows,
  memberFriendships,
  memberProfiles,
  memberRelations,
  type Visibility,
} from "./schema";
import { notifyMember } from "./notify";

export type Relation = {
  self: boolean;
  /** Either side blocked the other. */
  blocked: boolean;
  /** The viewer blocked the subject (so the viewer can undo it). */
  youBlocked: boolean;
  following: "none" | "requested" | "active";
  followsYou: boolean;
  friend: "none" | "you_asked" | "they_asked" | "friends";
  muted: boolean;
  restricted: boolean;
  /** The viewer pays for the subject's subscription (C12.05). */
  subscriber: boolean;
};

const NONE: Relation = {
  self: false,
  blocked: false,
  youBlocked: false,
  following: "none",
  followsYou: false,
  friend: "none",
  muted: false,
  restricted: false,
  subscriber: false,
};

function pair(a: string, b: string): [string, string] {
  return a < b ? [a, b] : [b, a];
}

/** How `viewerId` stands towards `subjectId`. Anonymous viewers pass null. */
export async function relationBetween(ctx: ServiceContext, viewerId: string | null, subjectId: string): Promise<Relation> {
  if (!viewerId) return NONE;
  if (viewerId === subjectId) return { ...NONE, self: true, friend: "friends", following: "active", subscriber: true };
  const [relations, follows, friendship] = await Promise.all([
    ctx.tx
      .select()
      .from(memberRelations)
      .where(
        or(
          and(eq(memberRelations.ownerId, viewerId), eq(memberRelations.targetId, subjectId)),
          and(eq(memberRelations.ownerId, subjectId), eq(memberRelations.targetId, viewerId), eq(memberRelations.kind, "block")),
        ),
      ),
    ctx.tx
      .select()
      .from(memberFollows)
      .where(
        or(
          and(eq(memberFollows.followerId, viewerId), eq(memberFollows.followeeId, subjectId)),
          and(eq(memberFollows.followerId, subjectId), eq(memberFollows.followeeId, viewerId)),
        ),
      ),
    ctx.tx
      .select()
      .from(memberFriendships)
      .where(and(eq(memberFriendships.lowId, pair(viewerId, subjectId)[0]), eq(memberFriendships.highId, pair(viewerId, subjectId)[1]))),
  ]);
  const mine = (kind: string) => relations.some((r) => r.ownerId === viewerId && r.kind === kind);
  const outgoing = follows.find((f) => f.followerId === viewerId);
  const incoming = follows.find((f) => f.followerId === subjectId);
  const friendRow = friendship[0];
  return {
    self: false,
    blocked: relations.some((r) => r.kind === "block"),
    youBlocked: mine("block"),
    following: outgoing ? outgoing.status : "none",
    followsYou: incoming?.status === "active",
    friend: !friendRow
      ? "none"
      : friendRow.status === "accepted"
        ? "friends"
        : friendRow.requestedBy === viewerId
          ? "you_asked"
          : "they_asked",
    muted: mine("mute"),
    restricted: mine("restrict"),
    subscriber: false,
  };
}

/** Whether a viewer with this relation may see something at `visibility`. */
export function canSee(visibility: Visibility, relation: Relation): boolean {
  if (relation.self) return true;
  if (relation.blocked) return false;
  switch (visibility) {
    case "public":
      return true;
    case "followers":
      return relation.following === "active" || relation.friend === "friends";
    case "friends":
      return relation.friend === "friends";
    case "subscribers":
      return relation.subscriber;
    case "only_me":
      return false;
  }
}

function viewer(actor: Actor): string | null {
  return actor.kind === "user" ? actor.userId : null;
}

function me(actor: Actor): string {
  if (actor.kind !== "user") throw new ServiceError("permission", "Sign in to continue.");
  return actor.userId;
}

/** The acting member, who must be active to reach anyone else. */
async function activeSelf(ctx: ServiceContext) {
  const userId = me(ctx.actor);
  const [found] = await ctx.tx.select().from(memberProfiles).where(eq(memberProfiles.userId, userId));
  if (!found) throw new ServiceError("permission", "Join the site first.");
  if (found.status !== "active") throw new ServiceError("permission", "Your membership is not active.");
  return found;
}

/** An active member another member can reach, or not_found — never "blocked". */
async function reachable(ctx: ServiceContext, handle: string, fromId: string) {
  const [found] = await ctx.tx
    .select()
    .from(memberProfiles)
    .where(and(eq(memberProfiles.handle, handle.toLowerCase()), eq(memberProfiles.status, "active")));
  if (!found || found.userId === fromId) throw new ServiceError("not_found", "That member is not available.");
  const relation = await relationBetween(ctx, fromId, found.userId);
  if (relation.blocked) throw new ServiceError("not_found", "That member is not available.");
  return { target: found, relation };
}

const handleInput = z.object({ handle: z.string().trim().toLowerCase().max(60) });
const person = row({ userId: z.string(), handle: z.string(), displayName: z.string() });
const relationShape = z.object({
  self: z.boolean(),
  blocked: z.boolean(),
  youBlocked: z.boolean(),
  following: z.enum(["none", "requested", "active"]),
  followsYou: z.boolean(),
  friend: z.enum(["none", "you_asked", "they_asked", "friends"]),
  muted: z.boolean(),
  restricted: z.boolean(),
  subscriber: z.boolean(),
});

async function counts(ctx: ServiceContext, userId: string) {
  const [result] = await ctx.tx.execute<{ followers: number; following: number; friends: number }>(sql`
    select
      (select count(*)::int from ${memberFollows} f join ${memberProfiles} p on p.user_id = f.follower_id and p.status = 'active'
        where f.followee_id = ${userId} and f.status = 'active') as followers,
      (select count(*)::int from ${memberFollows} f join ${memberProfiles} p on p.user_id = f.followee_id and p.status = 'active'
        where f.follower_id = ${userId} and f.status = 'active') as following,
      (select count(*)::int from ${memberFriendships} m where m.status = 'accepted' and (m.low_id = ${userId} or m.high_id = ${userId})) as friends
  `);
  return result ?? { followers: 0, following: 0, friends: 0 };
}

export const viewProfile = defineService({
  name: "members.profile",
  summary: "A member's profile as the viewer is allowed to see it.",
  kind: "query",
  permission: "public",
  input: handleInput,
  output: row({
    userId: z.string(),
    handle: z.string(),
    displayName: z.string(),
    isPrivate: z.boolean(),
    indexable: z.boolean(),
    bio: z.string().nullable(),
    links: z.array(z.object({ label: z.string(), url: z.string() })).nullable(),
    followers: z.number().int(),
    following: z.number().int(),
    friends: z.number().int(),
    avatarUrl: z.string().nullable(),
    relation: relationShape,
  }),
  handler: async (input, ctx) => {
    const viewerId = viewer(ctx.actor);
    const [found] = await ctx.tx.select().from(memberProfiles).where(eq(memberProfiles.handle, input.handle));
    if (!found || (found.status !== "active" && found.userId !== viewerId)) {
      throw new ServiceError("not_found", "That member is not available.");
    }
    const relation = await relationBetween(ctx, viewerId, found.userId);
    if (relation.blocked && !relation.youBlocked) throw new ServiceError("not_found", "That member is not available.");
    const visible = !relation.blocked;
    return {
      userId: found.userId,
      handle: found.handle,
      displayName: found.displayName,
      isPrivate: found.isPrivate,
      indexable: found.indexable && found.status === "active",
      bio: visible && canSee(found.bioVisibility, relation) ? found.bio : null,
      links: visible && canSee(found.linksVisibility, relation) ? found.links : null,
      ...(await counts(ctx, found.userId)),
      avatarUrl: visible ? await avatarUrlFor(ctx, found.avatarAssetId, found.userId) : null,
      relation,
    };
  },
});

export const followMember = defineService({
  name: "members.follow",
  summary: "Follow a member. Following a private account sends a request.",
  kind: "mutation",
  permission: "authenticated",
  writeClass: "write",
  rateLimit: { limit: 200, windowSeconds: 3600, message: "You are following people very quickly. Please slow down.", subject: (_i, actor) => viewer(actor) ?? undefined },
  input: handleInput,
  output: z.object({ following: z.enum(["requested", "active"]) }),
  handler: async (input, ctx) => {
    const self = await activeSelf(ctx);
    const { target } = await reachable(ctx, input.handle, self.userId);
    const status = target.isPrivate ? "requested" : "active";
    const [saved] = await ctx.tx
      .insert(memberFollows)
      .values({ followerId: self.userId, followeeId: target.userId, status })
      .onConflictDoUpdate({
        target: [memberFollows.followerId, memberFollows.followeeId],
        // An approved follow never falls back to a request.
        set: { status: sql`case when ${memberFollows.status} = 'active' then 'active' else excluded.status end` },
      })
      .returning();
    ctx.setSubject("member", target.userId);
    ctx.queueEvent(saved!.status === "active" ? "member.followed" : "member.followRequested", { followerId: self.userId, followeeId: target.userId });
    await notifyMember(ctx, {
      to: target.userId,
      from: self.userId,
      topic: "members.follow",
      key: saved!.status === "active" ? "members.notify.followed" : "members.notify.followRequest",
      href: saved!.status === "active" ? `/@${self.handle}` : "/portal/connections",
      idempotencyKey: `member-follow:${randomUUID()}`,
    });
    return { following: saved!.status };
  },
});

export const unfollowMember = defineService({
  name: "members.unfollow",
  summary: "Stop following a member, or withdraw a follow request.",
  kind: "mutation",
  permission: "authenticated",
  writeClass: "write",
  input: handleInput,
  output: okResult,
  handler: async (input, ctx) => {
    const userId = me(ctx.actor);
    const [target] = await ctx.tx.select().from(memberProfiles).where(eq(memberProfiles.handle, input.handle));
    if (target) {
      await ctx.tx
        .delete(memberFollows)
        .where(and(eq(memberFollows.followerId, userId), eq(memberFollows.followeeId, target.userId)));
    }
    return { ok: true as const };
  },
});

export const answerFollowRequest = defineService({
  name: "members.answerFollow",
  summary: "Approve or decline someone's request to follow you, or remove a follower.",
  kind: "mutation",
  permission: "authenticated",
  writeClass: "write",
  input: handleInput.extend({ approve: z.boolean() }),
  output: okResult,
  handler: async (input, ctx) => {
    const userId = me(ctx.actor);
    const [follower] = await ctx.tx.select().from(memberProfiles).where(eq(memberProfiles.handle, input.handle));
    if (!follower) throw new ServiceError("not_found", "That member is not available.");
    const where = and(eq(memberFollows.followerId, follower.userId), eq(memberFollows.followeeId, userId));
    if (input.approve) {
      const [updated] = await ctx.tx.update(memberFollows).set({ status: "active" }).where(where).returning();
      if (!updated) throw new ServiceError("not_found", "There is no request from that member.");
      ctx.queueEvent("member.followed", { followerId: follower.userId, followeeId: userId });
      const [me] = await ctx.tx.select({ handle: memberProfiles.handle }).from(memberProfiles).where(eq(memberProfiles.userId, userId));
      await notifyMember(ctx, {
        to: follower.userId,
        from: userId,
        topic: "members.follow",
        key: "members.notify.followApproved",
        href: `/@${me?.handle ?? ""}`,
        idempotencyKey: `member-follow-approved:${randomUUID()}`,
      });
    } else {
      await ctx.tx.delete(memberFollows).where(where);
    }
    return { ok: true as const };
  },
});

export const befriendMember = defineService({
  name: "members.befriend",
  summary: "Ask a member to be friends, or accept their request if they already asked.",
  kind: "mutation",
  permission: "authenticated",
  writeClass: "write",
  rateLimit: { limit: 100, windowSeconds: 3600, message: "Please slow down.", subject: (_i, actor) => viewer(actor) ?? undefined },
  input: handleInput,
  output: z.object({ friend: z.enum(["you_asked", "friends"]) }),
  handler: async (input, ctx) => {
    const self = await activeSelf(ctx);
    const { target, relation } = await reachable(ctx, input.handle, self.userId);
    const [low, high] = pair(self.userId, target.userId);
    if (relation.friend === "friends") return { friend: "friends" as const };
    if (relation.friend === "they_asked") {
      await ctx.tx
        .update(memberFriendships)
        .set({ status: "accepted", acceptedAt: new Date() })
        .where(and(eq(memberFriendships.lowId, low), eq(memberFriendships.highId, high)));
      ctx.queueEvent("member.friended", { userIds: [low, high] });
      await notifyMember(ctx, {
        to: target.userId,
        from: self.userId,
        topic: "members.friend",
        key: "members.notify.friendAccepted",
        href: `/@${self.handle}`,
        idempotencyKey: `member-friend-accepted:${randomUUID()}`,
      });
      return { friend: "friends" as const };
    }
    await ctx.tx
      .insert(memberFriendships)
      .values({ lowId: low, highId: high, requestedBy: self.userId, status: "pending" })
      .onConflictDoNothing();
    ctx.queueEvent("member.friendRequested", { from: self.userId, to: target.userId });
    await notifyMember(ctx, {
      to: target.userId,
      from: self.userId,
      topic: "members.friend",
      key: "members.notify.friendRequest",
      href: "/portal/connections",
      idempotencyKey: `member-friend-request:${randomUUID()}`,
    });
    return { friend: "you_asked" as const };
  },
});

export const unfriendMember = defineService({
  name: "members.unfriend",
  summary: "End a friendship, decline a friend request, or withdraw your own.",
  kind: "mutation",
  permission: "authenticated",
  writeClass: "write",
  input: handleInput,
  output: okResult,
  handler: async (input, ctx) => {
    const userId = me(ctx.actor);
    const [target] = await ctx.tx.select().from(memberProfiles).where(eq(memberProfiles.handle, input.handle));
    if (target && target.userId !== userId) {
      const [low, high] = pair(userId, target.userId);
      await ctx.tx.delete(memberFriendships).where(and(eq(memberFriendships.lowId, low), eq(memberFriendships.highId, high)));
    }
    return { ok: true as const };
  },
});

export const setMemberRelation = defineService({
  name: "members.setRelation",
  summary: "Block, mute or restrict a member, or undo it. Blocking also ends follows and friendship both ways.",
  kind: "mutation",
  permission: "authenticated",
  writeClass: "write",
  input: handleInput.extend({ kind: z.enum(RELATION_KINDS), on: z.boolean() }),
  output: okResult,
  handler: async (input, ctx) => {
    const userId = me(ctx.actor);
    const [target] = await ctx.tx.select().from(memberProfiles).where(eq(memberProfiles.handle, input.handle));
    if (!target || target.userId === userId) throw new ServiceError("not_found", "That member is not available.");
    if (!input.on) {
      await ctx.tx
        .delete(memberRelations)
        .where(and(eq(memberRelations.ownerId, userId), eq(memberRelations.targetId, target.userId), eq(memberRelations.kind, input.kind)));
      return { ok: true as const };
    }
    await ctx.tx.insert(memberRelations).values({ ownerId: userId, targetId: target.userId, kind: input.kind }).onConflictDoNothing();
    if (input.kind === "block") {
      await ctx.tx
        .delete(memberFollows)
        .where(
          or(
            and(eq(memberFollows.followerId, userId), eq(memberFollows.followeeId, target.userId)),
            and(eq(memberFollows.followerId, target.userId), eq(memberFollows.followeeId, userId)),
          ),
        );
      const [low, high] = pair(userId, target.userId);
      await ctx.tx.delete(memberFriendships).where(and(eq(memberFriendships.lowId, low), eq(memberFriendships.highId, high)));
    }
    return { ok: true as const };
  },
});

export const myConnections = defineService({
  name: "members.connections",
  summary: "Your followers, who you follow, your friends, pending requests, and who you blocked, muted or restricted.",
  kind: "query",
  permission: "authenticated",
  input: z.object({}),
  output: z.object({
    followers: listed(person),
    following: listed(person),
    friends: listed(person),
    followRequests: listed(person),
    friendRequests: listed(person),
    sentFollowRequests: listed(person),
    sentFriendRequests: listed(person),
    blocked: listed(person),
    muted: listed(person),
    restricted: listed(person),
  }),
  handler: async (_input, ctx) => {
    const userId = me(ctx.actor);
    const people = async (ids: string[]) =>
      ids.length === 0
        ? []
        : (
            await ctx.tx
              .select({ userId: memberProfiles.userId, handle: memberProfiles.handle, displayName: memberProfiles.displayName })
              .from(memberProfiles)
              .where(inArray(memberProfiles.userId, ids))
              .orderBy(memberProfiles.handle)
          );
    const [follows, friendships, relations] = await Promise.all([
      ctx.tx.select().from(memberFollows).where(or(eq(memberFollows.followerId, userId), eq(memberFollows.followeeId, userId))),
      ctx.tx.select().from(memberFriendships).where(or(eq(memberFriendships.lowId, userId), eq(memberFriendships.highId, userId))),
      ctx.tx.select().from(memberRelations).where(eq(memberRelations.ownerId, userId)),
    ]);
    const other = (f: { lowId: string; highId: string }) => (f.lowId === userId ? f.highId : f.lowId);
    return {
      followers: await people(follows.filter((f) => f.followeeId === userId && f.status === "active").map((f) => f.followerId)),
      following: await people(follows.filter((f) => f.followerId === userId && f.status === "active").map((f) => f.followeeId)),
      friends: await people(friendships.filter((f) => f.status === "accepted").map(other)),
      followRequests: await people(follows.filter((f) => f.followeeId === userId && f.status === "requested").map((f) => f.followerId)),
      friendRequests: await people(friendships.filter((f) => f.status === "pending" && f.requestedBy !== userId).map(other)),
      sentFollowRequests: await people(follows.filter((f) => f.followerId === userId && f.status === "requested").map((f) => f.followeeId)),
      sentFriendRequests: await people(friendships.filter((f) => f.status === "pending" && f.requestedBy === userId).map(other)),
      blocked: await people(relations.filter((r) => r.kind === "block").map((r) => r.targetId)),
      muted: await people(relations.filter((r) => r.kind === "mute").map((r) => r.targetId)),
      restricted: await people(relations.filter((r) => r.kind === "restrict").map((r) => r.targetId)),
    };
  },
});

export const PROFILE_SETTINGS = {
  bioVisibility: z.enum(VISIBILITIES).optional(),
  linksVisibility: z.enum(VISIBILITIES).optional(),
  defaultPostVisibility: z.enum(VISIBILITIES).optional(),
  links: z
    .array(z.object({ label: z.string().trim().min(1).max(40), url: z.url({ protocol: /^https?$/ }).max(500) }))
    .max(10)
    .optional(),
  isPrivate: z.boolean().optional(),
  indexable: z.boolean().optional(),
  readReceipts: z.boolean().optional(),
};

/** Going public approves anyone who was waiting to follow. */
export async function approvePendingFollowers(ctx: ServiceContext, userId: string): Promise<void> {
  await ctx.tx
    .update(memberFollows)
    .set({ status: "active" })
    .where(and(eq(memberFollows.followeeId, userId), eq(memberFollows.status, "requested")));
}

export default [
  viewProfile,
  followMember,
  unfollowMember,
  answerFollowRequest,
  befriendMember,
  unfriendMember,
  setMemberRelation,
  myConnections,
];
