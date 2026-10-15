// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// The demo community (MASTER.md §44, C12.16): three marked members who follow
// each other, post, talk and sell, so a new site and the playground show the
// member features working. Every record is tracked by the demo run that made
// it and only those are removed on purge.
import { eq, inArray } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import {
  demoHandlerInputSchema,
  demoLoadResultSchema,
  demoPurgeResultSchema,
  demoVerifyResultSchema,
} from "@/core/onboarding/contract";
import { requireDemoHandlerRun } from "@/core/demo/handler";
import { users } from "@/core/auth/schema";
import { defineService } from "@/core/service";
import { getBusiness } from "@/core/settings/service";
import { priceListEntries, priceLists, productVariants, products } from "@/modules/catalog/schema";
import { sealMessage } from "./message-crypto";
import {
  memberConversationParticipants,
  memberConversations,
  memberFollows,
  memberListings,
  memberMessages,
  memberPosts,
  memberProfiles,
} from "./schema";

const CONTRIBUTION = { key: "members.demo-community", version: 1 } as const;

const PEOPLE = [
  { key: "ada", handle: "demo_ada", name: "[Demo] Ada Moreau", email: "ada@demo.freeholder.test" },
  { key: "ben", handle: "demo_ben", name: "[Demo] Ben Okafor", email: "ben@demo.freeholder.test" },
  { key: "cy", handle: "demo_cy", name: "[Demo] Cy Tanaka", email: "cy@demo.freeholder.test" },
] as const;

const COPY = {
  en: {
    bios: ["Photographer. Harbour light and portraits.", "Furniture maker working in walnut and oak.", "Illustrator and zine maker."],
    posts: ["[Demo] Morning light over the harbour today. #photography", "[Demo] Finished a walnut side table this week. #woodwork", "[Demo] New zine pages for followers only."],
    messages: ["[Demo] Would you photograph the side table for my shop?", "[Demo] Gladly. Thursday morning works for me."],
    listing: "[Demo] Harbour print presets",
  },
  fr: {
    bios: ["Photographe. Lumière du port et portraits.", "Ébéniste, noyer et chêne.", "Illustratrice et autrice de fanzines."],
    posts: ["[Demo] Lumière du matin sur le port aujourd’hui. #photographie", "[Demo] Table d’appoint en noyer terminée cette semaine. #ébénisterie", "[Demo] Nouvelles pages de fanzine, pour les abonnés."],
    messages: ["[Demo] Pourrais-tu photographier la table pour ma boutique ?", "[Demo] Avec plaisir. Jeudi matin me convient."],
    listing: "[Demo] Préréglages photo du port",
  },
  es: {
    bios: ["Fotógrafa. Luz del puerto y retratos.", "Ebanista en nogal y roble.", "Ilustradora y autora de fanzines."],
    posts: ["[Demo] Luz de la mañana sobre el puerto hoy. #fotografía", "[Demo] Terminé una mesa auxiliar de nogal esta semana. #carpintería", "[Demo] Nuevas páginas del fanzine, solo para seguidores."],
    messages: ["[Demo] ¿Podrías fotografiar la mesa para mi tienda?", "[Demo] Con gusto. El jueves por la mañana me viene bien."],
    listing: "[Demo] Ajustes de fotos del puerto",
  },
} as const;

export const loadDemoCommunity = defineService({
  name: "members.loadDemoFixture",
  summary: "Add three marked demo members who follow each other, post, talk and sell.",
  kind: "mutation",
  permission: "scoped",
  input: demoHandlerInputSchema,
  output: demoLoadResultSchema,
  handler: async (input, ctx) => {
    await requireDemoHandlerRun(ctx.tx, input, CONTRIBUTION, "load");
    const copy = COPY[input.locale as keyof typeof COPY] ?? COPY.en;
    const now = new Date();
    const ids: Record<string, string> = {};
    for (const [i, person] of PEOPLE.entries()) {
      const [user] = await ctx.tx.insert(users).values({ email: person.email, role: "customer" }).returning({ id: users.id });
      ids[person.key] = user!.id;
      await ctx.tx.insert(memberProfiles).values({
        userId: user!.id,
        handle: person.handle,
        displayName: person.name,
        bio: copy.bios[i]!,
        bioVisibility: "public",
        isPrivate: false,
        isAdult: true,
        ageAttestedAt: now,
      });
    }
    await ctx.tx.insert(memberFollows).values([
      { followerId: ids.ben!, followeeId: ids.ada!, status: "active" },
      { followerId: ids.cy!, followeeId: ids.ada!, status: "active" },
      { followerId: ids.ada!, followeeId: ids.ben!, status: "active" },
    ]);
    await ctx.tx.insert(memberPosts).values([
      { authorId: ids.ada!, body: copy.posts[0], visibility: "public" },
      { authorId: ids.ben!, body: copy.posts[1], visibility: "public" },
      { authorId: ids.cy!, body: copy.posts[2], visibility: "followers" },
    ]);
    const [conversation] = await ctx.tx
      .insert(memberConversations)
      .values({ kind: "direct", directKey: [ids.ada!, ids.ben!].sort().join(":"), createdBy: ids.ben! })
      .returning({ id: memberConversations.id });
    await ctx.tx.insert(memberConversationParticipants).values([
      { conversationId: conversation!.id, userId: ids.ben!, state: "active" },
      { conversationId: conversation!.id, userId: ids.ada!, state: "active" },
    ]);
    for (const [i, sender] of [ids.ben!, ids.ada!].entries()) {
      const id = randomUUID();
      await ctx.tx.insert(memberMessages).values({ id, conversationId: conversation!.id, senderId: sender, bodySealed: sealMessage(copy.messages[i]!, id) });
    }
    // A listing Ada sells: an active digital product with a price.
    const business = await ctx.callAsSystem(getBusiness, {});
    const currency = business?.baseCurrency ?? "USD";
    const [product] = await ctx.tx
      .insert(products)
      .values({ name: copy.listing, slug: `demo-ada-presets-${randomUUID().slice(0, 6)}`, kind: "digital", status: "active", publishedAt: now, sellerUserId: ids.ada! })
      .returning({ id: products.id });
    const [variant] = await ctx.tx
      .insert(productVariants)
      .values({ productId: product!.id, sku: `demo-ada-presets-${randomUUID().slice(0, 6)}`, combinationKey: "default", isDefault: true, requiresShipping: false })
      .returning({ id: productVariants.id });
    let [list] = await ctx.tx.select({ id: priceLists.id }).from(priceLists).where(eq(priceLists.currency, currency)).limit(1);
    list ??= (await ctx.tx.insert(priceLists).values({ name: `Member listings (${currency})`, currency, active: true }).returning({ id: priceLists.id }))[0];
    await ctx.tx.insert(priceListEntries).values({ priceListId: list!.id, variantId: variant!.id, amountMinor: 1500 });
    await ctx.tx.insert(memberListings).values({ productId: product!.id, sellerId: ids.ada!, review: "approved", reviewedAt: now });
    return demoLoadResultSchema.parse({
      records: [
        ...PEOPLE.map((p) => ({ fixtureKey: p.key, subjectType: "member", subjectId: ids[p.key]!, label: p.name })),
        { fixtureKey: "listing", subjectType: "product", subjectId: product!.id, label: copy.listing },
      ],
    });
  },
});

export const purgeDemoCommunity = defineService({
  name: "members.purgeDemoFixture",
  summary: "Remove only the demo members, their content and their listing made by a tracked demo run.",
  kind: "mutation",
  permission: "scoped",
  input: demoHandlerInputSchema,
  output: demoPurgeResultSchema,
  handler: async (input, ctx) => {
    await requireDemoHandlerRun(ctx.tx, input, CONTRIBUTION, "purge");
    const productIds = input.records.filter((r) => r.subjectType === "product").map((r) => r.subjectId);
    const memberIds = input.records.filter((r) => r.subjectType === "member").map((r) => r.subjectId);
    if (productIds.length) {
      await ctx.tx.delete(memberListings).where(inArray(memberListings.productId, productIds));
      await ctx.tx.delete(priceListEntries).where(inArray(priceListEntries.variantId, ctx.tx.select({ id: productVariants.id }).from(productVariants).where(inArray(productVariants.productId, productIds))));
      await ctx.tx.delete(productVariants).where(inArray(productVariants.productId, productIds));
      await ctx.tx.delete(products).where(inArray(products.id, productIds));
    }
    if (memberIds.length) {
      const conversations = await ctx.tx
        .select({ id: memberConversationParticipants.conversationId })
        .from(memberConversationParticipants)
        .where(inArray(memberConversationParticipants.userId, memberIds));
      if (conversations.length) await ctx.tx.delete(memberConversations).where(inArray(memberConversations.id, conversations.map((c) => c.id)));
      // The demo logins own everything else; deleting them cascades.
      await ctx.tx.delete(users).where(inArray(users.id, memberIds));
    }
    return demoPurgeResultSchema.parse({
      purged: input.records.map((r) => ({ subjectType: r.subjectType, subjectId: r.subjectId })),
    });
  },
});

export const verifyDemoCommunity = defineService({
  name: "members.verifyDemoFixture",
  summary: "Verify the demo members and their posts are visible.",
  kind: "query",
  permission: "scoped",
  input: demoHandlerInputSchema,
  output: demoVerifyResultSchema,
  handler: async (input, ctx) => {
    await requireDemoHandlerRun(ctx.tx, input, CONTRIBUTION, "verify");
    const memberIds = input.records.filter((r) => r.subjectType === "member").map((r) => r.subjectId);
    const profiles = memberIds.length ? await ctx.tx.select({ userId: memberProfiles.userId }).from(memberProfiles).where(inArray(memberProfiles.userId, memberIds)) : [];
    const posts = memberIds.length ? await ctx.tx.select({ id: memberPosts.id }).from(memberPosts).where(inArray(memberPosts.authorId, memberIds)) : [];
    return demoVerifyResultSchema.parse({
      outcomes: [
        {
          key: "members.demo-community.visible",
          achieved: profiles.length === PEOPLE.length && posts.length >= PEOPLE.length,
          detail: `${profiles.length} members, ${posts.length} posts`,
        },
      ],
    });
  },
});

export default [loadDemoCommunity, purgeDemoCommunity, verifyDemoCommunity];
