// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Posts, comments, reactions and feeds (MASTER.md §44.2, §44.4; C12.04).
//
// The home feed is chronological and made only of people the member follows
// or has befriended. There is no engagement ranking: the order a member sees
// is the order things were posted. The optional "latest" view is public posts
// in time order and says exactly that.
//
// Every read reuses `relationBetween`/`canSee` semantics from graph.ts. The
// feed query restates them in SQL so a page of posts is one query; the test
// suite holds the two to the same answers.
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { and, asc, desc, eq, inArray, isNull, lt, or, sql, type SQL } from "drizzle-orm";
import { listed, okResult, row, timestamp, uuid } from "@/core/contract";
import { defineService, ServiceError, type Actor, type ServiceContext } from "@/core/service";
import { canSee, relationBetween, type Relation } from "./graph";
import { notifyMember } from "./notify";
import {
  REACTIONS,
  VISIBILITIES,
  memberComments,
  memberFollows,
  memberFriendships,
  memberMentions,
  memberPostTags,
  memberPosts,
  memberProfiles,
  memberReactions,
  memberRelations,
  type Visibility,
} from "./schema";

const MENTION = /(?:^|[^\w@])@([a-z0-9_]{3,30})\b/gi;
const HASHTAG = /(?:^|[^\p{L}\p{N}_#])#([\p{L}\p{N}_]{1,50})/gu;
const PAGE = 20;

function viewerOf(actor: Actor): string | null {
  return actor.kind === "user" ? actor.userId : null;
}

async function activeAuthor(ctx: ServiceContext) {
  const viewerId = viewerOf(ctx.actor);
  if (!viewerId) throw new ServiceError("permission", "Sign in to continue.");
  const [found] = await ctx.tx.select().from(memberProfiles).where(eq(memberProfiles.userId, viewerId));
  if (!found) throw new ServiceError("permission", "Join the site first.");
  if (found.status !== "active") throw new ServiceError("permission", "Your membership is not active.");
  return found;
}

/** Visibilities a relation admits, for filtering a page of posts in SQL. */
function admitted(relation: Relation): Visibility[] {
  return VISIBILITIES.filter((v) => canSee(v, relation));
}

export function hashtags(body: string): string[] {
  return [...new Set([...body.matchAll(HASHTAG)].map((m) => m[1]!.toLowerCase()))].slice(0, 30);
}

export function mentions(body: string): string[] {
  return [...new Set([...body.matchAll(MENTION)].map((m) => m[1]!.toLowerCase()))].slice(0, 30);
}

/** Members a mention or tag may reach: active, and not blocked either way. */
async function reachableHandles(ctx: ServiceContext, fromId: string, handles: string[]) {
  if (handles.length === 0) return [];
  const found = await ctx.tx
    .select({ userId: memberProfiles.userId })
    .from(memberProfiles)
    .where(and(inArray(memberProfiles.handle, handles), eq(memberProfiles.status, "active")));
  const out: string[] = [];
  for (const person of found) {
    if (person.userId === fromId) continue;
    if (!(await relationBetween(ctx, fromId, person.userId)).blocked) out.push(person.userId);
  }
  return out;
}

async function writeDerived(ctx: ServiceContext, postId: string, authorId: string, body: string, tagged: string[]) {
  await ctx.tx.delete(memberPostTags).where(eq(memberPostTags.postId, postId));
  const tags = hashtags(body);
  if (tags.length) await ctx.tx.insert(memberPostTags).values(tags.map((tag) => ({ postId, tag })));
  await ctx.tx
    .delete(memberMentions)
    .where(and(eq(memberMentions.postId, postId), isNull(memberMentions.commentId), eq(memberMentions.kind, "mention")));
  const mentioned = await reachableHandles(ctx, authorId, mentions(body));
  if (mentioned.length) {
    await ctx.tx
      .insert(memberMentions)
      .values(mentioned.map((userId) => ({ postId, userId, kind: "mention" as const, status: "approved" as const })));
    ctx.queueEvent("member.mentioned", { postId, userIds: mentioned });
    for (const to of mentioned) {
      await notifyMember(ctx, { to, from: authorId, topic: "members.mention", key: "members.notify.mentioned", href: `/p/${postId}`, idempotencyKey: `member-mention:${postId}:${to}:${randomUUID()}` });
    }
  }
  const people = await reachableHandles(ctx, authorId, tagged);
  if (people.length) {
    await ctx.tx
      .insert(memberMentions)
      .values(people.map((userId) => ({ postId, userId, kind: "tag" as const, status: "pending" as const })));
    ctx.queueEvent("member.tagged", { postId, userIds: people });
    for (const to of people) {
      await notifyMember(ctx, { to, from: authorId, topic: "members.mention", key: "members.notify.tagged", href: "/feed", idempotencyKey: `member-tag:${postId}:${to}` });
    }
  }
}

const author = row({ userId: z.string(), handle: z.string(), displayName: z.string() });
const postShape = row({
  id: uuid,
  author,
  body: z.string(),
  visibility: z.enum(VISIBILITIES),
  createdAt: timestamp,
  editedAt: timestamp.nullable(),
  repost: row({ id: uuid, author, body: z.string(), createdAt: timestamp }).nullable(),
  reactions: z.record(z.string(), z.number().int()),
  myReaction: z.enum(REACTIONS).nullable(),
  comments: z.number().int(),
  tagged: listed(author),
});
type PostShape = z.infer<typeof postShape>;

/** Shape a page of visible posts for one viewer. */
async function present(ctx: ServiceContext, viewerId: string | null, rows: (typeof memberPosts.$inferSelect)[]): Promise<PostShape[]> {
  if (rows.length === 0) return [];
  const ids = rows.map((p) => p.id);
  const repostIds = rows.map((p) => p.repostOf).filter((id): id is string => Boolean(id));
  const originals = repostIds.length
    ? await ctx.tx.select().from(memberPosts).where(and(inArray(memberPosts.id, repostIds), isNull(memberPosts.deletedAt)))
    : [];
  const authorIds = [...new Set([...rows, ...originals].map((p) => p.authorId))];
  const [authors, reactions, mine, commentCounts, tags] = await Promise.all([
    ctx.tx
      .select({ userId: memberProfiles.userId, handle: memberProfiles.handle, displayName: memberProfiles.displayName })
      .from(memberProfiles)
      .where(inArray(memberProfiles.userId, authorIds)),
    ctx.tx
      .select({ postId: memberReactions.postId, kind: memberReactions.kind, n: sql<number>`count(*)::int` })
      .from(memberReactions)
      .where(inArray(memberReactions.postId, ids))
      .groupBy(memberReactions.postId, memberReactions.kind),
    viewerId
      ? ctx.tx.select().from(memberReactions).where(and(inArray(memberReactions.postId, ids), eq(memberReactions.userId, viewerId)))
      : Promise.resolve([]),
    ctx.tx
      .select({ postId: memberComments.postId, n: sql<number>`count(*)::int` })
      .from(memberComments)
      .where(and(inArray(memberComments.postId, ids), isNull(memberComments.deletedAt)))
      .groupBy(memberComments.postId),
    ctx.tx
      .select({ postId: memberMentions.postId, userId: memberProfiles.userId, handle: memberProfiles.handle, displayName: memberProfiles.displayName })
      .from(memberMentions)
      .innerJoin(memberProfiles, eq(memberProfiles.userId, memberMentions.userId))
      .where(and(inArray(memberMentions.postId, ids), eq(memberMentions.kind, "tag"), eq(memberMentions.status, "approved"))),
  ]);
  const byId = new Map(authors.map((a) => [a.userId, a]));
  const visibleOriginal = new Map<string, (typeof originals)[number]>();
  for (const original of originals) {
    const relation = await relationBetween(ctx, viewerId, original.authorId);
    if (canSee(original.visibility, relation)) visibleOriginal.set(original.id, original);
  }
  return rows.map((p) => {
    const original = p.repostOf ? visibleOriginal.get(p.repostOf) : undefined;
    return {
      id: p.id,
      author: byId.get(p.authorId)!,
      body: p.body,
      visibility: p.visibility,
      createdAt: p.createdAt,
      editedAt: p.editedAt,
      repost: original
        ? { id: original.id, author: byId.get(original.authorId)!, body: original.body, createdAt: original.createdAt }
        : null,
      reactions: Object.fromEntries(reactions.filter((r) => r.postId === p.id).map((r) => [r.kind, r.n])),
      myReaction: mine.find((r) => r.postId === p.id)?.kind ?? null,
      comments: commentCounts.find((c) => c.postId === p.id)?.n ?? 0,
      tagged: tags.filter((t) => t.postId === p.id).map(({ userId, handle, displayName }) => ({ userId, handle, displayName })),
    };
  });
}

/** The single post, if this viewer may see it. */
export async function visiblePost(ctx: ServiceContext, viewerId: string | null, postId: string) {
  const [post] = await ctx.tx.select().from(memberPosts).where(and(eq(memberPosts.id, postId), isNull(memberPosts.deletedAt)));
  if (!post) throw new ServiceError("not_found", "That post is not available.");
  const [writer] = await ctx.tx.select().from(memberProfiles).where(eq(memberProfiles.userId, post.authorId));
  if (!writer || (writer.status !== "active" && writer.userId !== viewerId)) throw new ServiceError("not_found", "That post is not available.");
  const relation = await relationBetween(ctx, viewerId, post.authorId);
  if (!canSee(post.visibility, relation)) throw new ServiceError("not_found", "That post is not available.");
  return { post, relation };
}

function cursorFilter(before?: string): SQL | undefined {
  if (!before) return undefined;
  const [at, id] = before.split("|");
  if (!at || !id || Number.isNaN(Date.parse(at))) throw new ServiceError("validation", "That page marker is not valid.");
  return or(lt(memberPosts.createdAt, new Date(at)), and(eq(memberPosts.createdAt, new Date(at)), lt(memberPosts.id, id)));
}

function nextCursor(rows: (typeof memberPosts.$inferSelect)[]): string | null {
  const last = rows.at(-1);
  return rows.length === PAGE && last ? `${last.createdAt.toISOString()}|${last.id}` : null;
}

const pageInput = z.object({ before: z.string().max(100).optional() });
const pageOutput = z.object({ posts: listed(postShape), next: z.string().nullable() });

export const createPost = defineService({
  name: "members.post",
  summary: "Publish a post, a repost or a quote, at a visibility you choose.",
  kind: "mutation",
  permission: "authenticated",
  writeClass: "write",
  rateLimit: { limit: 60, windowSeconds: 3600, message: "You are posting very quickly. Please slow down.", subject: (_i, actor) => viewerOf(actor) ?? undefined },
  input: z.object({
    body: z.string().trim().max(5000).default(""),
    visibility: z.enum(VISIBILITIES).optional(),
    repostOf: uuid.optional(),
    tag: z.array(z.string().trim().toLowerCase().max(60)).max(10).default([]),
  }),
  output: postShape,
  handler: async (input, ctx) => {
    const me = await activeAuthor(ctx);
    if (!input.body && !input.repostOf) throw new ServiceError("validation", "Write something to post.");
    let visibility = input.visibility ?? me.defaultPostVisibility;
    if (input.repostOf) {
      const { post } = await visiblePost(ctx, me.userId, input.repostOf);
      // Only public posts travel: a repost must never widen who sees something.
      if (post.visibility !== "public") throw new ServiceError("permission", "Only public posts can be shared.");
      if (!input.body) visibility = input.visibility ?? "public";
    }
    const [created] = await ctx.tx
      .insert(memberPosts)
      .values({ authorId: me.userId, body: input.body, visibility, repostOf: input.repostOf ?? null })
      .returning();
    await writeDerived(ctx, created!.id, me.userId, input.body, input.tag);
    ctx.setSubject("member_post", created!.id);
    ctx.queueEvent("member.posted", { postId: created!.id, authorId: me.userId, visibility });
    return (await present(ctx, me.userId, [created!]))[0]!;
  },
});

export const editPost = defineService({
  name: "members.editPost",
  summary: "Change the text or visibility of your own post.",
  kind: "mutation",
  permission: "authenticated",
  writeClass: "write",
  input: z.object({ id: uuid, body: z.string().trim().max(5000).optional(), visibility: z.enum(VISIBILITIES).optional() }),
  output: postShape,
  handler: async (input, ctx) => {
    const me = await activeAuthor(ctx);
    const [post] = await ctx.tx
      .select()
      .from(memberPosts)
      .where(and(eq(memberPosts.id, input.id), eq(memberPosts.authorId, me.userId), isNull(memberPosts.deletedAt)))
      .for("update");
    if (!post) throw new ServiceError("not_found", "That post is not available.");
    const body = input.body ?? post.body;
    if (!body && !post.repostOf) throw new ServiceError("validation", "A post needs some text.");
    const [updated] = await ctx.tx
      .update(memberPosts)
      .set({ body, visibility: input.visibility ?? post.visibility, editedAt: new Date() })
      .where(eq(memberPosts.id, post.id))
      .returning();
    if (input.body !== undefined) await writeDerived(ctx, post.id, me.userId, body, []);
    ctx.setSubject("member_post", post.id);
    return (await present(ctx, me.userId, [updated!]))[0]!;
  },
});

export const deletePost = defineService({
  name: "members.deletePost",
  summary: "Delete your own post.",
  kind: "mutation",
  permission: "authenticated",
  writeClass: "write",
  input: z.object({ id: uuid }),
  output: okResult,
  handler: async (input, ctx) => {
    const viewerId = viewerOf(ctx.actor);
    if (!viewerId) throw new ServiceError("permission", "Sign in to continue.");
    const [gone] = await ctx.tx
      .update(memberPosts)
      .set({ deletedAt: new Date() })
      .where(and(eq(memberPosts.id, input.id), eq(memberPosts.authorId, viewerId), isNull(memberPosts.deletedAt)))
      .returning({ id: memberPosts.id });
    if (!gone) throw new ServiceError("not_found", "That post is not available.");
    ctx.setSubject("member_post", input.id);
    return { ok: true as const };
  },
});

export const homeFeed = defineService({
  name: "members.feed",
  summary: "Your home feed: posts from people you follow or have befriended, newest first. No ranking.",
  kind: "query",
  permission: "authenticated",
  input: pageInput,
  output: pageOutput,
  handler: async (input, ctx) => {
    const me = await activeAuthor(ctx);
    const viewer = me.userId;
    const follows = sql`exists (select 1 from ${memberFollows} f where f.follower_id = ${viewer} and f.followee_id = ${memberPosts.authorId} and f.status = 'active')`;
    const friends = sql`exists (select 1 from ${memberFriendships} m where m.status = 'accepted' and ((m.low_id = ${viewer} and m.high_id = ${memberPosts.authorId}) or (m.high_id = ${viewer} and m.low_id = ${memberPosts.authorId})))`;
    const blocked = sql`exists (select 1 from ${memberRelations} r where r.kind = 'block' and ((r.owner_id = ${viewer} and r.target_id = ${memberPosts.authorId}) or (r.owner_id = ${memberPosts.authorId} and r.target_id = ${viewer})))`;
    const muted = sql`exists (select 1 from ${memberRelations} r where r.kind = 'mute' and r.owner_id = ${viewer} and r.target_id = ${memberPosts.authorId})`;
    const others = and(
      or(follows, friends),
      sql`not ${blocked}`,
      sql`not ${muted}`,
      or(
        eq(memberPosts.visibility, "public"),
        and(eq(memberPosts.visibility, "followers"), or(follows, friends)),
        and(eq(memberPosts.visibility, "friends"), friends),
      ),
    );
    const rows = await ctx.tx
      .select({ post: memberPosts })
      .from(memberPosts)
      .innerJoin(memberProfiles, and(eq(memberProfiles.userId, memberPosts.authorId), eq(memberProfiles.status, "active")))
      .where(and(isNull(memberPosts.deletedAt), cursorFilter(input.before), or(eq(memberPosts.authorId, viewer), others)))
      .orderBy(desc(memberPosts.createdAt), desc(memberPosts.id))
      .limit(PAGE);
    const posts = rows.map((r) => r.post);
    return { posts: await present(ctx, viewer, posts), next: nextCursor(posts) };
  },
});

export const latestPublic = defineService({
  name: "members.latest",
  summary: "Public posts from everyone on the site, newest first, optionally with one hashtag. No ranking.",
  kind: "query",
  permission: "public",
  input: pageInput.extend({ tag: z.string().trim().toLowerCase().max(50).optional() }),
  output: pageOutput,
  handler: async (input, ctx) => {
    const viewer = viewerOf(ctx.actor);
    const hidden = viewer
      ? sql`exists (select 1 from ${memberRelations} r where (r.kind = 'block' and ((r.owner_id = ${viewer} and r.target_id = ${memberPosts.authorId}) or (r.owner_id = ${memberPosts.authorId} and r.target_id = ${viewer}))) or (r.kind = 'mute' and r.owner_id = ${viewer} and r.target_id = ${memberPosts.authorId}))`
      : sql`false`;
    const tagged = input.tag
      ? sql`exists (select 1 from ${memberPostTags} t where t.post_id = ${memberPosts.id} and t.tag = ${input.tag})`
      : undefined;
    const rows = await ctx.tx
      .select({ post: memberPosts })
      .from(memberPosts)
      .innerJoin(memberProfiles, and(eq(memberProfiles.userId, memberPosts.authorId), eq(memberProfiles.status, "active")))
      .where(and(isNull(memberPosts.deletedAt), eq(memberPosts.visibility, "public"), sql`not ${hidden}`, tagged, cursorFilter(input.before)))
      .orderBy(desc(memberPosts.createdAt), desc(memberPosts.id))
      .limit(PAGE);
    const posts = rows.map((r) => r.post);
    return { posts: await present(ctx, viewer, posts), next: nextCursor(posts) };
  },
});

export const postsBy = defineService({
  name: "members.postsBy",
  summary: "A member's posts that you are allowed to see, newest first.",
  kind: "query",
  permission: "public",
  input: pageInput.extend({ handle: z.string().trim().toLowerCase().max(60) }),
  output: pageOutput,
  handler: async (input, ctx) => {
    const viewer = viewerOf(ctx.actor);
    const [writer] = await ctx.tx.select().from(memberProfiles).where(eq(memberProfiles.handle, input.handle));
    if (!writer || (writer.status !== "active" && writer.userId !== viewer)) throw new ServiceError("not_found", "That member is not available.");
    const relation = await relationBetween(ctx, viewer, writer.userId);
    const allowed = admitted(relation);
    if (relation.blocked || allowed.length === 0) return { posts: [], next: null };
    const rows = await ctx.tx
      .select()
      .from(memberPosts)
      .where(and(eq(memberPosts.authorId, writer.userId), isNull(memberPosts.deletedAt), inArray(memberPosts.visibility, allowed), cursorFilter(input.before)))
      .orderBy(desc(memberPosts.createdAt), desc(memberPosts.id))
      .limit(PAGE);
    return { posts: await present(ctx, viewer, rows), next: nextCursor(rows) };
  },
});

const commentShape = row({
  id: uuid,
  parentId: uuid.nullable(),
  author,
  body: z.string(),
  createdAt: timestamp,
  /** Only the commenter and the post's author see a restricted member's comments. */
  restricted: z.boolean(),
});

export const viewPost = defineService({
  name: "members.viewPost",
  summary: "One post and its comments, as you are allowed to see them.",
  kind: "query",
  permission: "public",
  input: z.object({ id: uuid }),
  output: z.object({ post: postShape, comments: listed(commentShape) }),
  handler: async (input, ctx) => {
    const viewer = viewerOf(ctx.actor);
    const { post } = await visiblePost(ctx, viewer, input.id);
    const rows = await ctx.tx
      .select({ comment: memberComments, handle: memberProfiles.handle, displayName: memberProfiles.displayName, status: memberProfiles.status })
      .from(memberComments)
      .innerJoin(memberProfiles, eq(memberProfiles.userId, memberComments.authorId))
      .where(and(eq(memberComments.postId, post.id), isNull(memberComments.deletedAt)))
      .orderBy(asc(memberComments.createdAt));
    const restrictedByAuthor = new Set(
      (
        await ctx.tx
          .select({ targetId: memberRelations.targetId })
          .from(memberRelations)
          .where(and(eq(memberRelations.ownerId, post.authorId), eq(memberRelations.kind, "restrict")))
      ).map((r) => r.targetId),
    );
    const comments = [];
    for (const r of rows) {
      if (r.status !== "active" && r.comment.authorId !== viewer) continue;
      const restricted = restrictedByAuthor.has(r.comment.authorId);
      if (restricted && viewer !== r.comment.authorId && viewer !== post.authorId) continue;
      if (viewer && r.comment.authorId !== viewer && (await relationBetween(ctx, viewer, r.comment.authorId)).blocked) continue;
      comments.push({
        id: r.comment.id,
        parentId: r.comment.parentId,
        author: { userId: r.comment.authorId, handle: r.handle, displayName: r.displayName },
        body: r.comment.body,
        createdAt: r.comment.createdAt,
        restricted,
      });
    }
    return { post: (await present(ctx, viewer, [post]))[0]!, comments };
  },
});

export const commentOnPost = defineService({
  name: "members.comment",
  summary: "Comment on a post you can see, or reply to a comment on it.",
  kind: "mutation",
  permission: "authenticated",
  writeClass: "write",
  rateLimit: { limit: 120, windowSeconds: 3600, message: "You are commenting very quickly. Please slow down.", subject: (_i, actor) => viewerOf(actor) ?? undefined },
  input: z.object({ postId: uuid, parentId: uuid.optional(), body: z.string().trim().min(1).max(2000) }),
  output: commentShape,
  handler: async (input, ctx) => {
    const me = await activeAuthor(ctx);
    const { post, relation } = await visiblePost(ctx, me.userId, input.postId);
    if (relation.blocked) throw new ServiceError("not_found", "That post is not available.");
    let parentAuthor: string | null = null;
    if (input.parentId) {
      const [parent] = await ctx.tx
        .select({ id: memberComments.id, authorId: memberComments.authorId })
        .from(memberComments)
        .where(and(eq(memberComments.id, input.parentId), eq(memberComments.postId, post.id), isNull(memberComments.deletedAt)));
      if (!parent) throw new ServiceError("not_found", "That comment is not available.");
      parentAuthor = parent.authorId;
    }
    const [created] = await ctx.tx
      .insert(memberComments)
      .values({ postId: post.id, authorId: me.userId, parentId: input.parentId ?? null, body: input.body })
      .returning();
    const mentioned = await reachableHandles(ctx, me.userId, mentions(input.body));
    if (mentioned.length) {
      await ctx.tx
        .insert(memberMentions)
        .values(mentioned.map((userId) => ({ postId: post.id, commentId: created!.id, userId, kind: "mention" as const, status: "approved" as const })));
    }
    ctx.setSubject("member_post", post.id);
    ctx.queueEvent("member.commented", { postId: post.id, commentId: created!.id, authorId: me.userId, postAuthorId: post.authorId });
    const href = `/p/${post.id}`;
    await notifyMember(ctx, { to: post.authorId, from: me.userId, topic: "members.comment", key: "members.notify.commented", href, idempotencyKey: `member-comment:${created!.id}:author` });
    if (parentAuthor && parentAuthor !== post.authorId) {
      await notifyMember(ctx, { to: parentAuthor, from: me.userId, topic: "members.comment", key: "members.notify.replied", href, idempotencyKey: `member-comment:${created!.id}:parent` });
    }
    for (const to of mentioned) {
      await notifyMember(ctx, { to, from: me.userId, topic: "members.mention", key: "members.notify.mentioned", href, idempotencyKey: `member-comment:${created!.id}:mention:${to}` });
    }
    const [restriction] = await ctx.tx
      .select()
      .from(memberRelations)
      .where(and(eq(memberRelations.ownerId, post.authorId), eq(memberRelations.targetId, me.userId), eq(memberRelations.kind, "restrict")));
    return {
      id: created!.id,
      parentId: created!.parentId,
      author: { userId: me.userId, handle: me.handle, displayName: me.displayName },
      body: created!.body,
      createdAt: created!.createdAt,
      restricted: Boolean(restriction),
    };
  },
});

export const deleteComment = defineService({
  name: "members.deleteComment",
  summary: "Delete your own comment, or any comment on your own post.",
  kind: "mutation",
  permission: "authenticated",
  writeClass: "write",
  input: z.object({ id: uuid }),
  output: okResult,
  handler: async (input, ctx) => {
    const viewer = viewerOf(ctx.actor);
    if (!viewer) throw new ServiceError("permission", "Sign in to continue.");
    const [found] = await ctx.tx
      .select({ comment: memberComments, postAuthor: memberPosts.authorId })
      .from(memberComments)
      .innerJoin(memberPosts, eq(memberPosts.id, memberComments.postId))
      .where(and(eq(memberComments.id, input.id), isNull(memberComments.deletedAt)));
    if (!found || (found.comment.authorId !== viewer && found.postAuthor !== viewer)) {
      throw new ServiceError("not_found", "That comment is not available.");
    }
    await ctx.tx.update(memberComments).set({ deletedAt: new Date() }).where(eq(memberComments.id, input.id));
    return { ok: true as const };
  },
});

export const reactToPost = defineService({
  name: "members.react",
  summary: "React to a post you can see, change your reaction, or remove it.",
  kind: "mutation",
  permission: "authenticated",
  writeClass: "write",
  input: z.object({ postId: uuid, kind: z.enum(REACTIONS).nullable() }),
  output: okResult,
  handler: async (input, ctx) => {
    const me = await activeAuthor(ctx);
    await visiblePost(ctx, me.userId, input.postId);
    if (input.kind === null) {
      await ctx.tx.delete(memberReactions).where(and(eq(memberReactions.postId, input.postId), eq(memberReactions.userId, me.userId)));
    } else {
      await ctx.tx
        .insert(memberReactions)
        .values({ postId: input.postId, userId: me.userId, kind: input.kind })
        .onConflictDoUpdate({ target: [memberReactions.postId, memberReactions.userId], set: { kind: input.kind } });
      ctx.queueEvent("member.reacted", { postId: input.postId, userId: me.userId, kind: input.kind });
      const [post] = await ctx.tx.select({ authorId: memberPosts.authorId }).from(memberPosts).where(eq(memberPosts.id, input.postId));
      await notifyMember(ctx, {
        to: post!.authorId,
        from: me.userId,
        topic: "members.reaction",
        key: "members.notify.reacted",
        href: `/p/${input.postId}`,
        idempotencyKey: `member-reaction:${input.postId}:${me.userId}:${randomUUID()}`,
        dedupeKey: `member-reaction:${input.postId}`,
      });
    }
    return { ok: true as const };
  },
});

export const pendingTags = defineService({
  name: "members.pendingTags",
  summary: "Posts that tagged you and are waiting for your approval.",
  kind: "query",
  permission: "authenticated",
  input: z.object({}),
  output: listed(row({ mentionId: uuid, post: postShape })),
  handler: async (_input, ctx) => {
    const viewer = viewerOf(ctx.actor);
    if (!viewer) throw new ServiceError("permission", "Sign in to continue.");
    const rows = await ctx.tx
      .select({ mention: memberMentions, post: memberPosts })
      .from(memberMentions)
      .innerJoin(memberPosts, eq(memberPosts.id, memberMentions.postId))
      .where(and(eq(memberMentions.userId, viewer), eq(memberMentions.kind, "tag"), eq(memberMentions.status, "pending"), isNull(memberPosts.deletedAt)))
      .orderBy(desc(memberMentions.createdAt));
    const shaped = await present(ctx, viewer, rows.map((r) => r.post));
    return rows.map((r, i) => ({ mentionId: r.mention.id, post: shaped[i]! }));
  },
});

export const answerTag = defineService({
  name: "members.answerTag",
  summary: "Approve or decline being tagged in a post.",
  kind: "mutation",
  permission: "authenticated",
  writeClass: "write",
  input: z.object({ mentionId: uuid, approve: z.boolean() }),
  output: okResult,
  handler: async (input, ctx) => {
    const viewer = viewerOf(ctx.actor);
    if (!viewer) throw new ServiceError("permission", "Sign in to continue.");
    const [updated] = await ctx.tx
      .update(memberMentions)
      .set({ status: input.approve ? "approved" : "declined" })
      .where(and(eq(memberMentions.id, input.mentionId), eq(memberMentions.userId, viewer), eq(memberMentions.kind, "tag")))
      .returning({ id: memberMentions.id });
    if (!updated) throw new ServiceError("not_found", "That tag is not available.");
    return { ok: true as const };
  },
});

export default [
  createPost,
  editPost,
  deletePost,
  homeFeed,
  latestPublic,
  postsBy,
  viewPost,
  commentOnPost,
  deleteComment,
  reactToPost,
  pendingTags,
  answerTag,
];
