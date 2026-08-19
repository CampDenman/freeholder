// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import { listed, row, uuid } from "@/core/contract";
import { defineService, ServiceError } from "@/core/service";
import { attachPluginContactColumn } from "@/core/plugins/spine";
import { giftRegistries, giftRegistryItems } from "./schema";

attachPluginContactColumn({
  table: "gift_registries",
  schema: giftRegistries,
  label: "A gift registry",
  scope: "plugins.gift-registry",
});

const registryRow = row({
  id: uuid,
  contactId: uuid,
  title: z.string(),
  slug: z.string(),
});

export const createGiftRegistry = defineService({
  name: "giftRegistry.create",
  summary: "Open a gift registry for a contact.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({
    contactId: z.string().uuid(),
    title: z.string().min(1).max(120),
    slug: z.string().min(1).max(80),
  }),
  output: registryRow,
  handler: async (input, ctx) => {
    const [row] = await ctx.tx.insert(giftRegistries).values(input).returning();
    ctx.setSubject("gift_registry", row!.id);
    ctx.queueEvent("giftRegistry.created", { id: row!.id, contactId: row!.contactId });
    return row!;
  },
});

export const addGiftRegistryItem = defineService({
  name: "giftRegistry.addItem",
  summary: "Add a wished item. Payment still goes through invoicing.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({
    registryId: z.string().uuid(),
    title: z.string().min(1).max(160),
    url: z.string().url().optional(),
    amountCents: z.number().int().nonnegative().default(0),
    currency: z.string().length(3).default("USD"),
  }),
  output: row({
    id: uuid,
    registryId: uuid,
    title: z.string(),
    amountCents: z.number(),
    currency: z.string(),
  }),
  handler: async (input, ctx) => {
    const [registry] = await ctx.tx
      .select({ id: giftRegistries.id })
      .from(giftRegistries)
      .where(eq(giftRegistries.id, input.registryId))
      .limit(1);
    if (!registry) throw new ServiceError("not_found", "No such gift registry.");
    const [row] = await ctx.tx.insert(giftRegistryItems).values(input).returning();
    return row!;
  },
});

export const listGiftRegistries = defineService({
  name: "giftRegistry.list",
  summary: "Gift registries on this instance.",
  kind: "query",
  permission: "scoped",
  input: z.object({}),
  output: listed(registryRow),
  handler: (_input, ctx) =>
    ctx.tx.select().from(giftRegistries).orderBy(desc(giftRegistries.createdAt)),
});

export default [createGiftRegistry, addGiftRegistryItem, listGiftRegistries];
