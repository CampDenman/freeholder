// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// The market's prohibited-items policy (MASTER.md §44.9, C12.28).
//
// The site owner writes what members may not sell; until they do, a starter
// policy applies (shown in the viewer's language by the page). Every change is
// a new version, and a seller accepts the current version before listing.
import { z } from "zod";
import { eq } from "drizzle-orm";
import { okResult } from "@/core/contract";
import { defineService, ServiceError, type ServiceContext } from "@/core/service";
import { memberProfiles, memberSettings } from "./schema";

export async function currentPolicy(ctx: ServiceContext): Promise<{ text: string; version: number }> {
  const [found] = await ctx.tx
    .select({ text: memberSettings.marketPolicy, version: memberSettings.marketPolicyVersion })
    .from(memberSettings)
    .where(eq(memberSettings.id, 1));
  return { text: found?.text ?? "", version: found?.version ?? 1 };
}

/** Record that this seller accepts the current policy, or refuse if they have not. */
export async function requireAcceptedPolicy(ctx: ServiceContext, userId: string, acceptsNow: boolean): Promise<void> {
  const { version } = await currentPolicy(ctx);
  const [me] = await ctx.tx.select({ accepted: memberProfiles.marketPolicyAccepted }).from(memberProfiles).where(eq(memberProfiles.userId, userId));
  if ((me?.accepted ?? 0) >= version) return;
  if (!acceptsNow) throw new ServiceError("conflict", "Read and accept the market policy before listing.");
  await ctx.tx.update(memberProfiles).set({ marketPolicyAccepted: version }).where(eq(memberProfiles.userId, userId));
}

export const marketPolicy = defineService({
  name: "members.marketPolicy",
  summary: "What members may not sell on this site, and whether you have accepted the current version.",
  kind: "query",
  permission: "public",
  input: z.object({}),
  output: z.object({ text: z.string(), custom: z.boolean(), version: z.number().int(), acceptedByYou: z.boolean() }),
  handler: async (_input, ctx) => {
    const policy = await currentPolicy(ctx);
    let acceptedByYou = false;
    if (ctx.actor.kind === "user") {
      const [me] = await ctx.tx.select({ accepted: memberProfiles.marketPolicyAccepted }).from(memberProfiles).where(eq(memberProfiles.userId, ctx.actor.userId));
      acceptedByYou = (me?.accepted ?? 0) >= policy.version;
    }
    return { text: policy.text, custom: policy.text.length > 0, version: policy.version, acceptedByYou };
  },
});

export const updateMarketPolicy = defineService({
  name: "members.updateMarketPolicy",
  summary: "Publish the site's prohibited-items policy. Leave it empty to use the starter policy. Sellers accept each new version before listing again.",
  kind: "mutation",
  permission: "scoped",
  writeClass: "write",
  input: z.object({ text: z.string().trim().max(20_000) }),
  output: okResult.extend({ version: z.number().int() }),
  handler: async (input, ctx) => {
    const policy = await currentPolicy(ctx);
    if (policy.text === input.text) return { ok: true as const, version: policy.version };
    const version = policy.version + 1;
    await ctx.tx
      .insert(memberSettings)
      .values({ id: 1, marketPolicy: input.text, marketPolicyVersion: version })
      .onConflictDoUpdate({ target: memberSettings.id, set: { marketPolicy: input.text, marketPolicyVersion: version, updatedAt: new Date() } });
    ctx.setSubject("member_settings", "1");
    ctx.queueEvent("member.marketPolicyChanged", { version });
    return { ok: true as const, version };
  },
});

export default [marketPolicy, updateMarketPolicy];
