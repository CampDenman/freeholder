// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Price lists, audiences and deterministic currency-safe resolution (C5.13).

import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { listed, row, timestamp, uuid } from "@/core/contract";
import { contacts } from "@/core/contacts/schema";
import { registerContactReference } from "@/core/contacts/service";
import { registerContactPrivacySource } from "@/core/privacy/service";
import { decimalToMinor } from "@/adapters/payments/currency";
import { assertPositiveMinor } from "@/modules/invoicing/money";
import { defineService, ServiceError, type ServiceContext, type Tx } from "@/core/service";
import { PRICE_BREAK_MODES, PRICE_LIST_KINDS } from "./contract";
import { applyPriceBreaks, assertBands, type PriceBand } from "./price-breaks";
import {
  customerGroups,
  priceBreaks,
  priceListEntries,
  priceLists,
  productVariants,
} from "./schema";

const id = z.string().uuid();
const currency = z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/);

const customerGroupRow = row({
  id: uuid,
  name: z.string(),
  tag: z.string().nullable(),
  lifecycleStage: z.string().nullable(),
  taxExempt: z.boolean(),
  exemptionRef: z.string().nullable(),
  createdAt: timestamp,
  updatedAt: timestamp,
});
const priceListRow = row({
  id: uuid,
  name: z.string(),
  currency: z.string(),
  kind: z.enum(PRICE_LIST_KINDS),
  customerGroupId: uuid.nullable(),
  contactId: uuid.nullable(),
  startsAt: timestamp.nullable(),
  endsAt: timestamp.nullable(),
  priority: z.number().int(),
  active: z.boolean(),
  createdAt: timestamp,
  updatedAt: timestamp,
});
const priceListEntryRow = row({
  id: uuid,
  priceListId: uuid,
  variantId: uuid,
  amountMinor: z.number().int(),
  compareAtMinor: z.number().int().nullable(),
  createdAt: timestamp,
  updatedAt: timestamp,
});
const priceBreakRow = row({
  id: uuid,
  priceListId: uuid,
  variantId: uuid.nullable(),
  mode: z.enum(PRICE_BREAK_MODES),
  minQty: z.number().int(),
  maxQty: z.number().int().nullable(),
  unitAmountMinor: z.number().int().nullable(),
  percentOffPpm: z.number().int().nullable(),
  createdAt: timestamp,
});
const resolvedPrice = z.discriminatedUnion("available", [
  z.object({
    available: z.literal(false),
    currency: z.string(),
    variantId: uuid,
    quantity: z.number().int(),
    reason: z.string(),
  }),
  z.object({
    available: z.literal(true),
    currency: z.string(),
    variantId: uuid,
    quantity: z.number().int(),
    amountMinor: z.number().int(),
    totalMinor: z.number().int(),
    compareAtMinor: z.number().int().nullable(),
    priceListId: uuid,
    priceListName: z.string(),
    kind: z.enum(PRICE_LIST_KINDS),
    breakMode: z.enum(PRICE_BREAK_MODES).nullable(),
    breakdown: listed(z.object({ qty: z.number().int(), unitMinor: z.number().int() })),
    reason: z.string(),
  }),
]);

registerContactReference({
  table: "price_lists",
  repoint: (tx, from, to) =>
    tx.update(priceLists).set({ contactId: to }).where(eq(priceLists.contactId, from)),
  captureForUndo: async (tx, duplicateId, survivingId) => ({
    state: await tx
      .select({ id: priceLists.id, contactId: priceLists.contactId })
      .from(priceLists)
      .where(inArray(priceLists.contactId, [duplicateId, survivingId])),
    undoable: true,
  }),
  restoreAfterUndo: async (tx, beforeState, afterState, duplicateId) => {
    const schema = z.array(z.object({ id: z.string().uuid(), contactId: z.string().uuid().nullable() }));
    const before = schema.parse(beforeState);
    const after = schema.parse(afterState);
    const current = after.length
      ? await tx
          .select({ id: priceLists.id, contactId: priceLists.contactId })
          .from(priceLists)
          .where(inArray(priceLists.id, after.map((row) => row.id)))
      : [];
    const currentById = new Map(current.map((row) => [row.id, row.contactId]));
    if (current.length !== after.length || after.some((row) => currentById.get(row.id) !== row.contactId)) {
      throw new ServiceError(
        "conflict",
        "A price list changed after this merge. Leave the merge in place or restore that list first.",
      );
    }
    const movedIds = before.filter((row) => row.contactId === duplicateId).map((row) => row.id);
    if (movedIds.length) {
      await tx.update(priceLists).set({ contactId: duplicateId }).where(inArray(priceLists.id, movedIds));
    }
  },
});

registerContactPrivacySource({
  scope: "catalog.price_lists",
  tables: ["price_lists"],
  exportData: async (tx: Tx, contactId: string) =>
    tx
      .select({
        id: priceLists.id,
        name: priceLists.name,
        currency: priceLists.currency,
        kind: priceLists.kind,
      })
      .from(priceLists)
      .where(eq(priceLists.contactId, contactId)),
  erase: async (tx: Tx, contactId: string) => {
    const rows = await tx
      .update(priceLists)
      .set({ active: false, name: "Contract list (erased)" })
      .where(eq(priceLists.contactId, contactId))
      .returning({ id: priceLists.id });
    return { affected: rows.length };
  },
});

function inWindow(
  list: { startsAt: Date | null; endsAt: Date | null },
  at: Date,
): boolean {
  if (list.startsAt && list.startsAt > at) return false;
  if (list.endsAt && list.endsAt <= at) return false;
  return true;
}

export const listCustomerGroups = defineService({
  name: "catalog.listCustomerGroups",
  summary: "List audience groups used by price lists.",
  kind: "query",
  permission: "scoped",
  input: z.object({}),
  output: listed(customerGroupRow),
  handler: (_input, ctx) => ctx.tx.select().from(customerGroups).orderBy(asc(customerGroups.name)),
});

export const createCustomerGroup = defineService({
  name: "catalog.createCustomerGroup",
  summary: "Create a tag- or lifecycle-based audience for priced lists.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({
    name: z.string().trim().min(1).max(80),
    tag: z.string().trim().min(1).max(50).optional(),
    lifecycleStage: z.enum(["lead", "prospect", "customer", "repeat"]).optional(),
    taxExempt: z.boolean().default(false),
    exemptionRef: z.string().trim().min(1).max(200).optional(),
  }),
  output: customerGroupRow,
  handler: async (input, ctx) => {
    if (!input.tag && !input.lifecycleStage) {
      throw new ServiceError("validation", "A customer group needs a contact tag or a lifecycle stage.");
    }
    const [created] = await ctx.tx.insert(customerGroups).values(input).returning();
    ctx.setSubject("customerGroup", created!.id);
    return created!;
  },
});

export const listPriceLists = defineService({
  name: "catalog.listPriceLists",
  summary: "List price lists and their entry counts.",
  kind: "query",
  permission: "scoped",
  input: z.object({ currency: currency.optional(), kind: z.enum(PRICE_LIST_KINDS).optional() }),
  output: listed(priceListRow.extend({ entries: listed(priceListEntryRow) })),
  handler: async (input, ctx) => {
    const filters = [
      input.currency ? eq(priceLists.currency, input.currency) : undefined,
      input.kind ? eq(priceLists.kind, input.kind) : undefined,
    ].filter((value): value is NonNullable<typeof value> => Boolean(value));
    const lists = await ctx.tx
      .select()
      .from(priceLists)
      .where(filters.length ? and(...filters) : undefined)
      .orderBy(desc(priceLists.priority), asc(priceLists.name));
    const entries = lists.length
      ? await ctx.tx
          .select()
          .from(priceListEntries)
          .where(inArray(priceListEntries.priceListId, lists.map((list) => list.id)))
      : [];
    return lists.map((list) => ({
      ...list,
      entries: entries.filter((entry) => entry.priceListId === list.id),
    }));
  },
});

export const createPriceList = defineService({
  name: "catalog.createPriceList",
  summary: "Create a currency-specific price list with an audience and optional sale window.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({
    name: z.string().trim().min(1).max(120),
    currency,
    kind: z.enum(PRICE_LIST_KINDS).default("retail"),
    customerGroupId: id.optional(),
    contactId: id.optional(),
    startsAt: z.coerce.date().optional(),
    endsAt: z.coerce.date().optional(),
    priority: z.number().int().min(-100_000).max(100_000).default(0),
    active: z.boolean().default(true),
  }),
  output: priceListRow,
  handler: async (input, ctx) => {
    if (input.kind === "contract" && !input.contactId) {
      throw new ServiceError("validation", "A contract price list must name the contact it applies to.");
    }
    if (input.kind !== "contract" && input.contactId) {
      throw new ServiceError("validation", "Only a contract price list can name a single contact.");
    }
    if (input.contactId) {
      const [contact] = await ctx.tx.select({ id: contacts.id }).from(contacts).where(eq(contacts.id, input.contactId));
      if (!contact) throw new ServiceError("not_found", "That contact is not here.");
    }
    if (input.customerGroupId) {
      const [group] = await ctx.tx
        .select({ id: customerGroups.id })
        .from(customerGroups)
        .where(eq(customerGroups.id, input.customerGroupId));
      if (!group) throw new ServiceError("not_found", "That customer group is not here.");
    }
    const [created] = await ctx.tx.insert(priceLists).values(input).returning();
    ctx.setSubject("priceList", created!.id);
    ctx.queueEvent("catalog.priceListCreated", { priceListId: created!.id, currency: created!.currency });
    return created!;
  },
});

export const setPriceListEntry = defineService({
  name: "catalog.setPriceListEntry",
  summary: "Set the integer minor-unit price of one variant on one list.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({
    priceListId: id,
    variantId: id,
    amount: z.string().trim().min(1).max(20),
    compareAt: z.string().trim().min(1).max(20).optional(),
  }),
  output: priceListEntryRow,
  handler: async (input, ctx) => {
    const [list] = await ctx.tx.select().from(priceLists).where(eq(priceLists.id, input.priceListId));
    if (!list) throw new ServiceError("not_found", "That price list is not here.");
    const [variant] = await ctx.tx.select({ id: productVariants.id }).from(productVariants).where(eq(productVariants.id, input.variantId));
    if (!variant) throw new ServiceError("not_found", "That variant is not here.");
    let amountMinor: number;
    let compareAtMinor: number | undefined;
    try {
      amountMinor = assertPositiveMinor(decimalToMinor(input.amount, list.currency), "Price");
      compareAtMinor = input.compareAt
        ? assertPositiveMinor(decimalToMinor(input.compareAt, list.currency), "Compare-at price")
        : undefined;
    } catch (error) {
      if (error instanceof ServiceError) throw error;
      throw new ServiceError("validation", "Enter a valid amount for this currency.");
    }
    if (compareAtMinor !== undefined && compareAtMinor <= amountMinor) {
      throw new ServiceError("validation", "The compare-at price must be higher than the selling price.");
    }
    const [saved] = await ctx.tx
      .insert(priceListEntries)
      .values({
        priceListId: list.id,
        variantId: variant.id,
        amountMinor,
        compareAtMinor,
      })
      .onConflictDoUpdate({
        target: [priceListEntries.priceListId, priceListEntries.variantId],
        set: { amountMinor, compareAtMinor: compareAtMinor ?? null },
      })
      .returning();
    ctx.setSubject("priceListEntry", saved!.id);
    return saved!;
  },
});

export const setPriceBreak = defineService({
  name: "catalog.setPriceBreak",
  summary: "Add a volume or tiered quantity break to a price list or one variant.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({
    priceListId: id,
    variantId: id.optional(),
    mode: z.enum(PRICE_BREAK_MODES),
    minQty: z.number().int().positive().max(1_000_000),
    maxQty: z.number().int().positive().max(1_000_000).optional(),
    amount: z.string().trim().min(1).max(20).optional(),
    percentOffPpm: z.number().int().min(1).max(1_000_000).optional(),
  }),
  output: priceBreakRow,
  handler: async (input, ctx) => {
    if (Boolean(input.amount) === Boolean(input.percentOffPpm)) {
      throw new ServiceError("validation", "A price break needs either a unit amount or a percent off, not both.");
    }
    const [list] = await ctx.tx.select().from(priceLists).where(eq(priceLists.id, input.priceListId));
    if (!list) throw new ServiceError("not_found", "That price list is not here.");
    if (input.variantId) {
      const [variant] = await ctx.tx.select({ id: productVariants.id }).from(productVariants).where(eq(productVariants.id, input.variantId));
      if (!variant) throw new ServiceError("not_found", "That variant is not here.");
    }
    let unitAmountMinor: number | undefined;
    if (input.amount) {
      try {
        unitAmountMinor = assertPositiveMinor(decimalToMinor(input.amount, list.currency), "Break unit price");
      } catch (error) {
        if (error instanceof ServiceError) throw error;
        throw new ServiceError("validation", "Enter a valid break amount for this currency.");
      }
    }
    const existing = await ctx.tx
      .select()
      .from(priceBreaks)
      .where(
        and(
          eq(priceBreaks.priceListId, list.id),
          eq(priceBreaks.mode, input.mode),
          input.variantId ? eq(priceBreaks.variantId, input.variantId) : sql`${priceBreaks.variantId} is null`,
        ),
      );
    const next: PriceBand[] = [
      ...existing.map((row) => ({
        minQty: row.minQty,
        maxQty: row.maxQty,
        unitAmountMinor: row.unitAmountMinor,
        percentOffPpm: row.percentOffPpm,
      })),
      {
        minQty: input.minQty,
        maxQty: input.maxQty ?? null,
        unitAmountMinor: unitAmountMinor ?? null,
        percentOffPpm: input.percentOffPpm ?? null,
      },
    ];
    assertBands(next);
    const [created] = await ctx.tx
      .insert(priceBreaks)
      .values({
        priceListId: list.id,
        variantId: input.variantId,
        mode: input.mode,
        minQty: input.minQty,
        maxQty: input.maxQty,
        unitAmountMinor,
        percentOffPpm: input.percentOffPpm,
      })
      .returning();
    ctx.setSubject("priceBreak", created!.id);
    return created!;
  },
});

async function contactQualifies(
  ctx: ServiceContext,
  group: typeof customerGroups.$inferSelect | undefined,
  contactId: string | undefined,
): Promise<boolean> {
  if (!group) return true;
  if (!contactId) return false;
  const [contact] = await ctx.tx.select().from(contacts).where(eq(contacts.id, contactId));
  if (!contact) return false;
  if (group.tag && !contact.tags.includes(group.tag)) return false;
  if (group.lifecycleStage && contact.lifecycleStage !== group.lifecycleStage) return false;
  return true;
}

function rank(kind: (typeof PRICE_LIST_KINDS)[number]): number {
  if (kind === "contract") return 400;
  if (kind === "wholesale" || kind === "member") return 300;
  if (kind === "sale") return 200;
  return 100;
}

export const resolvePrice = defineService({
  name: "catalog.resolvePrice",
  summary: "Resolve one currency price for a variant and explain why that list won.",
  kind: "query",
  permission: "scoped",
  input: z.object({
    variantId: id,
    currency,
    contactId: id.optional(),
    quantity: z.number().int().positive().max(1_000_000).default(1),
    at: z.coerce.date().default(() => new Date()),
  }),
  output: resolvedPrice,
  handler: async (input, ctx) => {
    const [variant] = await ctx.tx.select().from(productVariants).where(eq(productVariants.id, input.variantId));
    if (!variant) throw new ServiceError("not_found", "That variant is not here.");
    const lists = await ctx.tx
      .select()
      .from(priceLists)
      .where(and(eq(priceLists.currency, input.currency), eq(priceLists.active, true)));
    const groups = lists.some((list) => list.customerGroupId)
      ? await ctx.tx.select().from(customerGroups)
      : [];
    const groupById = new Map(groups.map((group) => [group.id, group]));
    const qualified: typeof lists = [];
    for (const list of lists) {
      if (!inWindow(list, input.at)) continue;
      if (list.kind === "contract" && list.contactId !== input.contactId) continue;
      const group = list.customerGroupId ? groupById.get(list.customerGroupId) : undefined;
      if (list.customerGroupId && !(await contactQualifies(ctx, group, input.contactId))) continue;
      qualified.push(list);
    }
    qualified.sort((left, right) => rank(right.kind) - rank(left.kind) || right.priority - left.priority || left.name.localeCompare(right.name));
    const entries = qualified.length
      ? await ctx.tx
          .select()
          .from(priceListEntries)
          .where(
            and(
              eq(priceListEntries.variantId, variant.id),
              inArray(priceListEntries.priceListId, qualified.map((list) => list.id)),
            ),
          )
      : [];
    const winner = qualified.find((list) => entries.some((entry) => entry.priceListId === list.id));
    const entry = winner ? entries.find((row) => row.priceListId === winner.id) : undefined;
    if (!winner || !entry) {
      return {
        available: false,
        currency: input.currency,
        variantId: variant.id,
        quantity: input.quantity,
        reason: `No active ${input.currency} price list prices this variant for the current audience.`,
      };
    }
    const allBreaks = await ctx.tx
      .select()
      .from(priceBreaks)
      .where(eq(priceBreaks.priceListId, winner.id));
    const variantBreaks = allBreaks.filter((row) => row.variantId === variant.id);
    const listBreaks = allBreaks.filter((row) => row.variantId === null);
    const chosen = variantBreaks.length ? variantBreaks : listBreaks;
    const mode = chosen[0]?.mode ?? "volume";
    const mixed = chosen.some((row) => row.mode !== mode);
    if (mixed) {
      throw new ServiceError("conflict", "A price list cannot mix volume and tiered breaks for the same target.");
    }
    const priced = applyPriceBreaks(
      mode,
      entry.amountMinor,
      input.quantity,
      chosen.map((row) => ({
        minQty: row.minQty,
        maxQty: row.maxQty,
        unitAmountMinor: row.unitAmountMinor,
        percentOffPpm: row.percentOffPpm,
      })),
    );
    const listReason =
      winner.kind === "contract"
        ? `Contract list “${winner.name}” applies to this contact.`
        : winner.kind === "sale"
          ? `Sale list “${winner.name}” is inside its window.`
          : winner.kind === "retail"
            ? `Retail list “${winner.name}” is the default ${input.currency} catalog price.`
            : `Audience list “${winner.name}” is the highest-priority ${winner.kind} match.`;
    return {
      available: true,
      currency: input.currency,
      variantId: variant.id,
      quantity: input.quantity,
      amountMinor: entry.amountMinor,
      totalMinor: priced.totalMinor,
      compareAtMinor: entry.compareAtMinor,
      priceListId: winner.id,
      priceListName: winner.name,
      kind: winner.kind,
      breakMode: chosen.length ? mode : null,
      breakdown: priced.breakdown,
      reason: `${listReason} ${priced.explanation}`,
    };
  },
});

export default [
  listCustomerGroups,
  createCustomerGroup,
  listPriceLists,
  createPriceList,
  setPriceListEntry,
  setPriceBreak,
  resolvePrice,
];
