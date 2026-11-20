// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C9.33/C12.38: reviewed original stored-method authority; no public bank tokens.
import { z } from "zod";
import { merchantTaxDigest } from "@/modules/invoicing/merchant-tax-store";
import type { paymentMethods } from "@/modules/invoicing/schema";
export const PRORATION_CARD_READ_PURPOSE = "gross_proration_payment_read.v1";
export const PRORATION_CARD_API_VERSION = "2026-02-25.clover" as const;
export const PRORATION_CARD_JOB = "subscriptions.collectProrationCard";
export const prorationCardTask = z.object({ prorationId: z.uuid(), originalJobId: z.uuid(), acceptedQuoteDigest: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
const account = z.string().regex(/^acct_[A-Za-z0-9]+$/).max(200);
export const prorationCardMethod = z.object({ id: z.uuid(), provider: z.literal("stripe"), providerMethodRef: z.string().regex(/^pm_[A-Za-z0-9_]+$/).max(200),
  providerCustomerRef: z.string().regex(/^cus_[A-Za-z0-9_]+$/).max(200), providerPlatformAccountId: account, providerAccountId: z.string().max(200), providerApiVersion: z.literal(PRORATION_CARD_API_VERSION), kind: z.string().min(1).max(100) }).strict();
export type ProrationCardMethod = z.infer<typeof prorationCardMethod>;
export const prorationCardSummary = z.object({ methodId: z.uuid(), label: z.string(), last4: z.string().nullable(), kind: z.string() });
export function originalProrationCardMethod(method: typeof paymentMethods.$inferSelect) {
  return prorationCardMethod.parse({ id: method.id, provider: method.provider, providerMethodRef: method.providerMethodRef, providerCustomerRef: method.providerCustomerRef,
    providerPlatformAccountId: method.providerPlatformAccountId, providerAccountId: method.providerAccountId, providerApiVersion: PRORATION_CARD_API_VERSION, kind: method.kind });
}
/** Canonical contact/label/expiry can legitimately change through shared merge
 * or a provider update. The actual provider method/customer/account may not be
 * silently rebound; ownership and active status are checked independently. */
export function prorationCardMethodDigest(method: typeof paymentMethods.$inferSelect) { return merchantTaxDigest(originalProrationCardMethod(method)); }
