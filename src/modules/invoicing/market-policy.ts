// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.38: issued invoices keep their collection model, seller and site fee.
import { eq } from "drizzle-orm";
import { z } from "zod";
import { publicMerchantSupport } from "@/core/commerce/merchant-identity";
import { lockContactIdentityForRead } from "@/core/contacts/identity-lock";
import { defineService, ServiceError, type ServiceContext } from "@/core/service";
import { invoiceMarketPolicies, invoices } from "./schema";

export const invoiceMarketPolicy = z.object({
  model: z.enum(["hold", "instant", "seller_merchant"]),
  adapter: z.string().min(1).max(100),
  siteFeeBps: z.number().int().min(0).max(10_000),
  holdDays: z.number().int().min(0).max(365),
  feeMinor: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  sellerUserId: z.uuid().nullable(),
  merchantName: z.string().min(1).max(200).nullable(),
  merchantSupport: publicMerchantSupport.nullable().default(null),
  merchantContactId:z.uuid().nullable().default(null),
  providerAccountId: z.string().min(1).max(200).nullable(),
});
export type InvoiceMarketPolicy = z.infer<typeof invoiceMarketPolicy>;
/** Preserve exact minor units even when multiplying a large invoice by bps. */
export function marketFeeMinor(amountMinor: number, basisPoints: number): number {
  if (!Number.isSafeInteger(amountMinor) || amountMinor < 0 || !Number.isInteger(basisPoints) || basisPoints < 0 || basisPoints > 10_000) throw new ServiceError("validation", "That market fee is outside its valid range.");
  return Number(BigInt(amountMinor) * BigInt(basisPoints) / 10_000n);
}
type Resolver = (invoiceId: string, ctx: ServiceContext) => Promise<InvoiceMarketPolicy | null>;
let resolver: Resolver | undefined;
let verifyMerchant: ((invoiceId: string, ctx: ServiceContext) => Promise<void>) | undefined;

/** Trusted module startup registers a shared-service query, never provider I/O. */
export function registerInvoiceMarketResolver(next: Resolver): void { resolver = next; }
export function registerInvoiceMerchantVerifier(next: (invoiceId: string, ctx: ServiceContext) => Promise<void>): void { verifyMerchant = next; }
export async function verifyInvoiceMerchant(invoiceId: string, ctx: ServiceContext): Promise<void> {
  if (!verifyMerchant) throw new ServiceError("conflict", "Direct seller payments are unavailable in this build.");
  await verifyMerchant(invoiceId, ctx);
}

export const captureInvoiceMarketPolicy = defineService({
  name: "invoicing.captureInvoiceMarketPolicy", summary: "Freeze a member invoice's collection model and merchant before issue.",
  kind: "mutation", permission: "system", external: false,
  input: z.object({ invoiceId: z.uuid() }), output: z.object({ captured: z.boolean() }),
  handler: async ({ invoiceId }, ctx) => {
    await lockContactIdentityForRead(ctx.tx);
    const [existing] = await ctx.tx.select().from(invoiceMarketPolicies).where(eq(invoiceMarketPolicies.invoiceId, invoiceId));
    if (existing) return { captured: true };
    const [invoice] = await ctx.tx.select().from(invoices).where(eq(invoices.id, invoiceId)).limit(1);
    if (!invoice || invoice.status !== "draft") throw new ServiceError("conflict", "Capture the market policy while issuing its draft invoice.");
    const supplied = await resolver?.(invoiceId, ctx);
    if (!supplied) return { captured: false };
    const policy = invoiceMarketPolicy.parse(supplied);
    if (policy.model === "seller_merchant" && (policy.adapter !== "stripe_connect" || !policy.sellerUserId || !policy.merchantName || !policy.providerAccountId || policy.feeMinor >= invoice.totalMinor && invoice.totalMinor > 0)) {
      throw new ServiceError("conflict", "This seller invoice needs a verified merchant account and a valid application fee.");
    }
    await ctx.tx.insert(invoiceMarketPolicies).values({ invoiceId, ...policy });
    ctx.setSubject("invoice", invoiceId);
    return { captured: true };
  },
});

export const getInvoiceMarketPolicy = defineService({
  name: "invoicing.marketPolicy", summary: "Read the immutable collection policy for internal payment and payout composition.",
  kind: "query", permission: "system", external: false,
  input: z.object({ invoiceId: z.uuid() }), output: invoiceMarketPolicy.nullable(),
  handler: async ({ invoiceId }, ctx) => {
    const [policy] = await ctx.tx.select().from(invoiceMarketPolicies).where(eq(invoiceMarketPolicies.invoiceId, invoiceId));
    return policy ? invoiceMarketPolicy.parse(policy) : null;
  },
});

export default [captureInvoiceMarketPolicy, getInvoiceMarketPolicy];
