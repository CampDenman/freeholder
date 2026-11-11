// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Changing a member's standing (§44.1). Shared by members.setStatus and the
// moderation queue (C12.12), so a suspension always records its reason and
// emits the same event however it happened.
import { and, eq } from "drizzle-orm";
import { contacts } from "@/core/contacts/schema";
import { ServiceError, type ServiceContext } from "@/core/service";
import { memberProfiles, type MEMBER_STATUSES } from "./schema";

export async function applyMemberStatus(
  ctx: ServiceContext,
  userId: string,
  status: (typeof MEMBER_STATUSES)[number],
  reason: string | undefined,
): Promise<typeof memberProfiles.$inferSelect> {
  if (status !== "suspended") {
    const [erased] = await ctx.tx.select({ id: contacts.id }).from(contacts).where(and(eq(contacts.userId, userId), eq(contacts.source, "privacy-erasure"))).limit(1);
    if (erased) throw new ServiceError("conflict", "This member was erased. Release the named retention hold and finish erasure instead of reactivating the retained records.");
  }
  if (status === "suspended" && !reason) {
    throw new ServiceError("validation", "Say why this member is suspended.");
  }
  const [before] = await ctx.tx.select().from(memberProfiles).where(eq(memberProfiles.userId, userId)).for("update");
  if (!before) throw new ServiceError("not_found", "That member does not exist.");
  const [updated] = await ctx.tx
    .update(memberProfiles)
    .set({ status, statusReason: reason ?? null, statusChangedAt: new Date(), updatedAt: new Date() })
    .where(eq(memberProfiles.userId, userId))
    .returning();
  if (before.status !== status) {
    const event =
      status === "suspended"
        ? "member.suspended"
        : before.status === "pending"
          ? "member.approved"
          : "member.reactivated";
    ctx.queueEvent(event, { userId, reason: reason ?? null });
  }
  return updated!;
}
