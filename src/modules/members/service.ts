// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Members (MASTER.md §44.1–44.2, C12.01): joining, the member's own profile,
// and the site admin's membership controls.
//
// Joining needs a signed-in person, so the email proof that already guards the
// customer portal is also the member's proof of identity. The site never asks
// for a birthdate: a member attests that they meet the site's minimum age and,
// separately, whether they are an adult. That is the answer the site needs to
// gate adult content (§44.9) without holding data it does not need.
import { z } from "zod";
import { and, asc, eq, ilike, isNull, or, sql } from "drizzle-orm";
import { users } from "@/core/auth/schema";
import { contacts } from "@/core/contacts/schema";
import { resolveContact } from "@/core/contacts/service";
import { listed, okResult, row, timestamp, uuid } from "@/core/contract";
import { defineService, ServiceError, type Actor, type ServiceContext } from "@/core/service";
import {
  HANDLE_PATTERN,
  JOIN_POLICIES,
  MEMBER_STATUSES,
  PAYOUT_MODELS,
  VISIBILITIES,
  memberInvitations,
  memberProfiles,
  memberSettings,
} from "./schema";
import graphServices, { approvePendingFollowers, PROFILE_SETTINGS } from "./graph";
import postServices from "./posts";
import messageServices from "./messages";
import callServices from "./calls";
import listingServices from "./listings";
import payoutServices, { payoutAdapters } from "./payouts";
import protectionServices from "./protection";
import reputationServices from "./reputation";
import reportServices from "./reports";
import policyServices from "./policy";
import profileServices from "./profile";
import attachmentServices from "./attachments";
import subscriptionServices from "./member-subscriptions";
import memberServiceServices from "./member-services";
import demoServices from "./demo";
import federationServices from "./federation/core";
import e2eeServices from "./e2ee/service";
import groupCallServices from "./group-calls";
import sealedBlobServices from "./sealed-blobs";
import historyServices from "./e2ee/history";
import followingServices from "./federation/following";
import { applyMemberStatus } from "./status";
// Member export and erasure through the site's privacy requests (C12.15).
import "./data-rights";
import { siteAllowsAdult } from "./adult";
export { onOrderPaid, onRefundSucceeded } from "./payouts";
export { onInvoicePaid } from "./member-subscriptions";
export { onMemberPosted, onMemberPostDeleted } from "./federation/core";
export { onCallSeatLost } from "./call-seats";

/** Handles that would read as the site itself, or collide with its own paths. */
const RESERVED = new Set([
  "admin", "administrator", "api", "app", "billing", "blog", "book", "cart", "checkout",
  "contact", "help", "home", "login", "logout", "me", "member", "members", "moderator",
  "newsletters", "official", "owner", "portal", "privacy", "root", "security", "settings",
  "setup", "shop", "signup", "site", "staff", "support", "system", "terms", "www",
]);
const HANDLE_COOLDOWN_DAYS = 30;

const handleInput = z
  .string()
  .trim()
  .toLowerCase()
  .regex(HANDLE_PATTERN, "Use 3–30 lowercase letters, numbers or underscores.");
const displayName = z.string().trim().min(1).max(80);
const bio = z.string().trim().max(1000);

const profile = row({
  userId: uuid,
  handle: z.string(),
  displayName: z.string(),
  bio: z.string(),
  status: z.enum(MEMBER_STATUSES),
  isAdult: z.boolean(),
  bioVisibility: z.enum(VISIBILITIES),
  links: z.array(z.object({ label: z.string(), url: z.string() })),
  linksVisibility: z.enum(VISIBILITIES),
  defaultPostVisibility: z.enum(VISIBILITIES),
  isPrivate: z.boolean(),
  indexable: z.boolean(),
  readReceipts: z.boolean(),
  showAdult: z.boolean(),
  federated: z.boolean(),
  createdAt: timestamp,
});
const settings = row({
  joinPolicy: z.enum(JOIN_POLICIES),
  minimumAge: z.number().int(),
  marketplaceEnabled: z.boolean(),
  listingReview: z.boolean(),
  payoutModel: z.enum(PAYOUT_MODELS),
  holdDays: z.number().int(),
  siteFeeBps: z.number().int(),
  payoutAdapter: z.string(),
  adultContent: z.boolean(),
  federation: z.boolean(),
});

function signedInUser(actor: Actor): string {
  if (actor.kind !== "user") throw new ServiceError("permission", "Sign in to continue.");
  return actor.userId;
}

async function readSettings(ctx: ServiceContext) {
  const [found] = await ctx.tx.select().from(memberSettings).where(eq(memberSettings.id, 1));
  return {
    joinPolicy: found?.joinPolicy ?? "open",
    minimumAge: found?.minimumAge ?? 16,
    marketplaceEnabled: found?.marketplaceEnabled ?? false,
    listingReview: found?.listingReview ?? true,
    payoutModel: found?.payoutModel ?? "hold",
    holdDays: found?.holdDays ?? 14,
    siteFeeBps: found?.siteFeeBps ?? 0,
    payoutAdapter: found?.payoutAdapter ?? "manual",
    adultContent: found?.adultContent ?? false,
    federation: found?.federation ?? false,
  };
}

async function handleProblem(ctx: ServiceContext, handle: string, exceptUserId?: string): Promise<string | null> {
  if (RESERVED.has(handle)) return "That handle is reserved.";
  const [taken] = await ctx.tx
    .select({ userId: memberProfiles.userId })
    .from(memberProfiles)
    .where(eq(memberProfiles.handle, handle));
  if (taken && taken.userId !== exceptUserId) return "That handle is taken.";
  return null;
}

function shape(found: typeof memberProfiles.$inferSelect) {
  return {
    userId: found.userId,
    handle: found.handle,
    displayName: found.displayName,
    bio: found.bio,
    status: found.status,
    isAdult: found.isAdult,
    bioVisibility: found.bioVisibility,
    links: found.links,
    linksVisibility: found.linksVisibility,
    defaultPostVisibility: found.defaultPostVisibility,
    isPrivate: found.isPrivate,
    indexable: found.indexable,
    readReceipts: found.readReceipts,
    showAdult: found.showAdult,
    federated: found.federated,
    createdAt: found.createdAt,
  };
}

export const membershipRules = defineService({
  name: "members.settings",
  summary: "How people join this site, the minimum age, and whether members may sell.",
  kind: "query",
  permission: "public",
  input: z.object({}),
  output: settings,
  handler: async (_input, ctx) => readSettings(ctx),
});

export const updateMembershipRules = defineService({
  name: "members.updateSettings",
  summary: "Set how people join, the minimum age, whether members may sell, and whether listings are reviewed first.",
  kind: "mutation",
  permission: "scoped",
  writeClass: "write",
  input: z.object({
    joinPolicy: z.enum(JOIN_POLICIES).optional(),
    minimumAge: z.number().int().min(13).max(21).optional(),
    marketplaceEnabled: z.boolean().optional(),
    listingReview: z.boolean().optional(),
    payoutModel: z.enum(PAYOUT_MODELS).optional(),
    holdDays: z.number().int().min(1).max(90).optional(),
    siteFeeBps: z.number().int().min(0).max(5000).optional(),
    payoutAdapter: z.string().trim().min(1).max(60).optional(),
    adultContent: z.boolean().optional(),
    /** C12.18: let members federate with the fediverse. */
    federation: z.boolean().optional(),
  }),
  output: settings,
  handler: async (input, ctx) => {
    const next = { ...(await readSettings(ctx)), ...Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined)) };
    const adapter = payoutAdapters().find((a) => a.id === next.payoutAdapter);
    if (!adapter) throw new ServiceError("validation", "That payout provider is not installed.");
    if (!adapter.models.includes(next.payoutModel)) {
      throw new ServiceError("validation", "That payout provider cannot run the chosen payout model.");
    }
    await ctx.tx
      .insert(memberSettings)
      .values({ id: 1, ...next })
      .onConflictDoUpdate({ target: memberSettings.id, set: { ...next, updatedAt: new Date() } });
    ctx.setSubject("member_settings", "1");
    return next;
  },
});

export const handleAvailability = defineService({
  name: "members.handleAvailable",
  summary: "Whether a handle can be claimed.",
  kind: "query",
  permission: "public",
  rateLimit: { limit: 60, windowSeconds: 60, message: "Please slow down.", subject: (_input, actor) => (actor.kind === "user" ? actor.userId : actor.request?.ip) },
  input: z.object({ handle: z.string().trim().toLowerCase().max(60) }),
  output: z.object({ available: z.boolean(), reason: z.string().nullable() }),
  handler: async (input, ctx) => {
    if (!HANDLE_PATTERN.test(input.handle)) {
      return { available: false, reason: "Use 3–30 lowercase letters, numbers or underscores." };
    }
    const reason = await handleProblem(ctx, input.handle);
    return { available: reason === null, reason };
  },
});

export const joinSite = defineService({
  name: "members.join",
  summary: "Become a member of this site with a handle and display name.",
  kind: "mutation",
  permission: "authenticated",
  writeClass: "write",
  rateLimit: { limit: 10, windowSeconds: 3600, message: "Please wait before trying again.", subject: (_input, actor) => (actor.kind === "user" ? actor.userId : undefined) },
  input: z.object({
    handle: handleInput,
    displayName,
    /** The person confirms they meet the site's minimum age. */
    meetsMinimumAge: z.literal(true),
    isAdult: z.boolean(),
  }),
  output: profile,
  handler: async (input, ctx) => {
    const userId = signedInUser(ctx.actor);
    const [person] = await ctx.tx.select({ email: users.email }).from(users).where(eq(users.id, userId));
    if (!person) throw new ServiceError("permission", "Sign in to continue.");
    const [existing] = await ctx.tx.select().from(memberProfiles).where(eq(memberProfiles.userId, userId));
    if (existing) throw new ServiceError("conflict", "You are already a member.");
    const rules = await readSettings(ctx);
    if (rules.joinPolicy === "invite") {
      const [invited] = await ctx.tx
        .update(memberInvitations)
        .set({ usedAt: new Date() })
        .where(and(eq(memberInvitations.email, person.email.toLowerCase()), isNull(memberInvitations.usedAt)))
        .returning({ id: memberInvitations.id });
      if (!invited) throw new ServiceError("permission", "Joining this site is by invitation.");
    }
    const problem = await handleProblem(ctx, input.handle);
    if (problem) throw new ServiceError("conflict", problem);
    const status = rules.joinPolicy === "approval" ? "pending" : "active";
    const [created] = await ctx.tx
      .insert(memberProfiles)
      .values({
        userId,
        handle: input.handle,
        displayName: input.displayName,
        status,
        isAdult: input.isAdult,
        ageAttestedAt: new Date(),
        statusChangedAt: new Date(),
      })
      .onConflictDoNothing()
      .returning();
    if (!created) throw new ServiceError("conflict", "That handle is taken.");
    // The member is a person in the spine like any customer.
    const { contact } = await ctx.callAsSystem(resolveContact, {
      email: person.email,
      name: input.displayName,
      source: "member_join",
    });
    await ctx.tx
      .update(contacts)
      .set({ userId })
      .where(and(eq(contacts.id, contact.id), isNull(contacts.userId)));
    ctx.setSubject("member", userId);
    ctx.queueEvent("member.joined", { userId, handle: created.handle, status });
    return shape(created);
  },
});

export const myMembership = defineService({
  name: "members.me",
  summary: "Your own member profile, if you have joined.",
  kind: "query",
  permission: "authenticated",
  input: z.object({}),
  output: profile.nullable(),
  handler: async (_input, ctx) => {
    const userId = signedInUser(ctx.actor);
    const [found] = await ctx.tx.select().from(memberProfiles).where(eq(memberProfiles.userId, userId));
    return found ? shape(found) : null;
  },
});

export const updateMyMembership = defineService({
  name: "members.updateMe",
  summary: "Change your display name, bio or handle.",
  kind: "mutation",
  permission: "authenticated",
  writeClass: "write",
  input: z.object({
    displayName: displayName.optional(),
    bio: bio.optional(),
    handle: handleInput.optional(),
    isAdult: z.boolean().optional(),
    /** C12.29: see adult posts and listings. Only adults, and only where the site allows it. */
    showAdult: z.boolean().optional(),
    ...PROFILE_SETTINGS,
  }),
  output: profile,
  handler: async (input, ctx) => {
    const userId = signedInUser(ctx.actor);
    const [found] = await ctx.tx.select().from(memberProfiles).where(eq(memberProfiles.userId, userId)).for("update");
    if (!found) throw new ServiceError("not_found", "Join the site first.");
    const changes: Partial<typeof memberProfiles.$inferInsert> = { updatedAt: new Date() };
    if (input.displayName !== undefined) changes.displayName = input.displayName;
    if (input.bio !== undefined) changes.bio = input.bio;
    for (const key of ["bioVisibility", "linksVisibility", "defaultPostVisibility", "links", "isPrivate", "indexable", "readReceipts"] as const) {
      if (input[key] !== undefined) Object.assign(changes, { [key]: input[key] });
    }
    if (input.isPrivate === false && found.isPrivate) await approvePendingFollowers(ctx, userId);
    if (input.isAdult !== undefined && input.isAdult !== found.isAdult) {
      changes.isAdult = input.isAdult;
      changes.ageAttestedAt = new Date();
      // Someone who says they are not an adult stops receiving adult content at once.
      if (!input.isAdult) changes.showAdult = false;
    }
    if (input.showAdult === true) {
      if (!(changes.isAdult ?? found.isAdult)) throw new ServiceError("permission", "Only adults can choose to see adult content.");
      if (!(await siteAllowsAdult(ctx))) throw new ServiceError("validation", "This site does not allow adult content.");
      changes.showAdult = true;
    } else if (input.showAdult === false) {
      changes.showAdult = false;
    }
    if (input.handle !== undefined && input.handle !== found.handle) {
      const last = found.handleChangedAt?.getTime() ?? 0;
      if (Date.now() - last < HANDLE_COOLDOWN_DAYS * 86_400_000) {
        throw new ServiceError("conflict", `You can change your handle once every ${HANDLE_COOLDOWN_DAYS} days.`);
      }
      const problem = await handleProblem(ctx, input.handle, userId);
      if (problem) throw new ServiceError("conflict", problem);
      changes.handle = input.handle;
      changes.handleChangedAt = new Date();
    }
    const [updated] = await ctx.tx
      .update(memberProfiles)
      .set(changes)
      .where(eq(memberProfiles.userId, userId))
      .returning();
    ctx.setSubject("member", userId);
    return shape(updated!);
  },
});

export const listMembers = defineService({
  name: "members.list",
  summary: "Members of this site, newest first, optionally by status or a search.",
  kind: "query",
  permission: "scoped",
  input: z.object({
    status: z.enum(MEMBER_STATUSES).optional(),
    search: z.string().trim().max(100).optional(),
    limit: z.number().int().min(1).max(200).default(50),
    offset: z.number().int().min(0).default(0),
  }),
  output: z.object({
    members: listed(profile.extend({ email: z.string(), statusReason: z.string().nullable() })),
    total: z.number().int(),
  }),
  handler: async (input, ctx) => {
    const filters = [
      input.status ? eq(memberProfiles.status, input.status) : undefined,
      input.search
        ? or(
            ilike(memberProfiles.handle, `%${input.search}%`),
            ilike(memberProfiles.displayName, `%${input.search}%`),
            ilike(users.email, `%${input.search}%`),
          )
        : undefined,
    ].filter((f) => f !== undefined);
    const where = filters.length ? and(...filters) : undefined;
    const rows = await ctx.tx
      .select({ member: memberProfiles, email: users.email })
      .from(memberProfiles)
      .innerJoin(users, eq(users.id, memberProfiles.userId))
      .where(where)
      .orderBy(sql`${memberProfiles.createdAt} desc`, asc(memberProfiles.handle))
      .limit(input.limit)
      .offset(input.offset);
    const [count] = await ctx.tx
      .select({ total: sql<number>`count(*)::int` })
      .from(memberProfiles)
      .innerJoin(users, eq(users.id, memberProfiles.userId))
      .where(where);
    return {
      members: rows.map((r) => ({ ...shape(r.member), email: r.email, statusReason: r.member.statusReason })),
      total: count?.total ?? 0,
    };
  },
});

export const setMemberStatus = defineService({
  name: "members.setStatus",
  summary: "Approve, suspend or reactivate a member, with a reason the record keeps.",
  kind: "mutation",
  permission: "scoped",
  writeClass: "write",
  input: z.object({
    userId: uuid,
    status: z.enum(MEMBER_STATUSES),
    reason: z.string().trim().max(500).optional(),
  }),
  output: profile,
  handler: async (input, ctx) => {
    const updated = await applyMemberStatus(ctx, input.userId, input.status, input.reason);
    ctx.setSubject("member", input.userId);
    return shape(updated);
  },
});

export const inviteMember = defineService({
  name: "members.invite",
  summary: "Invite someone by email to join an invite-only site.",
  kind: "mutation",
  permission: "scoped",
  writeClass: "write",
  input: z.object({ email: z.string().trim().email().toLowerCase().max(320) }),
  output: okResult,
  handler: async (input, ctx) => {
    const invitedBy = ctx.actor.kind === "user" ? ctx.actor.userId : null;
    await ctx.tx
      .insert(memberInvitations)
      .values({ email: input.email, invitedBy })
      .onConflictDoUpdate({ target: memberInvitations.email, set: { usedAt: null, invitedBy } });
    ctx.setSubject("member_invitation", input.email);
    return { ok: true as const };
  },
});

/** Whether a user is an active member. Later C12 services gate on this. */
export async function activeMember(ctx: ServiceContext, userId: string) {
  const [found] = await ctx.tx
    .select()
    .from(memberProfiles)
    .where(and(eq(memberProfiles.userId, userId), eq(memberProfiles.status, "active")));
  return found ?? null;
}

export default [
  ...graphServices,
  ...postServices,
  ...messageServices,
  ...callServices,
  ...listingServices,
  ...payoutServices,
  ...protectionServices,
  ...reputationServices,
  ...reportServices,
  ...policyServices,
  ...profileServices,
  ...attachmentServices,
  ...subscriptionServices,
  ...memberServiceServices,
  ...demoServices,
  ...federationServices,
  ...e2eeServices,
  ...groupCallServices,
  ...sealedBlobServices,
  ...historyServices,
  ...followingServices,
  membershipRules,
  updateMembershipRules,
  handleAvailability,
  joinSite,
  myMembership,
  updateMyMembership,
  listMembers,
  setMemberStatus,
  inviteMember,
];
