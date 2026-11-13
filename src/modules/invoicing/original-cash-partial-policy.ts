// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.38: original policy version chooses fee authority before any target math.
import { and,asc,eq } from "drizzle-orm";
import { ServiceError,type ServiceContext } from "@/core/service";
import { invoiceLines,invoiceMarketPolicies,invoiceMerchantAllocationLines,invoiceMerchantAllocations,invoices,payments } from "./schema";
import { routingForPayment } from "./merchant-charge";
import { authoritativeOriginalLineFees } from "./original-cash-partial-amounts";
export async function originalPartialFeePolicy(ctx:ServiceContext,payment:typeof payments.$inferSelect) {
  const [invoice]=await ctx.tx.select().from(invoices).where(eq(invoices.id,payment.invoiceId));
  const [policy]=await ctx.tx.select().from(invoiceMarketPolicies).where(eq(invoiceMarketPolicies.invoiceId,payment.invoiceId));
  const routing=await routingForPayment(ctx,payment.id);
  if(!invoice||!policy||![0,1].includes(policy.collectionVersion)||policy.model!=="seller_merchant"||!Number.isSafeInteger(policy.siteFeeBps)||policy.siteFeeBps<0||policy.siteFeeBps>10000)throw new ServiceError("conflict","Restore the actual original accepted invoice fee authority before partial cash targets.");
  let segmentPrincipal=invoice.totalMinor,segmentFee=policy.feeMinor;
  let lineFees:Array<{invoiceLineId:string;revenueMinor:number;feeMinor:number}>=[];
  if(policy.collectionVersion===1) {
    const rows=await ctx.tx.select({line:invoiceLines,frozen:invoiceMerchantAllocationLines,part:invoiceMerchantAllocations}).from(invoiceMerchantAllocationLines)
      .innerJoin(invoiceLines,eq(invoiceLines.id,invoiceMerchantAllocationLines.invoiceLineId)).innerJoin(invoiceMerchantAllocations,eq(invoiceMerchantAllocations.id,invoiceMerchantAllocationLines.allocationId))
      .where(eq(invoiceMerchantAllocations.invoiceId,invoice.id)).orderBy(asc(invoiceLines.id)).limit(5001);
    const own=rows.filter(row=>row.part.id===routing.merchantAllocationId),part=own[0]?.part;
    if(rows.length>5000||!part||rows.some(row=>row.frozen.revenueMinor!==row.line.subtotalMinor-row.line.discountMinor||row.line.invoiceId!==invoice.id
      ||row.frozen.feeMinor!==authoritativeOriginalLineFees([{id:row.line.id,revenueMinor:row.frozen.revenueMinor}],row.part.sellerUserId===null?0:policy.siteFeeBps,"per_line").get(row.line.id))
      ||rows.reduce((sum,row)=>sum+BigInt(row.frozen.feeMinor),0n)!==BigInt(policy.feeMinor))throw new ServiceError("conflict","Preserve the actual original per-line policy and frozen fee receipts; aggregate rounding cannot reinterpret an accepted order.");
    segmentPrincipal=part.totalMinor;segmentFee=part.feeMinor;
    lineFees=own.map(row=>({invoiceLineId:row.line.id,revenueMinor:row.frozen.revenueMinor,feeMinor:row.frozen.feeMinor}));
  } else {
    const exact=BigInt(invoice.totalMinor-invoice.taxMinor)*BigInt(policy.siteFeeBps)/10000n;
    if(exact!==BigInt(policy.feeMinor))throw new ServiceError("conflict","The actual booking/subscription invoice aggregate fee differs from its frozen accepted authority. Retain old terms and money for review instead of repricing them.");
    const rows=await ctx.tx.select().from(invoiceLines).where(eq(invoiceLines.invoiceId,invoice.id)).orderBy(asc(invoiceLines.id)).limit(5001);
    if(rows.length>5000)throw new ServiceError("conflict","Restore every real original invoice line before fee residual allocation.");
    if(invoice.shippingMinor===0) {
      const shares=authoritativeOriginalLineFees(rows.map(line=>({id:line.id,revenueMinor:line.subtotalMinor-line.discountMinor})),policy.siteFeeBps,"aggregate");
      if([...shares.values()].reduce((sum,fee)=>sum+BigInt(fee),0n)!==exact)throw new ServiceError("conflict","Original line net totals do not conserve the authoritative invoice fee.");
      lineFees=rows.map(line=>({invoiceLineId:line.id,revenueMinor:line.subtotalMinor-line.discountMinor,feeMinor:shares.get(line.id)!}));
    }
  }
  const charged=await ctx.tx.select().from(payments).where(and(eq(payments.invoiceId,invoice.id),eq(payments.status,"succeeded"))).orderBy(asc(payments.createdAt),asc(payments.id)).limit(5001);
  if(charged.length>5000||segmentPrincipal<=0)throw new ServiceError("conflict","Restore the complete original captured-principal and fee-resource inventory.");
  const resources:Array<{paymentId:string;amountMinor:number;feeMinor:number}>=[];let captured=0n;
  for(const original of charged) {
    const actual=await routingForPayment(ctx,original.id);
    if(policy.collectionVersion===1&&actual.merchantAllocationId!==routing.merchantAllocationId)continue;
    const before=captured;captured+=BigInt(original.amountMinor);
    const expected=BigInt(segmentFee)*captured/BigInt(segmentPrincipal)-BigInt(segmentFee)*before/BigInt(segmentPrincipal);
    if(captured>BigInt(segmentPrincipal)||actual.applicationFeeMinor===undefined||BigInt(actual.applicationFeeMinor)!==expected)throw new ServiceError("conflict","An original captured fee conflicts with its canonical accepted invoice policy. Preserve actual old zero/positive money; do not manufacture a replacement fee.");
    resources.push({paymentId:original.id,amountMinor:original.amountMinor,feeMinor:actual.applicationFeeMinor});
  }
  if(!resources.some(resource=>resource.paymentId===payment.id))throw new ServiceError("conflict","Restore this actual original captured fee resource before partial targets.");
  return {version:policy.collectionVersion,mode:policy.collectionVersion===1?"per_line":"aggregate",invoiceId:invoice.id,siteFeeBps:policy.siteFeeBps,invoiceFeeMinor:policy.feeMinor,segmentPrincipalMinor:segmentPrincipal,segmentFeeMinor:segmentFee,lineFees,nonLineShippingMinor:invoice.shippingMinor,resources};
}
