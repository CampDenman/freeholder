// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
import { desc } from "drizzle-orm";
import { z } from "zod";
import { listed, row, uuid } from "@/core/contract";
import { defineService } from "@/core/service";
import { attachPluginContactColumn } from "@/core/plugins/spine";
import { communityMembers, communitySpaces } from "./schema";

attachPluginContactColumn({
  table: "community_members",
  schema: communityMembers,
  label: "A community membership",
  scope: "plugins.community",
});

export const createCommunitySpace = defineService({
  name: "community.createSpace",
  summary: "Open a community space.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({
    slug: z.string().min(1).max(80),
    title: z.string().min(1).max(120),
  }),
  output: row({ id: uuid, slug: z.string(), title: z.string() }),
  handler: async (input, ctx) => {
    const [row] = await ctx.tx.insert(communitySpaces).values(input).returning();
    ctx.setSubject("community_space", row!.id);
    return row!;
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
  output: row({ id: uuid, spaceId: uuid, contactId: uuid, role: z.string() }),
  handler: async (input, ctx) => {
    const [row] = await ctx.tx.insert(communityMembers).values(input).returning();
    ctx.setSubject("community_member", row!.id);
    ctx.queueEvent("community.joined", { id: row!.id, contactId: row!.contactId });
    return row!;
  },
});

export const listCommunitySpaces = defineService({
  name: "community.listSpaces",
  summary: "Community spaces on this instance.",
  kind: "query",
  permission: "scoped",
  input: z.object({}),
  output: listed(row({ id: uuid, slug: z.string(), title: z.string() })),
  handler: (_input, ctx) =>
    ctx.tx.select().from(communitySpaces).orderBy(desc(communitySpaces.createdAt)),
});

export default [createCommunitySpace, joinCommunity, listCommunitySpaces];
