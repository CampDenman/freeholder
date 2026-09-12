// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
import { and, desc, eq, isNotNull, or } from "drizzle-orm";
import { z } from "zod";
import { listed, row, timestamp, uuid } from "@/core/contract";
import { contacts } from "@/core/contacts/schema";
import { isUniqueViolation } from "@/core/db";
import {
  defineService,
  getService,
  ServiceError,
  type ServiceContext,
  type Tx,
} from "@/core/service";
import { attachPluginContactColumn } from "@/core/plugins/spine";
import {
  COMMUNITY_ROLES,
  communityJoinRequests,
  communityMembers,
  communityPosts,
  communityRooms,
  communitySpaces,
} from "./schema";

attachPluginContactColumn({
  table: "community_members",
  schema: communityMembers,
  label: "A community membership",
  scope: "plugins.community",
});

attachPluginContactColumn({
  table: "community_posts",
  schema: communityPosts,
  label: "A community post",
  scope: "plugins.community.posts",
});

attachPluginContactColumn({
  table: "community_join_requests",
  schema: communityJoinRequests,
  label: "A community join request",
  scope: "plugins.community.requests",
});

const spaceRow = row({
  id: uuid,
  slug: z.string(),
  title: z.string(),
  access: z.string(),
});

const memberRow = row({
  id: uuid,
  spaceId: uuid,
  contactId: uuid,
  role: z.string(),
});

const roomRow = row({
  id: uuid,
  spaceId: uuid,
  slug: z.string(),
  title: z.string(),
});

const postRow = row({
  id: uuid,
  roomId: uuid,
  spaceId: uuid,
  contactId: uuid,
  authorName: z.string(),
  roomSlug: z.string(),
  roomTitle: z.string(),
  body: z.string(),
  status: z.string(),
  reportedAt: timestamp.nullable(),
  createdAt: timestamp,
});

const publicPostRow = row({
  id: uuid,
  roomId: uuid,
  roomSlug: z.string(),
  roomTitle: z.string(),
  authorName: z.string(),
  body: z.string(),
  createdAt: timestamp,
});

const joinRequestRow = row({
  id: uuid,
  spaceId: uuid,
  contactId: uuid,
  name: z.string(),
  email: z.string().nullable(),
});

const postBody = z
  .string()
  .trim()
  .min(1)
  .max(2000)
  .refine(
    (value) => !/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(value),
    "That post contains characters we cannot store.",
  );

const visitor = z.object({
  email: z.string().trim().email().toLowerCase(),
  name: z.string().trim().min(1).max(200),
});

type Space = typeof communitySpaces.$inferSelect;
type Member = typeof communityMembers.$inferSelect;

async function spaceById(tx: Tx, spaceId: string): Promise<Space> {
  const [space] = await tx
    .select()
    .from(communitySpaces)
    .where(eq(communitySpaces.id, spaceId))
    .limit(1);
  if (!space) throw new ServiceError("not_found", "No such community space.");
  return space;
}

async function spaceBySlug(tx: Tx, slug: string): Promise<Space> {
  const [space] = await tx
    .select()
    .from(communitySpaces)
    .where(eq(communitySpaces.slug, slug))
    .limit(1);
  if (!space) throw new ServiceError("not_found", "No such community space.");
  return space;
}

async function roomById(tx: Tx, roomId: string) {
  const [room] = await tx
    .select()
    .from(communityRooms)
    .where(eq(communityRooms.id, roomId))
    .limit(1);
  if (!room) throw new ServiceError("not_found", "No such community room.");
  return room;
}

async function membership(
  tx: Tx,
  spaceId: string,
  contactId: string,
): Promise<Member | undefined> {
  const [row] = await tx
    .select()
    .from(communityMembers)
    .where(
      and(eq(communityMembers.spaceId, spaceId), eq(communityMembers.contactId, contactId)),
    )
    .limit(1);
  return row;
}

async function requireMember(tx: Tx, spaceId: string, contactId: string): Promise<Member> {
  const member = await membership(tx, spaceId, contactId);
  if (!member) {
    throw new ServiceError("permission", "Join this community before posting.");
  }
  return member;
}

async function contactByEmail(tx: Tx, email: string) {
  const [person] = await tx
    .select({ id: contacts.id, name: contacts.name, email: contacts.email })
    .from(contacts)
    .where(eq(contacts.email, email))
    .limit(1);
  return person;
}

async function resolveVisitor(
  ctx: ServiceContext,
  input: { email: string; name: string },
): Promise<{ id: string }> {
  const resolved = (await ctx.callAsSystem(getService("contacts.resolve"), {
    email: input.email,
    name: input.name,
    source: "community",
  })) as { contact: { id: string } };
  return resolved.contact;
}

const postSelect = {
  id: communityPosts.id,
  roomId: communityPosts.roomId,
  spaceId: communityRooms.spaceId,
  contactId: communityPosts.contactId,
  authorName: contacts.name,
  roomSlug: communityRooms.slug,
  roomTitle: communityRooms.title,
  body: communityPosts.body,
  status: communityPosts.status,
  reportedAt: communityPosts.reportedAt,
  createdAt: communityPosts.createdAt,
};

function postsQuery(tx: Tx) {
  return tx
    .select(postSelect)
    .from(communityPosts)
    .innerJoin(communityRooms, eq(communityRooms.id, communityPosts.roomId))
    .innerJoin(contacts, eq(contacts.id, communityPosts.contactId));
}

async function insertPost(
  ctx: ServiceContext,
  input: { roomId: string; contactId: string; body: string },
) {
  const room = await roomById(ctx.tx, input.roomId);
  await requireMember(ctx.tx, room.spaceId, input.contactId);
  const [created] = await ctx.tx.insert(communityPosts).values(input).returning();
  const [post] = await postsQuery(ctx.tx).where(eq(communityPosts.id, created!.id)).limit(1);
  ctx.setSubject("community_post", post!.id);
  await ctx.emitTimeline({
    contactId: post!.contactId,
    eventType: "community.posted",
    subjectType: "community_post",
    subjectId: post!.id,
    payload: { roomId: post!.roomId, spaceId: post!.spaceId },
  });
  ctx.queueEvent("community.posted", { id: post!.id, contactId: post!.contactId });
  return post!;
}

export const createCommunitySpace = defineService({
  name: "community.createSpace",
  summary: "Open a community space.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({
    slug: z.string().min(1).max(80),
    title: z.string().min(1).max(120),
    access: z.enum(["open", "gated"]).default("open"),
  }),
  output: spaceRow,
  handler: async (input, ctx) => {
    try {
      const [created] = await ctx.tx.insert(communitySpaces).values(input).returning();
      ctx.setSubject("community_space", created!.id);
      return created!;
    } catch (error) {
      if (isUniqueViolation(error, "community_spaces_slug_idx")) {
        throw new ServiceError("conflict", "That community slug is already in use.");
      }
      throw error;
    }
  },
});

export const joinCommunity = defineService({
  name: "community.join",
  summary: "Add a contact to a community space.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({
    spaceId: z.string().uuid(),
    contactId: z.string().uuid(),
    role: z.enum(COMMUNITY_ROLES).default("member"),
  }),
  output: memberRow,
  handler: async (input, ctx) => {
    await spaceById(ctx.tx, input.spaceId);
    try {
      const [created] = await ctx.tx.insert(communityMembers).values(input).returning();
      await ctx.tx
        .delete(communityJoinRequests)
        .where(
          and(
            eq(communityJoinRequests.spaceId, created!.spaceId),
            eq(communityJoinRequests.contactId, created!.contactId),
          ),
        );
      ctx.setSubject("community_member", created!.id);
      await ctx.emitTimeline({
        contactId: created!.contactId,
        eventType: "community.joined",
        subjectType: "community_space",
        subjectId: created!.spaceId,
        payload: { memberId: created!.id, role: created!.role },
      });
      ctx.queueEvent("community.joined", { id: created!.id, contactId: created!.contactId });
      return created!;
    } catch (error) {
      if (isUniqueViolation(error, "community_members_space_contact_idx")) {
        throw new ServiceError("conflict", "That person is already in this community.");
      }
      throw error;
    }
  },
});

export const listCommunitySpaces = defineService({
  name: "community.listSpaces",
  summary: "Community spaces on this instance.",
  kind: "query",
  permission: "scoped",
  input: z.object({}),
  output: listed(spaceRow),
  handler: (_input, ctx) =>
    ctx.tx.select().from(communitySpaces).orderBy(desc(communitySpaces.createdAt)),
});

export const listCommunityMembers = defineService({
  name: "community.listMembers",
  summary: "People in one community space.",
  kind: "query",
  permission: "scoped",
  input: z.object({ spaceId: z.string().uuid() }),
  output: listed(memberRow),
  handler: (input, ctx) =>
    ctx.tx
      .select()
      .from(communityMembers)
      .where(eq(communityMembers.spaceId, input.spaceId))
      .orderBy(desc(communityMembers.createdAt)),
});

export const createCommunityRoom = defineService({
  name: "community.createRoom",
  summary: "Open a room inside a community space.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({
    spaceId: z.string().uuid(),
    slug: z.string().min(1).max(80),
    title: z.string().min(1).max(120),
  }),
  output: roomRow,
  handler: async (input, ctx) => {
    await spaceById(ctx.tx, input.spaceId);
    try {
      const [created] = await ctx.tx.insert(communityRooms).values(input).returning();
      ctx.setSubject("community_room", created!.id);
      return created!;
    } catch (error) {
      if (isUniqueViolation(error, "community_rooms_space_slug_idx")) {
        throw new ServiceError("conflict", "That room slug is already in use in this space.");
      }
      throw error;
    }
  },
});

export const listCommunityRooms = defineService({
  name: "community.listRooms",
  summary: "Rooms in one community space.",
  kind: "query",
  permission: "scoped",
  input: z.object({ spaceId: z.string().uuid() }),
  output: listed(roomRow),
  handler: (input, ctx) =>
    ctx.tx
      .select()
      .from(communityRooms)
      .where(eq(communityRooms.spaceId, input.spaceId))
      .orderBy(communityRooms.createdAt),
});

export const createCommunityPost = defineService({
  name: "community.createPost",
  summary: "A member posts in a community room.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({
    roomId: z.string().uuid(),
    contactId: z.string().uuid(),
    body: postBody,
  }),
  output: postRow,
  handler: (input, ctx) => insertPost(ctx, input),
});

export const listCommunityFeed = defineService({
  name: "community.listFeed",
  summary: "Chronological posts in a space or room, newest first.",
  kind: "query",
  permission: "scoped",
  input: z.object({
    spaceId: z.string().uuid(),
    roomId: z.string().uuid().optional(),
    includeHidden: z.boolean().default(false),
  }),
  output: listed(postRow),
  handler: async (input, ctx) => {
    const filters = [eq(communityRooms.spaceId, input.spaceId)];
    if (input.roomId) filters.push(eq(communityPosts.roomId, input.roomId));
    if (!input.includeHidden) filters.push(eq(communityPosts.status, "visible"));
    return postsQuery(ctx.tx)
      .where(and(...filters))
      .orderBy(desc(communityPosts.createdAt));
  },
});

export const listCommunityModeration = defineService({
  name: "community.listModeration",
  summary: "Hidden or reported posts in one space.",
  kind: "query",
  permission: "scoped",
  input: z.object({ spaceId: z.string().uuid() }),
  output: listed(postRow),
  handler: (input, ctx) =>
    postsQuery(ctx.tx)
      .where(
        and(
          eq(communityRooms.spaceId, input.spaceId),
          or(
            eq(communityPosts.status, "hidden"),
            eq(communityPosts.status, "removed"),
            isNotNull(communityPosts.reportedAt),
          ),
        ),
      )
      .orderBy(desc(communityPosts.createdAt)),
});

export const hideCommunityPost = defineService({
  name: "community.hidePost",
  summary: "Hide a post from the public feed.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({ postId: z.string().uuid() }),
  output: postRow,
  handler: async (input, ctx) => {
    const [existing] = await postsQuery(ctx.tx)
      .where(eq(communityPosts.id, input.postId))
      .limit(1);
    if (!existing) throw new ServiceError("not_found", "No such community post.");
    if (existing.status === "removed") {
      throw new ServiceError("conflict", "That post has already been removed.");
    }
    await ctx.tx
      .update(communityPosts)
      .set({ status: "hidden" })
      .where(eq(communityPosts.id, input.postId));
    ctx.setSubject("community_post", input.postId);
    const [updated] = await postsQuery(ctx.tx)
      .where(eq(communityPosts.id, input.postId))
      .limit(1);
    return updated!;
  },
});

export const removeCommunityPost = defineService({
  name: "community.removePost",
  summary: "Remove a post from the public feed.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({ postId: z.string().uuid() }),
  output: postRow,
  handler: async (input, ctx) => {
    const [existing] = await postsQuery(ctx.tx)
      .where(eq(communityPosts.id, input.postId))
      .limit(1);
    if (!existing) throw new ServiceError("not_found", "No such community post.");
    await ctx.tx
      .update(communityPosts)
      .set({ status: "removed" })
      .where(eq(communityPosts.id, input.postId));
    ctx.setSubject("community_post", input.postId);
    const [updated] = await postsQuery(ctx.tx)
      .where(eq(communityPosts.id, input.postId))
      .limit(1);
    return updated!;
  },
});

export const listCommunityJoinRequests = defineService({
  name: "community.listJoinRequests",
  summary: "Pending requests to join a gated space.",
  kind: "query",
  permission: "scoped",
  input: z.object({ spaceId: z.string().uuid() }),
  output: listed(joinRequestRow),
  handler: (input, ctx) =>
    ctx.tx
      .select({
        id: communityJoinRequests.id,
        spaceId: communityJoinRequests.spaceId,
        contactId: communityJoinRequests.contactId,
        name: contacts.name,
        email: contacts.email,
      })
      .from(communityJoinRequests)
      .innerJoin(contacts, eq(contacts.id, communityJoinRequests.contactId))
      .where(eq(communityJoinRequests.spaceId, input.spaceId))
      .orderBy(desc(communityJoinRequests.createdAt)),
});

export const getCommunitySpaceBySlug = defineService({
  name: "community.getBySlug",
  summary: "The public community space for a slug.",
  kind: "query",
  permission: "public",
  input: z.object({ slug: z.string().min(1).max(80) }),
  output: row({ space: spaceRow, memberCount: z.number().int() }),
  handler: async (input, ctx) => {
    const space = await spaceBySlug(ctx.tx, input.slug);
    const members = await ctx.tx
      .select({ id: communityMembers.id })
      .from(communityMembers)
      .where(eq(communityMembers.spaceId, space.id));
    return { space, memberCount: members.length };
  },
});

export const getCommunityFeedBySlug = defineService({
  name: "community.getFeedBySlug",
  summary: "The public chronological feed for a community slug.",
  kind: "query",
  permission: "public",
  input: z.object({
    slug: z.string().min(1).max(80),
    email: z.string().trim().email().toLowerCase().optional(),
    roomSlug: z.string().min(1).max(80).optional(),
  }),
  output: row({
    space: spaceRow,
    memberCount: z.number().int(),
    canRead: z.boolean(),
    rooms: listed(roomRow),
    posts: listed(publicPostRow),
  }),
  handler: async (input, ctx) => {
    const space = await spaceBySlug(ctx.tx, input.slug);
    const members = await ctx.tx
      .select({ id: communityMembers.id })
      .from(communityMembers)
      .where(eq(communityMembers.spaceId, space.id));
    const rooms = await ctx.tx
      .select()
      .from(communityRooms)
      .where(eq(communityRooms.spaceId, space.id))
      .orderBy(communityRooms.createdAt);
    let canRead = space.access === "open";
    if (!canRead && input.email) {
      const person = await contactByEmail(ctx.tx, input.email);
      if (person && (await membership(ctx.tx, space.id, person.id))) canRead = true;
    }
    if (!canRead) {
      return { space, memberCount: members.length, canRead: false, rooms, posts: [] };
    }
    const filters = [
      eq(communityRooms.spaceId, space.id),
      eq(communityPosts.status, "visible"),
    ];
    if (input.roomSlug) filters.push(eq(communityRooms.slug, input.roomSlug));
    const posts = await postsQuery(ctx.tx)
      .where(and(...filters))
      .orderBy(desc(communityPosts.createdAt));
    return {
      space,
      memberCount: members.length,
      canRead: true,
      rooms,
      posts: posts.map((post) => ({
        id: post.id,
        roomId: post.roomId,
        roomSlug: post.roomSlug,
        roomTitle: post.roomTitle,
        authorName: post.authorName,
        body: post.body,
        createdAt: post.createdAt,
      })),
    };
  },
});

export const joinCommunityBySlug = defineService({
  name: "community.joinBySlug",
  summary: "A visitor asks to join an open community space.",
  kind: "mutation",
  permission: "public",
  rateLimit: {
    limit: 10,
    windowSeconds: 15 * 60,
    subject: (input) => input.email,
    message: "Too many community join attempts from that address. Try again shortly.",
  },
  input: visitor.extend({
    slug: z.string().min(1).max(80),
  }),
  output: memberRow,
  handler: async (input, ctx) => {
    const space = await spaceBySlug(ctx.tx, input.slug);
    if (space.access !== "open") {
      throw new ServiceError("permission", "This community is gated. Ask the owner to add you.");
    }
    const contact = await resolveVisitor(ctx, input);
    return ctx.callAsSystem(joinCommunity, {
      spaceId: space.id,
      contactId: contact.id,
    });
  },
});

export const requestCommunityJoinBySlug = defineService({
  name: "community.requestJoinBySlug",
  summary: "A visitor asks to join a gated community space.",
  kind: "mutation",
  permission: "public",
  rateLimit: {
    limit: 10,
    windowSeconds: 15 * 60,
    subject: (input) => input.email,
    message: "Too many community join requests from that address. Try again shortly.",
  },
  input: visitor.extend({
    slug: z.string().min(1).max(80),
  }),
  output: joinRequestRow,
  handler: async (input, ctx) => {
    const space = await spaceBySlug(ctx.tx, input.slug);
    if (space.access !== "gated") {
      throw new ServiceError("permission", "This community is open. Join it instead.");
    }
    const contact = await resolveVisitor(ctx, input);
    if (await membership(ctx.tx, space.id, contact.id)) {
      throw new ServiceError("conflict", "That person is already in this community.");
    }
    try {
      const [created] = await ctx.tx
        .insert(communityJoinRequests)
        .values({ spaceId: space.id, contactId: contact.id })
        .returning();
      ctx.setSubject("community_join_request", created!.id);
      const [person] = await ctx.tx
        .select({ name: contacts.name, email: contacts.email })
        .from(contacts)
        .where(eq(contacts.id, contact.id))
        .limit(1);
      return {
        id: created!.id,
        spaceId: created!.spaceId,
        contactId: created!.contactId,
        name: person?.name ?? input.name,
        email: person?.email ?? input.email,
      };
    } catch (error) {
      if (isUniqueViolation(error, "community_join_requests_space_contact_idx")) {
        throw new ServiceError("conflict", "That join request is already waiting.");
      }
      throw error;
    }
  },
});

export const createCommunityPostBySlug = defineService({
  name: "community.createPostBySlug",
  summary: "A member posts in a public community room. Untrusted input.",
  kind: "mutation",
  permission: "public",
  rateLimit: {
    limit: 10,
    windowSeconds: 15 * 60,
    subject: (input) => input.email,
    message: "Too many community posts from that address. Try again shortly.",
  },
  input: visitor.extend({
    slug: z.string().min(1).max(80),
    roomSlug: z.string().min(1).max(80),
    body: postBody,
  }),
  output: postRow,
  handler: async (input, ctx) => {
    const space = await spaceBySlug(ctx.tx, input.slug);
    const [room] = await ctx.tx
      .select()
      .from(communityRooms)
      .where(and(eq(communityRooms.spaceId, space.id), eq(communityRooms.slug, input.roomSlug)))
      .limit(1);
    if (!room) throw new ServiceError("not_found", "No such community room.");
    const contact = await resolveVisitor(ctx, input);
    await requireMember(ctx.tx, space.id, contact.id);
    return insertPost(ctx, { roomId: room.id, contactId: contact.id, body: input.body });
  },
});

export const reportCommunityPostBySlug = defineService({
  name: "community.reportPostBySlug",
  summary: "A visitor reports a community post.",
  kind: "mutation",
  permission: "public",
  rateLimit: {
    limit: 10,
    windowSeconds: 15 * 60,
    subject: (input) => input.email,
    message: "Too many community reports from that address. Try again shortly.",
  },
  input: visitor.extend({
    slug: z.string().min(1).max(80),
    postId: z.string().uuid(),
  }),
  output: publicPostRow,
  handler: async (input, ctx) => {
    const space = await spaceBySlug(ctx.tx, input.slug);
    const [post] = await postsQuery(ctx.tx)
      .where(and(eq(communityPosts.id, input.postId), eq(communityRooms.spaceId, space.id)))
      .limit(1);
    if (!post || post.status !== "visible") {
      throw new ServiceError("not_found", "No such community post.");
    }
    await resolveVisitor(ctx, input);
    if (!post.reportedAt) {
      await ctx.tx
        .update(communityPosts)
        .set({ reportedAt: new Date() })
        .where(eq(communityPosts.id, post.id));
    }
    ctx.setSubject("community_post", post.id);
    return {
      id: post.id,
      roomId: post.roomId,
      roomSlug: post.roomSlug,
      roomTitle: post.roomTitle,
      authorName: post.authorName,
      body: post.body,
      createdAt: post.createdAt,
    };
  },
});

export const moderateCommunityPostBySlug = defineService({
  name: "community.moderatePostBySlug",
  summary: "A moderator hides or removes a post.",
  kind: "mutation",
  permission: "public",
  rateLimit: {
    limit: 30,
    windowSeconds: 15 * 60,
    subject: (input) => input.email,
    message: "Too many moderation attempts from that address. Try again shortly.",
  },
  input: visitor.extend({
    slug: z.string().min(1).max(80),
    postId: z.string().uuid(),
    action: z.enum(["hide", "remove"]),
  }),
  output: postRow,
  handler: async (input, ctx) => {
    const space = await spaceBySlug(ctx.tx, input.slug);
    const contact = await resolveVisitor(ctx, input);
    const member = await membership(ctx.tx, space.id, contact.id);
    if (!member || member.role !== "moderator") {
      throw new ServiceError("permission", "Only a moderator can hide or remove a post.");
    }
    const [post] = await postsQuery(ctx.tx)
      .where(and(eq(communityPosts.id, input.postId), eq(communityRooms.spaceId, space.id)))
      .limit(1);
    if (!post) throw new ServiceError("not_found", "No such community post.");
    if (input.action === "hide" && post.status === "removed") {
      throw new ServiceError("conflict", "That post has already been removed.");
    }
    await ctx.tx
      .update(communityPosts)
      .set({ status: input.action === "hide" ? "hidden" : "removed" })
      .where(eq(communityPosts.id, post.id));
    ctx.setSubject("community_post", post.id);
    const [updated] = await postsQuery(ctx.tx).where(eq(communityPosts.id, post.id)).limit(1);
    return updated!;
  },
});

export default [
  createCommunitySpace,
  joinCommunity,
  listCommunitySpaces,
  listCommunityMembers,
  createCommunityRoom,
  listCommunityRooms,
  createCommunityPost,
  listCommunityFeed,
  listCommunityModeration,
  hideCommunityPost,
  removeCommunityPost,
  listCommunityJoinRequests,
  getCommunitySpaceBySlug,
  getCommunityFeedBySlug,
  joinCommunityBySlug,
  requestCommunityJoinBySlug,
  createCommunityPostBySlug,
  reportCommunityPostBySlug,
  moderateCommunityPostBySlug,
];
