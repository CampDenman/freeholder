// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import { listed, row, uuid } from "@/core/contract";
import { isUniqueViolation } from "@/core/db";
import { defineService, getService, ServiceError } from "@/core/service";
import { attachPluginContactColumn } from "@/core/plugins/spine";
import { communityMembers, communitySpaces } from "./schema";

attachPluginContactColumn({
  table: "community_members",
  schema: communityMembers,
  label: "A community membership",
  scope: "plugins.community",
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
    role: z.enum(["member", "moderator"]).default("member"),
  }),
  output: memberRow,
  handler: async (input, ctx) => {
    const [space] = await ctx.tx
      .select()
      .from(communitySpaces)
      .where(eq(communitySpaces.id, input.spaceId))
      .limit(1);
    if (!space) throw new ServiceError("not_found", "No such community space.");
    try {
      const [created] = await ctx.tx.insert(communityMembers).values(input).returning();
      ctx.setSubject("community_member", created!.id);
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

export const getCommunitySpaceBySlug = defineService({
  name: "community.getBySlug",
  summary: "The public community space for a slug.",
  kind: "query",
  permission: "public",
  input: z.object({ slug: z.string().min(1).max(80) }),
  output: row({ space: spaceRow, memberCount: z.number().int() }),
  handler: async (input, ctx) => {
    const [space] = await ctx.tx
      .select()
      .from(communitySpaces)
      .where(eq(communitySpaces.slug, input.slug))
      .limit(1);
    if (!space) throw new ServiceError("not_found", "No such community space.");
    const members = await ctx.tx
      .select({ id: communityMembers.id })
      .from(communityMembers)
      .where(eq(communityMembers.spaceId, space.id));
    return { space, memberCount: members.length };
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
  input: z.object({
    slug: z.string().min(1).max(80),
    email: z.string().trim().email().toLowerCase(),
    name: z.string().trim().min(1).max(200),
  }),
  output: memberRow,
  handler: async (input, ctx) => {
    const [space] = await ctx.tx
      .select()
      .from(communitySpaces)
      .where(eq(communitySpaces.slug, input.slug))
      .limit(1);
    if (!space) throw new ServiceError("not_found", "No such community space.");
    if (space.access !== "open") {
      throw new ServiceError("permission", "This community is gated. Ask the owner to add you.");
    }
    const resolved = (await ctx.callAsSystem(getService("contacts.resolve"), {
      email: input.email,
      name: input.name,
      source: "community",
    })) as { contact: { id: string } };
    return ctx.callAsSystem(joinCommunity, {
      spaceId: space.id,
      contactId: resolved.contact.id,
    });
  },
});

export default [
  createCommunitySpace,
  joinCommunity,
  listCommunitySpaces,
  listCommunityMembers,
  getCommunitySpaceBySlug,
  joinCommunityBySlug,
];
