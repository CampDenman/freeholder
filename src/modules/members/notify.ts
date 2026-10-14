// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Member-to-member notifications (MASTER.md §44, C12.13).
//
// Delivery, preferences, digests and deduplication belong to core
// notifications. This only decides whether one member should hear about
// another at all: never about yourself, never from someone you blocked or
// muted (or who blocked you), and only while you are an active member.
import { and, eq } from "drizzle-orm";
import { createNotification } from "@/core/notifications/service";
import type { ServiceContext } from "@/core/service";
import { relationBetween } from "./graph";
import { memberProfiles } from "./schema";

export type MemberTopic = "members.follow" | "members.friend" | "members.mention" | "members.comment" | "members.reaction";

export async function notifyMember(
  ctx: ServiceContext,
  input: {
    to: string;
    from: string;
    topic: MemberTopic;
    /** Catalog key prefix: `${key}.title` and `${key}.body`. */
    key: string;
    href: string;
    /** Stable for one occurrence, so retries never notify twice. */
    idempotencyKey: string;
    /** Folds repeats (for example reactions on one post) into one entry. */
    dedupeKey?: string;
  },
): Promise<void> {
  if (input.to === input.from) return;
  const [recipient] = await ctx.tx
    .select({ status: memberProfiles.status })
    .from(memberProfiles)
    .where(and(eq(memberProfiles.userId, input.to), eq(memberProfiles.status, "active")));
  if (!recipient) return;
  const [sender] = await ctx.tx
    .select({ handle: memberProfiles.handle, displayName: memberProfiles.displayName })
    .from(memberProfiles)
    .where(eq(memberProfiles.userId, input.from));
  if (!sender) return;
  const relation = await relationBetween(ctx, input.to, input.from);
  if (relation.blocked || relation.muted) return;
  await ctx.callAsSystem(createNotification, {
    recipient: { kind: "user", id: input.to },
    topic: input.topic,
    titleKey: `${input.key}.title`,
    bodyKey: `${input.key}.body`,
    messageParams: { name: sender.displayName, handle: sender.handle },
    href: input.href,
    idempotencyKey: input.idempotencyKey,
    dedupeKey: input.dedupeKey,
  });
}
