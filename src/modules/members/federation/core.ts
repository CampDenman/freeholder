// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// ActivityPub federation, publishing side (MASTER.md §44.11, C12.18).
//
// Off unless the site owner turns it on and a member opts in. An opted-in
// member is `@handle@this-site`: fediverse servers can find them by WebFinger,
// read their actor document and public posts, and follow them. Their new
// public posts (never followers-only, friends-only, subscriber or adult ones)
// are delivered, signed, to their remote followers' inboxes.
//
// Everything inbound is verified with an HTTP signature against a key fetched
// from the sender, through the same DNS-pinned transport webhooks use, so
// another server can never make this one reach a private address.
import { z } from "zod";
import { and, asc, desc, eq, isNull, lte, sql } from "drizzle-orm";
import { decryptSecret, encryptSecret } from "@/core/connections/crypto";
import { db } from "@/core/db";
import { env } from "@/core/env";
import { okResult, uuid } from "@/core/contract";
import { defineService, ServiceError, type ServiceContext } from "@/core/service";
import { requestPinned } from "@/core/webhooks/transport";
import {
  memberActorKeys,
  memberFederationDeliveries,
  memberPosts,
  memberProfiles,
  memberRemoteFollowers,
  memberSettings,
} from "../schema";
import { newActorKeys, signRequest } from "./signatures";
import { applyFollowedActivity } from "./following";

export const ACTIVITY_JSON = "application/activity+json";
export const PUBLIC = "https://www.w3.org/ns/activitystreams#Public";
const CONTEXT = ["https://www.w3.org/ns/activitystreams", "https://w3id.org/security/v1"];
const MAX_ATTEMPTS = 8;

export function origin(): string {
  return new URL(env().APP_URL).origin;
}
export function siteHost(): string {
  return new URL(env().APP_URL).host;
}
export const actorId = (handle: string) => `${origin()}/ap/users/${handle}`;
const noteId = (postId: string) => `${origin()}/ap/notes/${postId}`;

export async function siteFederates(ctx: { tx: ServiceContext["tx"] }): Promise<boolean> {
  const [found] = await ctx.tx.select({ on: memberSettings.federation }).from(memberSettings).where(eq(memberSettings.id, 1));
  return found?.on ?? false;
}

/** The member behind a handle, only if the site and the member both federate. */
export async function federatedMember(ctx: { tx: ServiceContext["tx"] }, handle: string) {
  if (!(await siteFederates(ctx))) return null;
  const [found] = await ctx.tx
    .select()
    .from(memberProfiles)
    .where(and(eq(memberProfiles.handle, handle.toLowerCase()), eq(memberProfiles.status, "active"), eq(memberProfiles.federated, true)));
  return found ?? null;
}

const keyAad = (userId: string) => `freeholder:member-actor:${userId}`;

export async function actorKeys(ctx: { tx: ServiceContext["tx"] }, userId: string): Promise<{ publicKeyPem: string; privateKeyPem: string }> {
  const [found] = await ctx.tx.select().from(memberActorKeys).where(eq(memberActorKeys.userId, userId));
  if (found) return { publicKeyPem: found.publicKeyPem, privateKeyPem: decryptSecret(found.privateKeySealed, keyAad(userId)) };
  const keys = newActorKeys();
  await ctx.tx.insert(memberActorKeys).values({ userId, publicKeyPem: keys.publicKeyPem, privateKeySealed: encryptSecret(keys.privateKeyPem, keyAad(userId)) }).onConflictDoNothing();
  const [stored] = await ctx.tx.select().from(memberActorKeys).where(eq(memberActorKeys.userId, userId));
  return { publicKeyPem: stored!.publicKeyPem, privateKeyPem: decryptSecret(stored!.privateKeySealed, keyAad(userId)) };
}

const escapeHtml = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const paragraphs = (text: string) => text.split(/\n{2,}/).map((p) => `<p>${escapeHtml(p).replace(/\n/g, "<br>")}</p>`).join("");

export function actorDocument(profile: typeof memberProfiles.$inferSelect, publicKeyPem: string) {
  const id = actorId(profile.handle);
  return {
    "@context": CONTEXT,
    id,
    type: "Person",
    preferredUsername: profile.handle,
    name: profile.displayName,
    // Only what anyone may see on the profile itself.
    summary: profile.bioVisibility === "public" && profile.bio ? paragraphs(profile.bio) : "",
    url: `${origin()}/@${profile.handle}`,
    inbox: `${id}/inbox`,
    outbox: `${id}/outbox`,
    followers: `${id}/followers`,
    manuallyApprovesFollowers: false,
    discoverable: profile.indexable,
    // C12.33: the member's other accounts, and where they moved, if they did.
    ...(profile.fediverseAliases.length ? { alsoKnownAs: profile.fediverseAliases } : {}),
    ...(profile.movedTo ? { movedTo: profile.movedTo } : {}),
    publicKey: { id: `${id}#main-key`, owner: id, publicKeyPem },
  };
}

export function noteFor(post: typeof memberPosts.$inferSelect, handle: string) {
  const actor = actorId(handle);
  return {
    id: noteId(post.id),
    type: "Note",
    attributedTo: actor,
    content: paragraphs(post.body),
    published: post.createdAt.toISOString(),
    ...(post.editedAt ? { updated: post.editedAt.toISOString() } : {}),
    url: `${origin()}/p/${post.id}`,
    to: [PUBLIC],
    cc: [`${actor}/followers`],
  };
}

/** Whether a post may leave the site: public, not adult, not a bare repost, not deleted. */
export function federable(post: typeof memberPosts.$inferSelect): boolean {
  return post.visibility === "public" && !post.adult && !post.deletedAt && post.body.length > 0;
}

export async function publicNotes(ctx: { tx: ServiceContext["tx"] }, profile: typeof memberProfiles.$inferSelect, limit = 20) {
  const rows = await ctx.tx
    .select()
    .from(memberPosts)
    .where(and(eq(memberPosts.authorId, profile.userId), eq(memberPosts.visibility, "public"), eq(memberPosts.adult, false), isNull(memberPosts.deletedAt)))
    .orderBy(desc(memberPosts.createdAt))
    .limit(limit);
  return rows.filter(federable).map((post) => noteFor(post, profile.handle));
}

/** Queue one activity to every distinct inbox of a member's remote followers. */
async function queueToFollowers(ctx: ServiceContext, userId: string, activity: Record<string, unknown>) {
  const followers = await ctx.tx.select().from(memberRemoteFollowers).where(eq(memberRemoteFollowers.userId, userId));
  const inboxes = [...new Set(followers.map((f) => f.sharedInboxUri ?? f.inboxUri))];
  if (inboxes.length) await ctx.tx.insert(memberFederationDeliveries).values(inboxes.map((inboxUri) => ({ userId, inboxUri, activity })));
  return inboxes.length;
}

export const federatePost = defineService({
  name: "members.federatePost",
  summary: "Send a new public post to the author's fediverse followers.",
  kind: "mutation",
  permission: "system",
  input: z.object({ postId: uuid }),
  output: z.object({ queued: z.number().int() }),
  handler: async (input, ctx) => {
    const [post] = await ctx.tx.select().from(memberPosts).where(eq(memberPosts.id, input.postId));
    if (!post || !federable(post)) return { queued: 0 };
    const [author] = await ctx.tx.select().from(memberProfiles).where(eq(memberProfiles.userId, post.authorId));
    if (!author || !(await federatedMember(ctx, author.handle))) return { queued: 0 };
    const note = noteFor(post, author.handle);
    const queued = await queueToFollowers(ctx, author.userId, { "@context": CONTEXT[0], id: `${note.id}/activity`, type: "Create", actor: note.attributedTo, published: note.published, to: note.to, cc: note.cc, object: note });
    return { queued };
  },
});

export const federateDelete = defineService({
  name: "members.federateDelete",
  summary: "Tell the author's fediverse followers a post is gone.",
  kind: "mutation",
  permission: "system",
  input: z.object({ postId: uuid, authorId: uuid }),
  output: z.object({ queued: z.number().int() }),
  handler: async (input, ctx) => {
    const [author] = await ctx.tx.select().from(memberProfiles).where(eq(memberProfiles.userId, input.authorId));
    if (!author || !(await siteFederates(ctx))) return { queued: 0 };
    const actor = actorId(author.handle);
    const queued = await queueToFollowers(ctx, author.userId, { "@context": CONTEXT[0], id: `${noteId(input.postId)}#delete`, type: "Delete", actor, to: [PUBLIC], object: { id: noteId(input.postId), type: "Tombstone" } });
    return { queued };
  },
});

const remoteActor = z.object({
  id: z.string().url(),
  inbox: z.string().url(),
  preferredUsername: z.string().max(200).optional(),
  endpoints: z.object({ sharedInbox: z.string().url().optional() }).partial().optional(),
  /** C12.33: the accounts it says are also it. */
  alsoKnownAs: z.union([z.string(), z.array(z.string()).max(50)]).optional(),
});

/** C12.33: a Move target, fetched by the inbox route before the transaction. */
const moveTarget = z.object({ id: z.string().url(), inbox: z.string().url(), alsoKnownAs: z.array(z.string()).max(50) });

/** Handle one verified inbox activity for a member. `actor` is the verified sender's document. */
export const federationInbox = defineService({
  name: "members.federationInbox",
  summary: "Apply a verified ActivityPub activity sent to a member: Follow, Undo Follow, or a remote account's Delete.",
  kind: "mutation",
  permission: "system",
  input: z.object({ handle: z.string().max(60), activity: z.record(z.string(), z.unknown()), actor: remoteActor, moveTarget: moveTarget.optional() }),
  output: okResult,
  handler: async (input, ctx) => {
    const member = await federatedMember(ctx, input.handle);
    if (!member) throw new ServiceError("not_found", "That member does not federate.");
    const me = actorId(member.handle);
    const { activity, actor } = input;
    const objectId = typeof activity.object === "string" ? activity.object : (activity.object as { id?: string } | undefined)?.id;
    const host = new URL(actor.id).host;
    // C12.32: accounts this member follows — acceptances and their posts.
    if (await applyFollowedActivity(ctx, member.userId, me, activity, actor, input.moveTarget)) return { ok: true as const };
    if (activity.type === "Follow" && objectId === me) {
      await ctx.tx
        .insert(memberRemoteFollowers)
        .values({ userId: member.userId, actorUri: actor.id, inboxUri: actor.inbox, sharedInboxUri: actor.endpoints?.sharedInbox ?? null, handle: actor.preferredUsername ? `${actor.preferredUsername}@${host}` : null })
        .onConflictDoUpdate({ target: [memberRemoteFollowers.userId, memberRemoteFollowers.actorUri], set: { inboxUri: actor.inbox, sharedInboxUri: actor.endpoints?.sharedInbox ?? null } });
      await ctx.tx.insert(memberFederationDeliveries).values({
        userId: member.userId,
        inboxUri: actor.inbox,
        activity: { "@context": CONTEXT[0], id: `${me}#accepts/${encodeURIComponent(typeof activity.id === "string" ? activity.id : actor.id)}`, type: "Accept", actor: me, object: activity },
      });
    } else if (activity.type === "Undo" && (activity.object as { type?: string } | undefined)?.type === "Follow") {
      await ctx.tx.delete(memberRemoteFollowers).where(and(eq(memberRemoteFollowers.userId, member.userId), eq(memberRemoteFollowers.actorUri, actor.id)));
    } else if (activity.type === "Delete" && objectId === actor.id) {
      await ctx.tx.delete(memberRemoteFollowers).where(eq(memberRemoteFollowers.actorUri, actor.id));
    }
    // Anything else is accepted and ignored.
    return { ok: true as const };
  },
});

/** Fetch a remote actor document (and so its key) through the pinned transport. */
export async function fetchRemoteActor(uri: string): Promise<(z.infer<typeof remoteActor> & { publicKeyPem: string }) | null> {
  const url = uri.split("#")[0]!;
  const response = await requestPinned("GET", url, null, { accept: `${ACTIVITY_JSON}, application/ld+json` }, { timeoutMs: 8_000, maxResponseBytes: 200_000 });
  if (response.status !== 200) return null;
  let doc: unknown;
  try {
    doc = JSON.parse(response.body);
  } catch {
    return null;
  }
  const parsed = remoteActor.extend({ publicKey: z.object({ id: z.string(), owner: z.string(), publicKeyPem: z.string().max(10_000) }) }).safeParse(doc);
  if (!parsed.success) return null;
  // The key must belong to the actor that serves it.
  if (parsed.data.publicKey.owner !== parsed.data.id) return null;
  return { ...parsed.data, publicKeyPem: parsed.data.publicKey.publicKeyPem };
}

/** Deliver due activities. Provider I/O: runs outside any transaction. */
export async function deliverFederation(limit = 50): Promise<{ delivered: number; failed: number }> {
  const due = await db()
    .select()
    .from(memberFederationDeliveries)
    .where(and(isNull(memberFederationDeliveries.deliveredAt), lte(memberFederationDeliveries.nextAttemptAt, new Date()), sql`${memberFederationDeliveries.attempts} < ${MAX_ATTEMPTS}`))
    .orderBy(asc(memberFederationDeliveries.nextAttemptAt))
    .limit(limit);
  let delivered = 0;
  let failed = 0;
  for (const job of due) {
    const [profile] = await db().select().from(memberProfiles).where(eq(memberProfiles.userId, job.userId));
    if (!profile) continue;
    const keys = await db().transaction((tx) => actorKeys({ tx }, job.userId));
    const body = JSON.stringify(job.activity);
    let ok = false;
    let error: string | null = null;
    try {
      const headers = signRequest({ method: "POST", url: job.inboxUri, body, keyId: `${actorId(profile.handle)}#main-key`, privateKeyPem: keys.privateKeyPem, extra: { "content-type": ACTIVITY_JSON } });
      const response = await requestPinned("POST", job.inboxUri, body, headers, { timeoutMs: 10_000 });
      ok = response.status >= 200 && response.status < 300;
      if (!ok) error = `HTTP ${response.status}`;
    } catch (cause) {
      error = cause instanceof Error ? cause.message : "Delivery failed.";
    }
    const attempts = job.attempts + 1;
    await db()
      .update(memberFederationDeliveries)
      .set(ok ? { deliveredAt: new Date(), attempts, lastError: null } : { attempts, lastError: error?.slice(0, 500) ?? null, nextAttemptAt: new Date(Date.now() + Math.min(2 ** attempts, 360) * 60_000) })
      .where(eq(memberFederationDeliveries.id, job.id));
    if (ok) delivered += 1;
    else failed += 1;
  }
  return { delivered, failed };
}

export const setMyFederation = defineService({
  name: "members.setFederation",
  summary: "Choose whether people on other fediverse servers can find and follow you, and see your public posts.",
  kind: "mutation",
  permission: "authenticated",
  writeClass: "write",
  input: z.object({ federated: z.boolean() }),
  output: z.object({ federated: z.boolean(), address: z.string().nullable() }),
  handler: async (input, ctx) => {
    if (ctx.actor.kind !== "user") throw new ServiceError("permission", "Sign in to continue.");
    if (input.federated && !(await siteFederates(ctx))) throw new ServiceError("validation", "This site does not federate.");
    const [updated] = await ctx.tx
      .update(memberProfiles)
      .set({ federated: input.federated, updatedAt: new Date() })
      .where(and(eq(memberProfiles.userId, ctx.actor.userId), eq(memberProfiles.status, "active")))
      .returning();
    if (!updated) throw new ServiceError("permission", "Join the site first.");
    if (!input.federated) {
      // Leaving the fediverse: tell followers the account is gone, then forget them.
      await queueToFollowers(ctx, updated.userId, { "@context": CONTEXT[0], id: `${actorId(updated.handle)}#delete`, type: "Delete", actor: actorId(updated.handle), to: [PUBLIC], object: actorId(updated.handle) });
      await ctx.tx.delete(memberRemoteFollowers).where(eq(memberRemoteFollowers.userId, updated.userId));
    }
    ctx.setSubject("member", updated.userId);
    return { federated: updated.federated, address: updated.federated ? `@${updated.handle}@${siteHost()}` : null };
  },
});

export const myRemoteFollowers = defineService({
  name: "members.remoteFollowers",
  summary: "Your followers on other fediverse servers.",
  kind: "query",
  permission: "authenticated",
  input: z.object({}),
  output: z.object({ count: z.number().int(), handles: z.array(z.string()) }),
  handler: async (_input, ctx) => {
    if (ctx.actor.kind !== "user") throw new ServiceError("permission", "Sign in to continue.");
    const rows = await ctx.tx.select().from(memberRemoteFollowers).where(eq(memberRemoteFollowers.userId, ctx.actor.userId)).orderBy(desc(memberRemoteFollowers.createdAt)).limit(200);
    return { count: rows.length, handles: rows.map((r) => r.handle ?? r.actorUri) };
  },
});

export async function onMemberPosted(payload: unknown): Promise<void> {
  const postId = (payload as { postId?: string } | null)?.postId;
  if (postId) await federatePost.call({ postId }, { kind: "system" });
}

export async function onMemberPostDeleted(payload: unknown): Promise<void> {
  const { postId, authorId } = (payload ?? {}) as { postId?: string; authorId?: string };
  if (postId && authorId) await federateDelete.call({ postId, authorId }, { kind: "system" });
}

/**
 * The public ActivityPub and WebFinger documents, for the routes that serve
 * them. Null whenever the site or the member does not federate.
 */
export const federationDocument = defineService({
  name: "members.federationDocument",
  summary: "A federating member's WebFinger record, actor, outbox, follower count, or one of their public notes.",
  kind: "query",
  permission: "public",
  external: false,
  input: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("webfinger"), handle: z.string().max(60) }),
    z.object({ kind: z.literal("actor"), handle: z.string().max(60) }),
    z.object({ kind: z.literal("outbox"), handle: z.string().max(60) }),
    z.object({ kind: z.literal("followers"), handle: z.string().max(60) }),
    z.object({ kind: z.literal("note"), id: uuid }),
  ]),
  output: z.record(z.string(), z.unknown()).nullable(),
  handler: async (input, ctx) => {
    if (input.kind === "note") {
      const [post] = await ctx.tx.select().from(memberPosts).where(eq(memberPosts.id, input.id));
      if (!post || !federable(post)) return null;
      const [author] = await ctx.tx.select().from(memberProfiles).where(eq(memberProfiles.userId, post.authorId));
      if (!author || !(await federatedMember(ctx, author.handle))) return null;
      return { "@context": CONTEXT[0], ...noteFor(post, author.handle) };
    }
    const member = await federatedMember(ctx, input.handle);
    if (!member) return null;
    const id = actorId(member.handle);
    switch (input.kind) {
      case "webfinger":
        return {
          subject: `acct:${member.handle}@${siteHost()}`,
          aliases: [id, `${origin()}/@${member.handle}`],
          links: [
            { rel: "self", type: ACTIVITY_JSON, href: id },
            { rel: "http://webfinger.net/rel/profile-page", type: "text/html", href: `${origin()}/@${member.handle}` },
          ],
        };
      case "actor":
        return actorDocument(member, (await actorKeys(ctx, member.userId)).publicKeyPem);
      case "outbox": {
        const notes = await publicNotes(ctx, member);
        return {
          "@context": CONTEXT[0],
          id: `${id}/outbox`,
          type: "OrderedCollection",
          totalItems: notes.length,
          orderedItems: notes.map((note) => ({ id: `${note.id}/activity`, type: "Create", actor: id, published: note.published, to: note.to, cc: note.cc, object: note })),
        };
      }
      case "followers": {
        // How many, never who.
        const [row] = await ctx.tx.select({ n: sql<number>`count(*)::int` }).from(memberRemoteFollowers).where(eq(memberRemoteFollowers.userId, member.userId));
        return { "@context": CONTEXT[0], id: `${id}/followers`, type: "OrderedCollection", totalItems: row?.n ?? 0 };
      }
    }
  },
});

export default [federatePost, federateDelete, federationInbox, setMyFederation, myRemoteFollowers, federationDocument];

