// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.39/C11.10: profile -> ordered conversation locks make device/participant
// authority changes linear with encrypted delivery and privacy erasure.
import { asc, eq, inArray } from "drizzle-orm";
import type { Tx } from "@/core/service";
import { memberConversationParticipants, memberConversations, memberProfiles } from "./schema";

export async function lockMemberProfiles(tx: Tx, userIds: string[], mode: "share" | "update" = "update"): Promise<void> {
  if (!userIds.length) return;
  await tx.select({ userId: memberProfiles.userId }).from(memberProfiles).where(inArray(memberProfiles.userId, [...new Set(userIds)])).orderBy(asc(memberProfiles.userId)).for(mode);
}
export async function lockMemberConversations(tx: Tx, userIds: string | string[]): Promise<string[]> {
  const ids = typeof userIds === "string" ? [userIds] : userIds;
  if (!ids.length) return [];
  const seats = await tx.select({ id: memberConversationParticipants.conversationId }).from(memberConversationParticipants).where(inArray(memberConversationParticipants.userId, ids));
  const conversations = [...new Set(seats.map(row => row.id))];
  if (!conversations.length) return [];
  const rows = await tx.select({ id: memberConversations.id }).from(memberConversations).where(inArray(memberConversations.id, conversations)).orderBy(asc(memberConversations.id)).for("update");
  return rows.map(row => row.id);
}
export async function lockConversation(tx: Tx, id: string, mode: "share" | "update" = "update"): Promise<void> {
  await tx.select({ id: memberConversations.id }).from(memberConversations).where(eq(memberConversations.id, id)).for(mode);
}
