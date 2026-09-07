// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import { listed, okResult, row, uuid } from "@/core/contract";
import { isUniqueViolation } from "@/core/db";
import {
  defineOrchestratedService,
  defineService,
  getService,
  ServiceError,
} from "@/core/service";
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

const itemRow = row({
  id: uuid,
  registryId: uuid,
  title: z.string(),
  url: z.string().nullable(),
  amountCents: z.number(),
  currency: z.string(),
  status: z.string(),
  invoiceId: uuid.nullable(),
  lastError: z.string().nullable(),
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
    try {
      const [created] = await ctx.tx.insert(giftRegistries).values(input).returning();
      ctx.setSubject("gift_registry", created!.id);
      ctx.queueEvent("giftRegistry.created", { id: created!.id, contactId: created!.contactId });
      return created!;
    } catch (error) {
      if (isUniqueViolation(error, "gift_registries_slug_idx")) {
        throw new ServiceError("conflict", "That registry slug is already in use.");
      }
      throw error;
    }
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
  output: itemRow,
  handler: async (input, ctx) => {
    const [registry] = await ctx.tx
      .select({ id: giftRegistries.id })
      .from(giftRegistries)
      .where(eq(giftRegistries.id, input.registryId))
      .limit(1);
    if (!registry) throw new ServiceError("not_found", "No such gift registry.");
    const [created] = await ctx.tx.insert(giftRegistryItems).values(input).returning();
    return created!;
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

export const listGiftRegistryItems = defineService({
  name: "giftRegistry.listItems",
  summary: "Items on one gift registry.",
  kind: "query",
  permission: "scoped",
  input: z.object({ registryId: z.string().uuid() }),
  output: listed(itemRow),
  handler: (input, ctx) =>
    ctx.tx
      .select()
      .from(giftRegistryItems)
      .where(eq(giftRegistryItems.registryId, input.registryId))
      .orderBy(desc(giftRegistryItems.createdAt)),
});

export const getGiftRegistryBySlug = defineService({
  name: "giftRegistry.getBySlug",
  summary: "The public gift registry for a slug.",
  kind: "query",
  permission: "public",
  input: z.object({ slug: z.string().min(1).max(80) }),
  output: row({ registry: registryRow, items: listed(itemRow) }),
  handler: async (input, ctx) => {
    const [registry] = await ctx.tx
      .select()
      .from(giftRegistries)
      .where(eq(giftRegistries.slug, input.slug))
      .limit(1);
    if (!registry) throw new ServiceError("not_found", "No such gift registry.");
    const items = await ctx.tx
      .select()
      .from(giftRegistryItems)
      .where(eq(giftRegistryItems.registryId, registry.id))
      .orderBy(desc(giftRegistryItems.createdAt));
    return { registry, items };
  },
});

const claimItemInvoice = defineService({
  name: "giftRegistry.claimItemInvoice",
  summary: "Lock a registry item before invoicing.",
  kind: "mutation",
  permission: "scoped",
  external: false,
  writeClass: "money",
  input: z.object({ itemId: z.string().uuid() }),
  output: row({
    itemId: uuid,
    registryId: uuid,
    contactId: uuid,
    title: z.string(),
    amountCents: z.number(),
    currency: z.string(),
  }),
  handler: async (input, ctx) => {
    const [item] = await ctx.tx
      .select()
      .from(giftRegistryItems)
      .where(eq(giftRegistryItems.id, input.itemId))
      .limit(1);
    if (!item) throw new ServiceError("not_found", "No such gift item.");
    if (item.status === "invoiced") {
      throw new ServiceError("conflict", "That gift is already invoiced.");
    }
    if (item.status === "invoicing") {
      throw new ServiceError("conflict", "That gift is already being invoiced.");
    }
    const [registry] = await ctx.tx
      .select({ contactId: giftRegistries.contactId })
      .from(giftRegistries)
      .where(eq(giftRegistries.id, item.registryId))
      .limit(1);
    if (!registry) throw new ServiceError("not_found", "No such gift registry.");
    await ctx.tx
      .update(giftRegistryItems)
      .set({ status: "invoicing", lastError: null })
      .where(eq(giftRegistryItems.id, item.id));
    return {
      itemId: item.id,
      registryId: item.registryId,
      contactId: registry.contactId,
      title: item.title,
      amountCents: item.amountCents,
      currency: item.currency,
    };
  },
});

const applyItemInvoice = defineService({
  name: "giftRegistry.applyItemInvoice",
  summary: "Record the invoice outcome on a registry item.",
  kind: "mutation",
  permission: "scoped",
  external: false,
  writeClass: "money",
  input: z.object({
    itemId: z.string().uuid(),
    invoiceId: z.string().uuid().optional(),
    lastError: z.string().max(500).optional(),
  }),
  output: okResult,
  handler: async (input, ctx) => {
    if (input.invoiceId) {
      await ctx.tx
        .update(giftRegistryItems)
        .set({ status: "invoiced", invoiceId: input.invoiceId, lastError: null })
        .where(eq(giftRegistryItems.id, input.itemId));
    } else {
      await ctx.tx
        .update(giftRegistryItems)
        .set({
          status: "failed",
          lastError: input.lastError ?? "The invoice could not be created.",
        })
        .where(eq(giftRegistryItems.id, input.itemId));
    }
    return { ok: true as const };
  },
});

async function invoiceClaimedItem(
  claimed: {
    itemId: string;
    contactId: string;
    title: string;
    amountCents: number;
    currency: string;
  },
  payer: { contactId: string },
): Promise<{ invoiceId?: string; lastError?: string }> {
  try {
    const draft = (await getService("invoicing.createDraft").call(
      {
        contactId: payer.contactId,
        currency: claimed.currency,
        sourceType: "manual",
        sourceId: `gift-registry:${claimed.itemId}`,
        idempotencyKey: `gift-registry:${claimed.itemId}:${payer.contactId}`,
        lines: [
          {
            description: claimed.title,
            quantityMicros: 1_000_000,
            unitAmountMinor: claimed.amountCents,
          },
        ],
        tax: { mode: "not_applicable", reason: "A gift registry contribution is not a taxable sale." },
      },
      { kind: "system" },
    )) as { invoice: { id: string } };
    return { invoiceId: draft.invoice.id };
  } catch (error) {
    const message = error instanceof Error ? error.message : "The invoice could not be created.";
    return { lastError: message.slice(0, 500) };
  }
}

export const invoiceGiftRegistryItem = defineOrchestratedService({
  name: "giftRegistry.invoiceItem",
  summary: "Raise an invoice for a registry item through invoicing.",
  kind: "mutation",
  permission: "scoped",
  writeClass: "money",
  input: z.object({ itemId: z.string().uuid() }),
  output: itemRow,
  handler: async (input) => {
    const claimed = await claimItemInvoice.call(input, { kind: "system" });
    const outcome = await invoiceClaimedItem(claimed, { contactId: claimed.contactId });
    await applyItemInvoice.call({ itemId: claimed.itemId, ...outcome }, { kind: "system" });
    const listed = await listGiftRegistryItems.call(
      { registryId: claimed.registryId },
      { kind: "system" },
    );
    const item = listed.find((row) => row.id === claimed.itemId);
    if (!item) throw new ServiceError("not_found", "No such gift item.");
    return item;
  },
});

export const contributeToGiftRegistry = defineOrchestratedService({
  name: "giftRegistry.contribute",
  summary: "A visitor pays for a registry item; money still lands on an invoice.",
  kind: "mutation",
  permission: "public",
  writeClass: "money",
  rateLimit: {
    limit: 10,
    windowSeconds: 15 * 60,
    subject: (input) => input.email,
    message: "Too many gift contributions from that address. Try again shortly.",
  },
  input: z.object({
    slug: z.string().min(1).max(80),
    itemId: z.string().uuid(),
    email: z.string().trim().email().toLowerCase(),
    name: z.string().trim().min(1).max(200),
  }),
  output: itemRow,
  handler: async (input) => {
    const page = await getGiftRegistryBySlug.call({ slug: input.slug }, { kind: "anonymous" });
    const wanted = page.items.find((item) => item.id === input.itemId);
    if (!wanted) throw new ServiceError("not_found", "No such gift item.");
    const claimed = await claimItemInvoice.call({ itemId: input.itemId }, { kind: "system" });
    const resolved = (await getService("contacts.resolve").call(
      { email: input.email, name: input.name, source: "gift-registry" },
      { kind: "system" },
    )) as { contact: { id: string } };
    const outcome = await invoiceClaimedItem(claimed, { contactId: resolved.contact.id });
    await applyItemInvoice.call({ itemId: claimed.itemId, ...outcome }, { kind: "system" });
    const listed = await listGiftRegistryItems.call(
      { registryId: claimed.registryId },
      { kind: "system" },
    );
    const item = listed.find((row) => row.id === claimed.itemId);
    if (!item) throw new ServiceError("not_found", "No such gift item.");
    return item;
  },
});

export default [
  createGiftRegistry,
  addGiftRegistryItem,
  listGiftRegistries,
  listGiftRegistryItems,
  getGiftRegistryBySlug,
  claimItemInvoice,
  applyItemInvoice,
  invoiceGiftRegistryItem,
  contributeToGiftRegistry,
];
