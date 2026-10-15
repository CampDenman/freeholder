// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Member data rights (MASTER.md §44.1, C12.15).
//
// A member's export and erasure ride the site's ordinary privacy requests
// (`privacy.createMyDataRequest`): the request is about the member's contact,
// and this source covers everything the members module holds for that
// contact's login.
//
// Export is everything about you, including the messages in your
// conversations (opened here, since the site holds their keys until C12.23).
// Reviews about you that are not yet revealed stay out, so the double-blind
// holds even in an export.
//
// Erasure, stated plainly (deploy/members-platform.md):
//   - refused while money is still moving: a payout held or due to you, or an
//     open dispute on a sale you made or bought;
//   - your profile, posts, comments, reactions, follows, friendships, blocks,
//     tags, call history and reviews you wrote are deleted;
//   - messages you sent stay in other people's conversations as "removed",
//     with their text destroyed, and you leave every conversation;
//   - your sales records are kept, because the site must keep its books, but
//     they are moved to an anonymous "erased member" and your words in sale
//     conversations are destroyed; your listings are taken down;
//   - reports you filed stay, without your name; reports about you are closed.
// It runs before the login is deleted, which would otherwise cascade over
// some of this and be blocked by the sales records.
import { and, eq, inArray, ne, or } from "drizzle-orm";
import { users } from "@/core/auth/schema";
import { contacts } from "@/core/contacts/schema";
import { registerContactPrivacySource } from "@/core/privacy/service";
import { ServiceError, type Tx } from "@/core/service";
import { products } from "@/modules/catalog/schema";
import { assets } from "@/core/media/schema";
import { openMessage, sealMessage } from "./message-crypto";
import {
  memberActorKeys,
  memberAttachments,
  memberCalls,
  memberComments,
  memberConversationParticipants,
  memberDevices,
  memberDisputes,
  memberFederationDeliveries,
  memberFollows,
  memberFriendships,
  memberListings,
  memberMentions,
  memberMessages,
  memberMlsLog,
  memberPayouts,
  memberPosts,
  memberProfiles,
  memberProfileSections,
  memberReactions,
  memberRemoteFollowers,
  memberRelations,
  memberReports,
  memberReviews,
  memberSaleFulfilments,
  memberSaleMessages,
} from "./schema";

/** The anonymous owner of an erased seller's or buyer's sales records. */
export const ERASED_MEMBER_ID = "00000000-0000-4000-8000-00000000e5ed";

async function loginOf(tx: Tx, contactId: string): Promise<string | null> {
  const [contact] = await tx.select({ userId: contacts.userId }).from(contacts).where(eq(contacts.id, contactId));
  return contact?.userId ?? null;
}

async function erasedMember(tx: Tx): Promise<string> {
  await tx
    .insert(users)
    .values({ id: ERASED_MEMBER_ID, email: "erased-member@erased.invalid", role: "customer" })
    .onConflictDoNothing();
  return ERASED_MEMBER_ID;
}

async function exportMember(tx: Tx, userId: string) {
  const [profile] = await tx.select().from(memberProfiles).where(eq(memberProfiles.userId, userId));
  if (!profile) return null;
  const seats = await tx.select().from(memberConversationParticipants).where(eq(memberConversationParticipants.userId, userId));
  const conversationIds = seats.map((s) => s.conversationId);
  const messages = conversationIds.length
    ? await tx.select().from(memberMessages).where(inArray(memberMessages.conversationId, conversationIds))
    : [];
  const sold = await tx.select().from(memberSaleFulfilments).where(eq(memberSaleFulfilments.sellerId, userId));
  const disputes = await tx.select().from(memberDisputes).where(or(eq(memberDisputes.sellerId, userId), eq(memberDisputes.buyerUserId, userId)));
  const saleThreads = await tx.select().from(memberSaleMessages).where(or(eq(memberSaleMessages.sellerId, userId), eq(memberSaleMessages.authorUserId, userId)));
  const now = new Date();
  return {
    profile,
    profileSections: await tx.select().from(memberProfileSections).where(eq(memberProfileSections.userId, userId)),
    attachments: await tx.select().from(memberAttachments).where(eq(memberAttachments.ownerId, userId)),
    posts: await tx.select().from(memberPosts).where(eq(memberPosts.authorId, userId)),
    comments: await tx.select().from(memberComments).where(eq(memberComments.authorId, userId)),
    reactions: await tx.select().from(memberReactions).where(eq(memberReactions.userId, userId)),
    following: await tx.select().from(memberFollows).where(eq(memberFollows.followerId, userId)),
    followers: await tx.select().from(memberFollows).where(eq(memberFollows.followeeId, userId)),
    friendships: await tx.select().from(memberFriendships).where(or(eq(memberFriendships.lowId, userId), eq(memberFriendships.highId, userId))),
    blocksAndMutes: await tx.select().from(memberRelations).where(eq(memberRelations.ownerId, userId)),
    conversations: seats.map((seat) => ({
      ...seat,
      messages: messages
        .filter((m) => m.conversationId === seat.conversationId)
        // C12.23: an end-to-end encrypted body exists only on members' devices.
        .map((m) => ({ id: m.id, senderId: m.senderId, createdAt: m.createdAt, endToEndEncrypted: m.e2ee, body: m.deletedAt || m.e2ee ? null : openMessage(m.bodySealed, m.id) })),
    })),
    messageDevices: (await tx.select().from(memberDevices).where(eq(memberDevices.userId, userId))).map(({ id, label, createdAt, lastSeenAt, revokedAt }) => ({ id, label, createdAt, lastSeenAt, revokedAt })),
    fediverseFollowers: (await tx.select().from(memberRemoteFollowers).where(eq(memberRemoteFollowers.userId, userId))).map(({ actorUri, handle, createdAt }) => ({ actorUri, handle, createdAt })),
    calls: await tx.select().from(memberCalls).where(or(eq(memberCalls.callerId, userId), eq(memberCalls.calleeId, userId))),
    listings: await tx.select().from(memberListings).where(eq(memberListings.sellerId, userId)),
    payouts: await tx.select().from(memberPayouts).where(eq(memberPayouts.sellerId, userId)),
    fulfilments: sold,
    disputes,
    saleMessages: saleThreads.map((m) => ({ id: m.id, orderId: m.orderId, role: m.role, mine: m.authorUserId === userId, createdAt: m.createdAt, body: openMessage(m.bodySealed, m.id) })),
    reviewsWritten: await tx.select().from(memberReviews).where(eq(memberReviews.authorId, userId)),
    reviewsAboutYou: (await tx.select().from(memberReviews).where(eq(memberReviews.subjectId, userId))).filter((r) => r.revealAt <= now && !r.hiddenAt),
    reportsYouFiled: (await tx.select().from(memberReports).where(eq(memberReports.reporterId, userId))).map(({ id, targetType, reason, details, state, createdAt }) => ({ id, targetType, reason, details, state, createdAt })),
  };
}

async function eraseMember(tx: Tx, userId: string): Promise<number> {
  const [profile] = await tx.select({ userId: memberProfiles.userId }).from(memberProfiles).where(eq(memberProfiles.userId, userId));
  const owed = await tx
    .select({ id: memberPayouts.id })
    .from(memberPayouts)
    .where(and(eq(memberPayouts.sellerId, userId), inArray(memberPayouts.state, ["held", "due", "review"])));
  const open = await tx
    .select({ id: memberDisputes.id })
    .from(memberDisputes)
    .where(and(or(eq(memberDisputes.sellerId, userId), eq(memberDisputes.buyerUserId, userId)), eq(memberDisputes.state, "open")));
  if (owed.length || open.length) {
    throw new ServiceError("conflict", "This member still has money owed to them or an open dispute. Settle those sales first, then erase.");
  }
  let affected = 0;
  const count = (rows: unknown[]) => { affected += rows.length; };
  const now = new Date();

  // Messages they sent stay as "removed" in other people's conversations.
  const sent = await tx.select({ id: memberMessages.id }).from(memberMessages).where(eq(memberMessages.senderId, userId));
  for (const m of sent) {
    await tx.update(memberMessages).set({ bodySealed: sealMessage("", m.id), deletedAt: now, senderId: null }).where(eq(memberMessages.id, m.id));
  }
  affected += sent.length;
  if (sent.length) count(await tx.delete(memberMlsLog).where(inArray(memberMlsLog.messageId, sent.map((m) => m.id))).returning({ seq: memberMlsLog.seq }));
  // Their devices, key packages and group seats (C12.23), and their presence on the fediverse (C12.18).
  count(await tx.delete(memberDevices).where(eq(memberDevices.userId, userId)).returning({ id: memberDevices.id }));
  count(await tx.delete(memberRemoteFollowers).where(eq(memberRemoteFollowers.userId, userId)).returning({ id: memberRemoteFollowers.id }));
  count(await tx.delete(memberFederationDeliveries).where(eq(memberFederationDeliveries.userId, userId)).returning({ id: memberFederationDeliveries.id }));
  count(await tx.delete(memberActorKeys).where(eq(memberActorKeys.userId, userId)).returning({ userId: memberActorKeys.userId }));
  count(await tx.delete(memberConversationParticipants).where(eq(memberConversationParticipants.userId, userId)).returning());

  // Sales records are the site's books: keep them, anonymously.
  const placeholder = await erasedMember(tx);
  const theirWords = await tx.select({ id: memberSaleMessages.id }).from(memberSaleMessages).where(eq(memberSaleMessages.authorUserId, userId));
  for (const m of theirWords) {
    await tx.update(memberSaleMessages).set({ bodySealed: sealMessage("", m.id), authorUserId: null }).where(eq(memberSaleMessages.id, m.id));
  }
  affected += theirWords.length;
  count(await tx.update(memberSaleMessages).set({ sellerId: placeholder }).where(eq(memberSaleMessages.sellerId, userId)).returning({ id: memberSaleMessages.id }));
  count(await tx.update(memberPayouts).set({ sellerId: placeholder }).where(eq(memberPayouts.sellerId, userId)).returning({ id: memberPayouts.id }));
  count(await tx.update(memberSaleFulfilments).set({ sellerId: placeholder }).where(eq(memberSaleFulfilments.sellerId, userId)).returning({ orderId: memberSaleFulfilments.orderId }));
  count(await tx.update(memberDisputes).set({ sellerId: placeholder }).where(eq(memberDisputes.sellerId, userId)).returning({ id: memberDisputes.id }));
  count(await tx.update(memberDisputes).set({ buyerUserId: placeholder }).where(eq(memberDisputes.buyerUserId, userId)).returning({ id: memberDisputes.id }));
  count(await tx.update(products).set({ sellerUserId: placeholder, status: "archived", archivedAt: now }).where(eq(products.sellerUserId, userId)).returning({ id: products.id }));

  // Everything else that is theirs goes. Rows keyed to the login would also
  // cascade when it is deleted; deleting them here makes the count honest.
  count(await tx.delete(memberReviews).where(or(eq(memberReviews.authorId, userId), eq(memberReviews.subjectId, userId))).returning({ id: memberReviews.id }));
  count(await tx.update(memberReports).set({ state: "dismissed", resolutionNote: "The member left the site.", resolvedAt: now }).where(and(eq(memberReports.subjectId, userId), eq(memberReports.state, "open"))).returning({ id: memberReports.id }));
  count(await tx.delete(memberReports).where(eq(memberReports.subjectId, userId)).returning({ id: memberReports.id }));
  count(await tx.delete(memberMentions).where(eq(memberMentions.userId, userId)).returning({ id: memberMentions.id }));
  count(await tx.delete(memberReactions).where(eq(memberReactions.userId, userId)).returning());
  count(await tx.delete(memberComments).where(eq(memberComments.authorId, userId)).returning({ id: memberComments.id }));
  count(await tx.delete(memberPosts).where(eq(memberPosts.authorId, userId)).returning({ id: memberPosts.id }));
  count(await tx.delete(memberFollows).where(or(eq(memberFollows.followerId, userId), eq(memberFollows.followeeId, userId))).returning());
  count(await tx.delete(memberFriendships).where(or(eq(memberFriendships.lowId, userId), eq(memberFriendships.highId, userId))).returning());
  count(await tx.delete(memberRelations).where(or(eq(memberRelations.ownerId, userId), eq(memberRelations.targetId, userId))).returning());
  count(await tx.delete(memberCalls).where(or(eq(memberCalls.callerId, userId), eq(memberCalls.calleeId, userId))).returning({ id: memberCalls.id }));
  // Their files go with their content: detach and trash everything they uploaded.
  count(await tx.delete(memberAttachments).where(eq(memberAttachments.ownerId, userId)).returning({ id: memberAttachments.id }));
  // An erasure purges at the next sweep rather than after the usual trash retention.
  count(await tx.update(assets).set({ status: "trashed", deletedAt: now, purgeAfter: now, updatedAt: now }).where(and(eq(assets.uploadedBy, `user:${userId}`), ne(assets.status, "trashed"))).returning({ id: assets.id }));
  count(await tx.delete(memberProfileSections).where(eq(memberProfileSections.userId, userId)).returning({ id: memberProfileSections.id }));
  count(await tx.delete(memberListings).where(eq(memberListings.sellerId, userId)).returning({ productId: memberListings.productId }));
  if (profile) count(await tx.delete(memberProfiles).where(eq(memberProfiles.userId, userId)).returning({ userId: memberProfiles.userId }));
  return affected;
}

registerContactPrivacySource({
  scope: "members",
  tables: [
    "member_profiles",
    "member_profile_sections",
    "member_attachments",
    "member_follows",
    "member_friendships",
    "member_relations",
    "member_posts",
    "member_comments",
    "member_reactions",
    "member_post_tags",
    "member_mentions",
    "member_conversations",
    "member_conversation_participants",
    "member_messages",
    "member_calls",
    "member_call_signals",
    "member_listings",
    "member_payout_accounts",
    "member_payouts",
    "member_sale_fulfilments",
    "member_disputes",
    "member_sale_messages",
    "member_reviews",
    "member_reports",
    "member_devices",
    "member_key_packages",
    "member_mls_roster",
    "member_mls_log",
    "member_actor_keys",
    "member_remote_followers",
    "member_federation_deliveries",
  ],
  eraseOrder: 10,
  exportData: async (tx, contactId) => {
    const userId = await loginOf(tx, contactId);
    return userId ? exportMember(tx, userId) : null;
  },
  erase: async (tx, contactId) => {
    const userId = await loginOf(tx, contactId);
    return { affected: userId ? await eraseMember(tx, userId) : 0 };
  },
});
