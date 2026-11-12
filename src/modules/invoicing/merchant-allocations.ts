// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.38: capture each seller's portion without splitting the customer's invoice.
import { eq } from "drizzle-orm";
import { z } from "zod";
import { lockContactIdentityForRead } from "@/core/contacts/identity-lock";
import { defineService, ServiceError, type ServiceContext } from "@/core/service";
import { allocateMerchantAmounts } from "./merchant-allocation-amounts";
import { marketFeeMinor } from "./market-policy";
import { invoiceLines, invoiceMarketPolicies, invoiceMerchantAllocations, invoiceMerchantAllocationLines, invoices } from "./schema";

export const invoiceMerchantLineOwner = z.object({
  invoiceLineId: z.uuid(), sellerUserId: z.uuid().nullable(), merchantContactId: z.uuid().nullable(), requiresShipping: z.boolean(),
});
type Resolver = (invoiceId: string, ctx: ServiceContext) => Promise<z.infer<typeof invoiceMerchantLineOwner>[] | null>;
let resolver: Resolver | undefined;
/** Startup-only registration: resolve original order facts through shared services. */
export function registerInvoiceMerchantLineResolver(next: Resolver): void { resolver = next; }

export const captureInvoiceMerchantAllocations = defineService({
  name: "invoicing.captureMerchantAllocations", summary: "Freeze original seller portions and line ownership on a draft member order invoice.",
  kind: "mutation", permission: "system", external: false,
  input: z.object({ invoiceId: z.uuid() }), output: z.object({ captured: z.boolean() }),
  handler: async ({ invoiceId }, ctx) => {
    await lockContactIdentityForRead(ctx.tx);
    const [invoice] = await ctx.tx.select().from(invoices).where(eq(invoices.id, invoiceId)).for("update");
    if (!invoice || invoice.status !== "draft") throw new ServiceError("conflict", "Freeze merchant portions before issuing their draft invoice.");
    const [existing] = await ctx.tx.select({ id: invoiceMerchantAllocations.id }).from(invoiceMerchantAllocations).where(eq(invoiceMerchantAllocations.invoiceId, invoiceId)).limit(1);
    if (existing) return { captured: true };
    const [policy] = await ctx.tx.select().from(invoiceMarketPolicies).where(eq(invoiceMarketPolicies.invoiceId, invoiceId));
    if (!policy || invoice.sourceType !== "order") return { captured: false };
    const supplied = await resolver?.(invoiceId, ctx);
    if (!supplied) throw new ServiceError("conflict", "The original seller line owners need reconciliation before issue.");
    const owners = invoiceMerchantLineOwner.array().parse(supplied);
    const byLine = new Map(owners.map(owner => [owner.invoiceLineId, owner]));
    const lines = await ctx.tx.select().from(invoiceLines).where(eq(invoiceLines.invoiceId, invoiceId));
    if (byLine.size !== owners.length || owners.length !== lines.length || lines.some(line => !byLine.has(line.id))) throw new ServiceError("conflict", "Each original invoice line needs exactly one merchant owner.");
    const parts = allocateMerchantAmounts(invoice, lines.map(line => ({ ...line, ...byLine.get(line.id)! })), policy.siteFeeBps);
    if (parts.reduce((sum, part) => sum + BigInt(part.feeMinor), 0n) !== BigInt(policy.feeMinor)) throw new ServiceError("conflict", "The original invoice application fee and seller portions differ.");
    if (policy.model === "seller_merchant" && (parts.length !== 1 || parts[0]!.sellerUserId !== policy.sellerUserId)) throw new ServiceError("conflict", "The original direct merchant does not own this invoice's portions.");
    for (const { lineIds, ...part } of parts) {
      const originalOwners = lineIds.map(id => byLine.get(id)!);
      const merchantContactId = originalOwners[0]!.merchantContactId;
      if (originalOwners.some(owner => owner.merchantContactId !== merchantContactId) || part.sellerUserId === null && merchantContactId !== null) throw new ServiceError("conflict", "The original merchant portion has conflicting contact ownership.");
      const [allocation] = await ctx.tx.insert(invoiceMerchantAllocations).values({ ...part, invoiceId, merchantContactId, sellerKey: part.sellerUserId === null ? "site" : `seller:${part.sellerUserId}` }).returning({ id: invoiceMerchantAllocations.id });
      await ctx.tx.insert(invoiceMerchantAllocationLines).values(lineIds.map(invoiceLineId => {
        const line = lines.find(row => row.id === invoiceLineId)!;
        const revenueMinor = line.subtotalMinor - line.discountMinor;
        return { invoiceLineId, allocationId: allocation!.id, requiresShipping: byLine.get(invoiceLineId)!.requiresShipping, revenueMinor, feeMinor: part.sellerUserId === null ? 0 : marketFeeMinor(revenueMinor, policy.siteFeeBps) };
      }));
    }
    ctx.setSubject("invoice", invoiceId);
    return { captured: true };
  },
});

export default [captureInvoiceMerchantAllocations];
