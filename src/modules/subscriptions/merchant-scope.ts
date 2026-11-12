// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.38: freeze new seller agreements before any setup, invoice or access.
import { createHash } from "node:crypto";
import { eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { getService, ServiceError, type ServiceContext, type Tx } from "@/core/service";
import { getMerchantCollectionConfiguration } from "@/modules/invoicing/merchant-collection";
import { subscriptionMerchantScopes, subscriptionProviderChargeReceipts, subscriptions } from "./schema";
import { subscriptionMerchantScope, type subscriptionTaxDestination } from "./merchant-scope-contract";
import type { SubscriptionMarketPolicy } from "./market-policy";

const profileReceipt = z.object({ profileId: z.uuid(), profileVersion: z.number().int().positive(), liability: z.enum(["platform", "seller"]) });
export const merchantSubscriptionUndo = z.object({ movedIds: z.array(z.uuid()).max(5000), originalEvidence: z.array(z.object({ kind: z.enum(["scope", "cash"]), id: z.uuid(), fingerprint: z.string().regex(/^[a-f0-9]{64}$/) })).max(5000) });

/** Store bounded fingerprints rather than personal destinations in merge history. */
export async function subscriptionOriginalEvidence(tx: Tx, contactIds: string[]) {
  const rows = await tx.select({ id: subscriptionMerchantScopes.subscriptionId, material: sql<string>`to_jsonb(${subscriptionMerchantScopes})::text` })
    .from(subscriptionMerchantScopes).innerJoin(subscriptions, eq(subscriptions.id, subscriptionMerchantScopes.subscriptionId))
    .where(inArray(subscriptions.contactId, contactIds)).orderBy(subscriptionMerchantScopes.subscriptionId).limit(5001);
  if (rows.length > 5000) return { evidence: [], overflow: true };
  const charges = await tx.select({ id: subscriptionProviderChargeReceipts.id, material: sql<string>`to_jsonb(${subscriptionProviderChargeReceipts})::text` })
    .from(subscriptionProviderChargeReceipts).innerJoin(subscriptions, eq(subscriptions.id, subscriptionProviderChargeReceipts.subscriptionId))
    .where(inArray(subscriptions.contactId, contactIds)).orderBy(subscriptionProviderChargeReceipts.id).limit(5001 - rows.length);
  if (rows.length + charges.length > 5000) return { evidence: [], overflow: true };
  const fingerprint = (row: { id: string; material: string }, kind: "scope" | "cash") => ({ kind, id: row.id, fingerprint: createHash("sha256").update(row.material).digest("hex") });
  return { evidence: [...rows.map(row => fingerprint(row, "scope")), ...charges.map(row => fingerprint(row, "cash"))], overflow: false };
}

/** Existing agreements never call this helper or consult today's configuration. */
export async function captureOriginalMerchantScope(ctx: ServiceContext, subscription: typeof subscriptions.$inferSelect, policy: SubscriptionMarketPolicy, destination: z.infer<typeof subscriptionTaxDestination> | undefined): Promise<void> {
  if (subscription.merchantScopeVersion !== 1 || policy.model !== "seller_merchant") return;
  const [existing] = await ctx.tx.select().from(subscriptionMerchantScopes).where(eq(subscriptionMerchantScopes.subscriptionId, subscription.id));
  if (existing) return;
  if (!policy.providerAccountId || !policy.sellerUserId || !destination) throw new ServiceError("validation", "Declare the buyer's tax destination before accepting this merchant agreement.");
  const configuration = await ctx.callAsSystem(getMerchantCollectionConfiguration, {});
  if (!configuration) throw new ServiceError("conflict", "Verify the original collection platform before accepting a new merchant agreement.");
  const taxService = getService("invoicing.currentMerchantTaxProfile");
  if (!taxService) throw new ServiceError("conflict", "The merchant tax profile service is unavailable; this new agreement cannot be accepted.");
  // The tax query shares the stable profile row lock with semantic revisions.
  const tax = profileReceipt.parse(await ctx.callAsSystem(taxService, { sellerUserId: policy.sellerUserId }));
  if (tax.liability !== "seller") throw new ServiceError("conflict", "This seller agreement needs its deliberately declared original seller tax policy.");
  const facts = subscriptionMerchantScope.parse({ subscriptionId: subscription.id, agreementRoutingVersion: 1,
    providerScheduleApiVersion: "2026-10-28.endive",
    collectionKind: configuration.collectionKind, providerPlatformAccountId: configuration.providerPlatformAccountId,
    chargeAccountId: configuration.collectionKind === "direct" ? policy.providerAccountId : null,
    recipientAccountId: policy.providerAccountId, settlementMerchantAccountId: policy.providerAccountId,
    taxProfileId: tax.profileId, taxProfileVersion: tax.profileVersion, taxLiability: tax.liability, taxDestination: destination });
  await ctx.tx.execute(sql`select set_config('freeholder.subscription_scope_v1','1',true)`);
  await ctx.tx.insert(subscriptionMerchantScopes).values(facts);
}
