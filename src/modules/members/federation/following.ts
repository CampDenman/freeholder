// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.32 (MASTER.md §44.11): a member follows fediverse accounts from here.
//
// `@user@host` is resolved with WebFinger and the actor document, both
// fetched through the DNS-pinned transport, outside any transaction. The
// Follow is signed by the member's actor and delivered by the same queue as
// everything else (core.ts). Once the remote server accepts, that account's
// public posts — and only those, only from accounts the member follows —
// arrive in the member's inbox and are kept as plain text, never as remote
// HTML. Remote Update, Delete and Block are honoured.
import { randomUUID } from "node:crypto";
import { and, desc, eq, inArray, isNull, lt, sql } from "drizzle-orm";
import { z } from "zod";
import { env } from "@/core/env";
import { listed, okResult, row, timestamp } from "@/core/contract";
import { defineOrchestratedService, defineService, ServiceError, type ServiceContext } from "@/core/service";
import { requestPinned } from "@/core/webhooks/transport";
import { memberFederationDeliveries, memberProfiles, memberRemoteFollowers, memberRemoteFollows, memberRemotePosts } from "../schema";
import { actorId, fetchRemoteActor, siteFederates } from "./core";

const CONTEXT = "https://www.w3.org/ns/activitystreams";
const PUBLIC = new Set(["https://www.w3.org/ns/activitystreams#Public", "as:Public", "Public"]);
const MAX_TEXT = 5000;

/** The scheme to reach a host: plain HTTP only for loopback outside production. */
function schemeFor(host: string): "http" | "https" {
  const local = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i.test(host);
  return local && env().NODE_ENV !== "production" ? "http" : "https";
}

function parseAddress(address: string): { user: string; host: string } | null {
  const match = /^@?([a-z0-9_.-]{1,64})@([a-z0-9.-]{1,253}(?::\d{1,5})?)$/i.exec(address.trim());
  return match ? { user: match[1]!, host: match[2]!.toLowerCase() } : null;
}

/** HTML from another server, reduced to plain text. Nothing of it is ever rendered as markup. */
export function plainText(html: string): string {
  const text = html
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, "")
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\/\s*p\s*>/gi, "\n\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_m, n: string) => String.fromCodePoint(Math.min(Number(n), 0x10ffff)))
    .replace(/&amp;/g, "&")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return text.length > MAX_TEXT ? `${text.slice(0, MAX_TEXT - 1)}…` : text;
}

const found = z.object({ actorUri: z.string().url(), inboxUri: z.string().url(), handle: z.string(), displayName: z.string().nullable() });
type Resolved = z.infer<typeof found> & { alsoKnownAs: string[] };

/** Resolve `@user@host` to its actor. Provider I/O: never inside a transaction. */
async function resolve(address: string): Promise<Resolved> {
  const parsed = parseAddress(address);
  if (!parsed) throw new ServiceError("validation", "Enter an address like @name@example.social.");
  const base = `${schemeFor(parsed.host)}://${parsed.host}`;
  const finger = await requestPinned("GET", `${base}/.well-known/webfinger?resource=${encodeURIComponent(`acct:${parsed.user}@${parsed.host}`)}`, null, { accept: "application/jrd+json, application/json" }, { timeoutMs: 8_000, maxResponseBytes: 100_000 }).catch(() => null);
  if (!finger || finger.status !== 200) throw new ServiceError("not_found", "That account could not be found.");
  let links: { rel?: string; type?: string; href?: string }[] = [];
  try {
    links = ((JSON.parse(finger.body) as { links?: typeof links }).links ?? []).filter(Boolean);
  } catch {
    throw new ServiceError("not_found", "That account could not be found.");
  }
  const self = links.find((l) => l.rel === "self" && /activity\+json|ld\+json/.test(l.type ?? ""))?.href;
  if (!self) throw new ServiceError("not_found", "That account does not federate.");
  const actor = await fetchRemoteActor(self).catch(() => null);
  if (!actor) throw new ServiceError("not_found", "That account could not be read.");
  return { actorUri: actor.id, inboxUri: actor.inbox, handle: `${actor.preferredUsername ?? parsed.user}@${new URL(actor.id).host}`, displayName: null, alsoKnownAs: [actor.alsoKnownAs ?? []].flat() };
}

async function federatingSelf(ctx: ServiceContext) {
  if (ctx.actor.kind !== "user") throw new ServiceError("permission", "Sign in to continue.");
  const [me] = await ctx.tx.select().from(memberProfiles).where(eq(memberProfiles.userId, ctx.actor.userId));
  if (!me || me.status !== "active") throw new ServiceError("permission", "Join the site first.");
  if (!(await siteFederates(ctx)) || !me.federated) throw new ServiceError("validation", "Join the fediverse in your settings first.");
  return me;
}

export const addRemoteFollow = defineService({
  name: "members.addRemoteFollow",
  summary: "Record a follow of a resolved fediverse account and queue the signed Follow.",
  kind: "mutation",
  permission: "authenticated",
  external: false,
  agentCallable: false,
  writeClass: "write",
  input: found,
  output: okResult,
  handler: async (input, ctx) => {
    const me = await federatingSelf(ctx);
    const actor = actorId(me.handle);
    const followId = `${actor}#follows/${randomUUID()}`;
    await ctx.tx
      .insert(memberRemoteFollows)
      .values({ userId: me.userId, actorUri: input.actorUri, inboxUri: input.inboxUri, handle: input.handle, displayName: input.displayName, followId })
      .onConflictDoUpdate({ target: [memberRemoteFollows.userId, memberRemoteFollows.actorUri], set: { inboxUri: input.inboxUri, followId, state: "pending" } });
    await ctx.tx.insert(memberFederationDeliveries).values({ userId: me.userId, inboxUri: input.inboxUri, activity: { "@context": CONTEXT, id: followId, type: "Follow", actor, object: input.actorUri } });
    ctx.setSubject("member", me.userId);
    return { ok: true as const };
  },
});

export const followRemote = defineOrchestratedService({
  name: "members.followRemote",
  summary: "Follow an account on another fediverse server by its address, like @name@example.social.",
  kind: "mutation",
  permission: "authenticated",
  agentCallable: false,
  writeClass: "write",
  rateLimit: { limit: 60, windowSeconds: 3600, message: "You are following accounts very quickly. Please wait a little.", subject: (_i, actor) => (actor.kind === "user" ? actor.userId : undefined) },
  input: z.object({ address: z.string().trim().min(3).max(320) }),
  output: z.object({ handle: z.string() }),
  handler: async (input, actor) => {
    const { alsoKnownAs: _aliases, ...target } = await resolve(input.address);
    await addRemoteFollow.call(target, actor);
    return { handle: target.handle };
  },
});

export const unfollowRemote = defineService({
  name: "members.unfollowRemote",
  summary: "Stop following a fediverse account.",
  kind: "mutation",
  permission: "authenticated",
  writeClass: "write",
  input: z.object({ actorUri: z.string().url().max(2000) }),
  output: okResult,
  handler: async (input, ctx) => {
    if (ctx.actor.kind !== "user") throw new ServiceError("permission", "Sign in to continue.");
    const [follow] = await ctx.tx.delete(memberRemoteFollows).where(and(eq(memberRemoteFollows.userId, ctx.actor.userId), eq(memberRemoteFollows.actorUri, input.actorUri))).returning();
    if (!follow) return { ok: true as const };
    await forgetUnfollowedPosts(ctx, [follow.actorUri]);
    const [me] = await ctx.tx.select().from(memberProfiles).where(eq(memberProfiles.userId, ctx.actor.userId));
    if (me) {
      const actor = actorId(me.handle);
      await ctx.tx.insert(memberFederationDeliveries).values({ userId: me.userId, inboxUri: follow.inboxUri, activity: { "@context": CONTEXT, id: `${follow.followId}#undo`, type: "Undo", actor, object: { id: follow.followId, type: "Follow", actor, object: follow.actorUri } } });
    }
    return { ok: true as const };
  },
});

export const remoteFollows = defineService({
  name: "members.remoteFollows",
  summary: "The fediverse accounts you follow, and whether each has accepted.",
  kind: "query",
  permission: "authenticated",
  input: z.object({}),
  output: z.object({ follows: listed(row({ actorUri: z.string(), handle: z.string(), state: z.enum(["pending", "accepted"]) })) }),
  handler: async (_input, ctx) => {
    if (ctx.actor.kind !== "user") throw new ServiceError("permission", "Sign in to continue.");
    const follows = await ctx.tx
      .select({ actorUri: memberRemoteFollows.actorUri, handle: memberRemoteFollows.handle, state: memberRemoteFollows.state })
      .from(memberRemoteFollows)
      .where(eq(memberRemoteFollows.userId, ctx.actor.userId))
      .orderBy(desc(memberRemoteFollows.createdAt));
    return { follows };
  },
});

export const remoteFeed = defineService({
  name: "members.remoteFeed",
  summary: "Public posts from fediverse accounts you follow, newest first, optionally within a window.",
  kind: "query",
  permission: "authenticated",
  input: z.object({ before: z.coerce.date().optional(), after: z.coerce.date().optional(), limit: z.number().int().min(1).max(100).default(40) }),
  output: z.object({ posts: listed(row({ id: z.string(), handle: z.string(), url: z.string().nullable(), text: z.string(), publishedAt: timestamp })) }),
  handler: async (input, ctx) => {
    if (ctx.actor.kind !== "user") throw new ServiceError("permission", "Sign in to continue.");
    const posts = await ctx.tx
      .select({ id: memberRemotePosts.id, handle: memberRemoteFollows.handle, url: memberRemotePosts.url, text: memberRemotePosts.text, publishedAt: memberRemotePosts.publishedAt })
      .from(memberRemotePosts)
      .innerJoin(memberRemoteFollows, and(eq(memberRemoteFollows.actorUri, memberRemotePosts.actorUri), eq(memberRemoteFollows.userId, ctx.actor.userId), eq(memberRemoteFollows.state, "accepted")))
      .where(and(isNull(memberRemotePosts.deletedAt), input.before ? lt(memberRemotePosts.publishedAt, input.before) : undefined, input.after ? sql`${memberRemotePosts.publishedAt} >= ${input.after}` : undefined))
      .orderBy(desc(memberRemotePosts.publishedAt))
      .limit(input.limit);
    return { posts };
  },
});

type Activity = Record<string, unknown>;
const idOf = (value: unknown): string | undefined => (typeof value === "string" ? value : typeof (value as { id?: unknown } | undefined)?.id === "string" ? (value as { id: string }).id : undefined);
const addressed = (note: Activity, activity: Activity) =>
  [note.to, note.cc, activity.to, activity.cc].flatMap((v): unknown[] => (Array.isArray(v) ? (v as unknown[]) : v ? [v] : [])).some((v) => typeof v === "string" && PUBLIC.has(v));

/**
 * C12.32: what the inbox does with activities about accounts a member follows.
 * Returns true when it handled the activity. `actor` is the verified sender.
 */
export async function applyFollowedActivity(ctx: ServiceContext, memberId: string, memberActor: string, activity: Activity, actor: { id: string }, moveTarget?: { id: string; inbox: string; alsoKnownAs: string[] }): Promise<boolean> {
  const [follow] = await ctx.tx.select().from(memberRemoteFollows).where(and(eq(memberRemoteFollows.userId, memberId), eq(memberRemoteFollows.actorUri, actor.id)));
  const object = activity.object as Activity | string | undefined;
  switch (activity.type) {
    case "Accept":
    case "Reject": {
      if (!follow) return false;
      const target = typeof object === "object" ? object : undefined;
      const matches = idOf(object) === follow.followId || (target?.type === "Follow" && idOf(target.actor) === memberActor && idOf(target.object) === actor.id);
      if (!matches) return false;
      if (activity.type === "Accept") await ctx.tx.update(memberRemoteFollows).set({ state: "accepted" }).where(eq(memberRemoteFollows.id, follow.id));
      else await ctx.tx.delete(memberRemoteFollows).where(eq(memberRemoteFollows.id, follow.id));
      return true;
    }
    case "Create":
    case "Update": {
      if (follow?.state !== "accepted" || typeof object !== "object" || object.type !== "Note") return false;
      const id = idOf(object);
      if (!id || idOf(object.attributedTo) !== actor.id || new URL(id).host !== new URL(actor.id).host || !addressed(object, activity)) return false;
      const text = plainText(typeof object.content === "string" ? object.content : "");
      if (!text) return false;
      const url = typeof object.url === "string" && /^https?:\/\//.test(object.url) ? object.url : null;
      if (activity.type === "Update") {
        await ctx.tx.update(memberRemotePosts).set({ text, url }).where(and(eq(memberRemotePosts.objectId, id), eq(memberRemotePosts.actorUri, actor.id)));
        return true;
      }
      const published = typeof object.published === "string" && !Number.isNaN(Date.parse(object.published)) ? new Date(Math.min(Date.parse(object.published), Date.now())) : new Date();
      await ctx.tx.insert(memberRemotePosts).values({ actorUri: actor.id, objectId: id, url, text, publishedAt: published }).onConflictDoNothing();
      return true;
    }
    case "Delete": {
      const id = idOf(object);
      if (!id) return false;
      if (id === actor.id) {
        // The account itself is gone: forget it and what it posted.
        await ctx.tx.delete(memberRemoteFollows).where(eq(memberRemoteFollows.actorUri, actor.id));
        await ctx.tx.update(memberRemotePosts).set({ deletedAt: new Date() }).where(eq(memberRemotePosts.actorUri, actor.id));
        return false; // core.ts also forgets it as a follower.
      }
      await ctx.tx.update(memberRemotePosts).set({ deletedAt: new Date() }).where(and(eq(memberRemotePosts.objectId, id), eq(memberRemotePosts.actorUri, actor.id)));
      return true;
    }
    case "Move": {
      // C12.33: a followed account moved. Follow the new one only if it names the old one back.
      if (!follow || idOf(object) !== actor.id || !moveTarget || idOf(activity.target) !== moveTarget.id || !moveTarget.alsoKnownAs.includes(actor.id)) return false;
      const followId = `${memberActor}#follows/${randomUUID()}`;
      await ctx.tx.delete(memberRemoteFollows).where(eq(memberRemoteFollows.id, follow.id));
      await ctx.tx
        .insert(memberRemoteFollows)
        .values({ userId: memberId, actorUri: moveTarget.id, inboxUri: moveTarget.inbox, handle: `${follow.handle.split("@")[0]}@${new URL(moveTarget.id).host}`, followId })
        .onConflictDoNothing();
      await ctx.tx.insert(memberFederationDeliveries).values([
        { userId: memberId, inboxUri: moveTarget.inbox, activity: { "@context": CONTEXT, id: followId, type: "Follow", actor: memberActor, object: moveTarget.id } },
        { userId: memberId, inboxUri: follow.inboxUri, activity: { "@context": CONTEXT, id: `${follow.followId}#undo`, type: "Undo", actor: memberActor, object: { id: follow.followId, type: "Follow", actor: memberActor, object: actor.id } } },
      ]);
      return true;
    }
    case "Block": {
      if (idOf(object) !== memberActor) return false;
      await ctx.tx.delete(memberRemoteFollows).where(and(eq(memberRemoteFollows.userId, memberId), eq(memberRemoteFollows.actorUri, actor.id)));
      await ctx.tx.delete(memberRemoteFollowers).where(and(eq(memberRemoteFollowers.userId, memberId), eq(memberRemoteFollowers.actorUri, actor.id)));
      return true;
    }
    default:
      return false;
  }
}

/** Posts nobody here follows any more are dropped. */
export async function forgetUnfollowedPosts(ctx: ServiceContext, actorUris: string[]): Promise<void> {
  if (!actorUris.length) return;
  const still = await ctx.tx.selectDistinct({ actorUri: memberRemoteFollows.actorUri }).from(memberRemoteFollows).where(inArray(memberRemoteFollows.actorUri, actorUris));
  const gone = actorUris.filter((a) => !still.some((s) => s.actorUri === a));
  if (gone.length) await ctx.tx.delete(memberRemotePosts).where(inArray(memberRemotePosts.actorUri, gone));
}

const MAX_ALIASES = 5;

export const applyFediverseAliases = defineService({
  name: "members.applyFediverseAliases",
  summary: "Store the resolved accounts that are also you.",
  kind: "mutation",
  permission: "authenticated",
  external: false,
  agentCallable: false,
  writeClass: "write",
  input: z.object({ actorUris: z.array(z.string().url().max(2000)).max(MAX_ALIASES) }),
  output: okResult,
  handler: async (input, ctx) => {
    const me = await federatingSelf(ctx);
    await ctx.tx.update(memberProfiles).set({ fediverseAliases: [...new Set(input.actorUris)], updatedAt: new Date() }).where(eq(memberProfiles.userId, me.userId));
    return { ok: true as const };
  },
});

/** C12.33: name your accounts elsewhere, so a Move from one of them to here can be trusted. */
export const setFediverseAliases = defineOrchestratedService({
  name: "members.setFediverseAliases",
  summary: "Say which accounts on other servers are also you, so you can move from one of them to here.",
  kind: "mutation",
  permission: "authenticated",
  agentCallable: false,
  writeClass: "write",
  input: z.object({ addresses: z.array(z.string().trim().min(3).max(320)).max(MAX_ALIASES) }),
  output: z.object({ aliases: listed(z.string()) }),
  handler: async (input, actor) => {
    const actorUris = [];
    for (const address of input.addresses) actorUris.push((await resolve(address)).actorUri);
    await applyFediverseAliases.call({ actorUris }, actor);
    return { aliases: actorUris };
  },
});

export const applyMove = defineService({
  name: "members.applyMove",
  summary: "Record that you moved to another account and tell your followers.",
  kind: "mutation",
  permission: "authenticated",
  external: false,
  agentCallable: false,
  writeClass: "write",
  input: z.object({ target: z.string().url().max(2000) }),
  output: z.object({ notified: z.number().int() }),
  handler: async (input, ctx) => {
    const me = await federatingSelf(ctx);
    const actor = actorId(me.handle);
    await ctx.tx.update(memberProfiles).set({ movedTo: input.target, updatedAt: new Date() }).where(eq(memberProfiles.userId, me.userId));
    const followers = await ctx.tx.select().from(memberRemoteFollowers).where(eq(memberRemoteFollowers.userId, me.userId));
    const inboxes = [...new Set(followers.map((f) => f.sharedInboxUri ?? f.inboxUri))];
    if (inboxes.length) {
      await ctx.tx.insert(memberFederationDeliveries).values(inboxes.map((inboxUri) => ({ userId: me.userId, inboxUri, activity: { "@context": CONTEXT, id: `${actor}#moves/${randomUUID()}`, type: "Move", actor, object: actor, target: input.target } })));
    }
    ctx.setSubject("member", me.userId);
    return { notified: inboxes.length };
  },
});

/**
 * C12.33: move this account's audience to an account elsewhere. The new
 * account must already name this one in its alsoKnownAs — the same check
 * every remote server makes before following the move.
 */
export const moveToRemote = defineOrchestratedService({
  name: "members.moveToRemote",
  summary: "Move to an account on another server: your fediverse followers are asked to follow it instead.",
  kind: "mutation",
  permission: "authenticated",
  agentCallable: false,
  writeClass: "write",
  input: z.object({ address: z.string().trim().min(3).max(320) }),
  output: z.object({ notified: z.number().int(), target: z.string() }),
  handler: async (input, actor) => {
    const target = await resolve(input.address);
    const me = await moveSource.call({}, actor);
    if (!target.alsoKnownAs.includes(me.actor)) throw new ServiceError("validation", "On the new account, first add this one as an alias (also known as), then move.");
    const { notified } = await applyMove.call({ target: target.actorUri }, actor);
    return { notified, target: target.actorUri };
  },
});

export const moveSource = defineService({
  name: "members.moveSource",
  summary: "Your fediverse actor, for checking a move.",
  kind: "query",
  permission: "authenticated",
  external: false,
  input: z.object({}),
  output: z.object({ actor: z.string() }),
  handler: async (_input, ctx) => ({ actor: actorId((await federatingSelf(ctx)).handle) }),
});

export default [addRemoteFollow, followRemote, unfollowRemote, remoteFollows, remoteFeed, applyFediverseAliases, setFediverseAliases, applyMove, moveToRemote, moveSource];
