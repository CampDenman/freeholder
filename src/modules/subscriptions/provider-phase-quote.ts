// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.38: real agreement/calendar facts choose every future tax quotation.
import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";
import { lockContactIdentityForRead } from "@/core/contacts/identity-lock";
import { defineService, ServiceError, type ServiceContext } from "@/core/service";
import { invoiceLines, invoices, paymentMethods, payments, taxExemptions } from "@/modules/invoicing/schema";
import { merchantPaymentRecoveryDebt } from "@/modules/invoicing/merchant-payment-debt";
import { merchantTaxPreviewOutput, previewMerchantTax } from "@/modules/invoicing/merchant-tax-preview";
import { merchantTaxDigest } from "@/modules/invoicing/merchant-tax-store";
import { periodEnd } from "./calendar";
import { subscriptionMerchantScope } from "./merchant-scope-contract";
import { originalMerchantTerms } from "./merchant-terms-read";
import { assertPhaseHorizon, exactProviderDate, freezeProviderPhase, originalPhaseFee, providerPhase, providerPhaseInventory, type ProviderPhase } from "./provider-phase-contract";
import { scheduleCallerHasStopped, scheduleKnownResources, scheduleOperationDigest } from "./provider-schedule-proof";
import { subscriptionProviderScheduleOperations, subscriptionProviderScheduleResources } from "./provider-schedule-schema";
import { subscriptionMarketPolicies, subscriptionMerchantScopes, subscriptionProviderChargeReceipts, subscriptions } from "./schema";

async function exemptionFingerprint(ctx:ServiceContext,profileId:string,contactId:string){
  const rows=await ctx.tx.select().from(taxExemptions).where(and(eq(taxExemptions.merchantProfileId,profileId),eq(taxExemptions.contactId,contactId))).orderBy(asc(taxExemptions.id)).limit(5001);
  if(rows.length>5000)throw new ServiceError("conflict","The original exemption history exceeds the bounded horizon proof.");
  // Fingerprint the actual source; no taxpayer identifiers are copied into the plan.
  return merchantTaxDigest(rows);
}

async function proveOriginalPeriod(ctx:ServiceContext,parent:typeof subscriptions.$inferSelect,terms:NonNullable<Awaited<ReturnType<typeof originalMerchantTerms>>>){
  if(parent.status==="trialing"){
    if(!parent.trialEndsAt||parent.trialEndsAt.getTime()!==parent.currentPeriodEnd.getTime()||terms.snapshot.trialDays<=0)throw new ServiceError("conflict","Restore the actually started original trial calendar before scheduling its paid periods.");
    return {sourceInvoiceId:null,kind:"accepted_trial_end" as const};
  }
  const sourceId=`${parent.id}:${parent.currentPeriodStart.toISOString()}`;
  const [invoice]=await ctx.tx.select().from(invoices).where(and(eq(invoices.sourceType,"subscription"),eq(invoices.sourceId,sourceId))).limit(1).for("share");
  if(!invoice||invoice.status!=="paid"||invoice.paidMinor!==invoice.totalMinor||invoice.refundedMinor!==0||invoice.contactId!==parent.contactId||invoice.currency!==parent.currency)throw new ServiceError("conflict","Pay and reconcile the actual original first-period invoice before starting a separate renewal schedule.");
  const lines=await ctx.tx.select().from(invoiceLines).where(eq(invoiceLines.invoiceId,invoice.id)).orderBy(invoiceLines.position).limit(3);
  if(!lines.length||lines.length>2||lines.some(line=>{
    const proof=line.snapshot&&typeof line.snapshot==="object"&&!Array.isArray(line.snapshot)?line.snapshot as Record<string,unknown>:null;
    return !proof||line.sourceType!=="subscription"||line.sourceId!==parent.id||proof.subscriptionTermsId!==terms.id
      ||proof.subscriptionPeriodStart!==parent.currentPeriodStart.toISOString()||proof.subscriptionPeriodEnd!==parent.currentPeriodEnd.toISOString();
  }))throw new ServiceError("conflict","The paid invoice does not prove this original accepted period.");
  const money=await ctx.tx.select().from(payments).where(eq(payments.invoiceId,invoice.id)).orderBy(payments.id).limit(5001);
  if(money.length>5000)throw new ServiceError("conflict","The original first-period money history exceeds the bounded proof.");
  for(const payment of money){
    if((await ctx.callAsSystem(merchantPaymentRecoveryDebt,{paymentId:payment.id})).pending)throw new ServiceError("conflict","Resolve the original first-period cash, callers, fee and recipient debt before adding a renewal resource.");
  }
  if(invoice.totalMinor>0&&!money.length)throw new ServiceError("conflict","The original paid invoice has no retained physical payment evidence.");
  return {sourceInvoiceId:invoice.id,kind:"paid_original_period_end" as const};
}

const horizonOutput=z.object({
  subscriptionId:z.uuid(),termsId:z.uuid(),mode:z.enum(["initial","extension"]),
  anchor:z.object({kind:z.enum(["accepted_trial_end","paid_original_period_end","provider_phase_inventory"]),sourceInvoiceId:z.uuid().nullable(),sourceOperationId:z.uuid().nullable(),start:z.iso.datetime()}),
  resourceRevision:z.number().int().nonnegative(),evidenceRevision:z.number().int().nonnegative(),operationDigest:z.string().regex(/^[a-f0-9]{64}$/),
  originalScope:subscriptionMerchantScope,exemptionFingerprint:z.string().regex(/^[a-f0-9]{64}$/),
  providerScheduleRef:z.string().nullable(),providerSubscriptionRef:z.string().nullable(),providerCustomerRef:z.string(),providerMethodRef:z.string(),
  phases:z.array(providerPhase).min(1).max(10),endBehavior:z.literal("cancel"),horizonEnd:z.iso.datetime(),
  horizonDigest:z.string().regex(/^[a-f0-9]{64}$/),
  // Quoting is not physical admission. The create/update caller, actual API
  // phase inspection and original commission reconciliation remain separate.
  admissionReady:z.literal(false),requiresActualFeeSettlement:z.literal(true),
});

export const quoteMerchantProviderHorizon=defineService({
  name:"subscriptions.quoteMerchantProviderHorizon",summary:"Quote a bounded original provider calendar from accepted terms and actual retained phase inventory.",
  kind:"query",permission:"system",external:false,
  input:z.object({subscriptionId:z.uuid(),additionalPeriods:z.number().int().positive().max(10).default(3)}),output:horizonOutput,
  handler:async(input,ctx)=>{
    await lockContactIdentityForRead(ctx.tx);
    const [parent]=await ctx.tx.select().from(subscriptions).where(eq(subscriptions.id,input.subscriptionId)).limit(1).for("share");
    if(!parent||parent.merchantScopeVersion!==1||parent.billingMode!=="provider"||parent.signupPending||parent.cancelledAt||parent.cancelAtPeriodEnd||!["active","trialing"].includes(parent.status))throw new ServiceError("conflict","This original agreement cannot admit new renewal periods.");
    const terms=await originalMerchantTerms(ctx,parent,parent.currentPeriodEnd);
    const [storedScope]=await ctx.tx.select().from(subscriptionMerchantScopes).where(eq(subscriptionMerchantScopes.subscriptionId,parent.id)).limit(1).for("share");
    const [policy]=await ctx.tx.select().from(subscriptionMarketPolicies).where(eq(subscriptionMarketPolicies.subscriptionId,parent.id)).limit(1).for("share");
    const [resource]=await ctx.tx.select().from(subscriptionProviderScheduleResources).where(eq(subscriptionProviderScheduleResources.subscriptionId,parent.id)).limit(1).for("share");
    if(!terms?.taxDestination||!storedScope||!resource||policy?.model!=="seller_merchant"||!policy.sellerUserId||terms.profileId!==storedScope.taxProfileId||terms.taxLiability!==storedScope.taxLiability
      ||parent.acceptedSetupFeeMinor!==terms.snapshot.setupFeeMinor||policy.providerAccountId!==storedScope.recipientAccountId)throw new ServiceError("conflict","Restore this agreement's original accepted business, setup obligation, tax destination and schedule journal.");
    const scope=subscriptionMerchantScope.parse(storedScope);
    const [method]=parent.paymentMethodId?await ctx.tx.select().from(paymentMethods).where(eq(paymentMethods.id,parent.paymentMethodId)).limit(1).for("share"):[];
    if(!method||method.provider!=="stripe"||method.status!=="active"||method.contactId!==parent.contactId||method.providerPlatformAccountId!==scope.providerPlatformAccountId
      ||method.providerAccountId!==(scope.chargeAccountId??"")||!method.providerCustomerRef||method.consentSource!=="provider_checkout"
      ||resource.providerCustomerRef&&resource.providerCustomerRef!==method.providerCustomerRef)throw new ServiceError("conflict","This original renewal needs the actually consented method in its frozen platform, charge and customer namespace.");
    const operations=await ctx.tx.select().from(subscriptionProviderScheduleOperations).where(eq(subscriptionProviderScheduleOperations.subscriptionId,parent.id)).orderBy(subscriptionProviderScheduleOperations.operationRevision).limit(5001);
    if(operations.length>5000||operations.length!==resource.operationRevision||operations.some((operation,index)=>operation.operationRevision!==index+1
      ||!["confirmed","refused"].includes(operation.state)||!scheduleCallerHasStopped(operation)))throw new ServiceError("conflict","Reconcile every original physical schedule caller before quoting another remote mutation.");
    let mode:"initial"|"extension"="initial",providerScheduleRef:string|null=null,sourceOperationId:string|null=null;
    let anchor:{kind:"accepted_trial_end"|"paid_original_period_end"|"provider_phase_inventory";sourceInvoiceId:string|null;start:string};
    let retained:ProviderPhase[]=[];
    if(resource.recoveryPending)throw new ServiceError("conflict","Retain and reconcile the original schedule recovery debt before quoting more periods.");
    if(resource.operationRevision===0&&resource.state==="uncreated"&&!resource.providerSubscriptionRef&&!resource.providerCustomerRef&&!parent.providerRef){
      const [cash]=await ctx.tx.select({id:subscriptionProviderChargeReceipts.id}).from(subscriptionProviderChargeReceipts).where(eq(subscriptionProviderChargeReceipts.subscriptionId,parent.id)).limit(1);
      if(cash)throw new ServiceError("conflict","Original scheduled cash survived without its creation history. Recover that resource instead of treating this as a new schedule.");
      const proved=await proveOriginalPeriod(ctx,parent,terms);
      anchor={...proved,start:parent.currentPeriodEnd.toISOString()};
    }else{
      mode="extension";
      if(resource.state!=="active"||resource.recoveryPending||!resource.providerSubscriptionRef||parent.providerRef!==resource.providerSubscriptionRef)throw new ServiceError("conflict","Recover the actual original schedule and its logical linkage before extending its horizon.");
      const known=scheduleKnownResources(resource,operations);
      if(!known||known.size!==1||!known.has(resource.providerSubscriptionRef))throw new ServiceError("conflict","Reconcile every retained original remote resource before extending one of them.");
      const last=[...operations].reverse().find(operation=>operation.kind==="create"||operation.kind==="update");
      const inventory=providerPhaseInventory.safeParse(last?.providerObservation.phaseInventory);
      if(!last||last.state!=="confirmed"||!inventory.success||inventory.data.operationId!==last.id||inventory.data.requestDigest!==last.requestDigest
        ||inventory.data.providerSubscriptionRef!==resource.providerSubscriptionRef||inventory.data.providerPlatformAccountId!==scope.providerPlatformAccountId
        ||inventory.data.chargeAccountId!==scope.chargeAccountId||inventory.data.recipientAccountId!==scope.recipientAccountId||inventory.data.settlementMerchantAccountId!==scope.settlementMerchantAccountId
        ||inventory.data.providerApiVersion!==scope.providerScheduleApiVersion||inventory.data.status!=="active"||!inventory.data.currentPhaseStart)throw new ServiceError("conflict","Read and retain complete authenticated original phase inventory before extending this schedule.");
      const admitted=z.array(providerPhase).min(1).max(10).safeParse(last.originalRequest.phases);
      if(!admitted.success)throw new ServiceError("conflict","Restore the actual admitted phase quotation before extension.");
      assertPhaseHorizon(admitted.data);
      retained=inventory.data.phases.filter(phase=>phase.start>=inventory.data.currentPhaseStart!).map(({providerPriceRef,...phase})=>{void providerPriceRef;return phase;});
      if(!retained.length||retained.some(phase=>!admitted.data.some(original=>original.phaseDigest===phase.phaseDigest))||retained[0]!.start!==inventory.data.currentPhaseStart)throw new ServiceError("conflict","The provider's actual current and future phases differ from their original admitted quotes.");
      providerScheduleRef=inventory.data.providerScheduleRef;sourceOperationId=last.id;
      anchor={kind:"provider_phase_inventory",sourceInvoiceId:null,start:retained.at(-1)!.end};
    }
    exactProviderDate(anchor.start);
    if(retained.length+input.additionalPeriods>10)throw new ServiceError("conflict","The actual current/future inventory leaves fewer than the requested provider phase slots.");
    if(retained.some(phase=>phase.termsId!==terms.id||phase.profileId!==terms.profileId||phase.profileVersion!==terms.profileVersion||phase.periodAmountMinor!==terms.snapshot.periodAmountMinor))throw new ServiceError("conflict","Stop the original schedule before replacing its explicitly accepted business or commercial revision.");
    let setup=0;
    if(parent.setupFeeInvoiceId){
      const [original]=await ctx.tx.select().from(invoices).where(eq(invoices.id,parent.setupFeeInvoiceId)).limit(1).for("share");
      if(!original||original.status==="void"||original.sourceType!=="subscription"||original.sourceId?.split(":")[0]!==parent.id)throw new ServiceError("conflict","Review the original setup-fee invoice instead of omitting or rebilling it.");
    }else if(mode==="initial")setup=parent.acceptedSetupFeeMinor??0;
    const dependency=await exemptionFingerprint(ctx,terms.profileId,parent.contactId),phases=[...retained];let start=exactProviderDate(anchor.start);
    for(let index=0;index<input.additionalPeriods;index++){
      const setupFeeMinor=index===0?setup:0,end=periodEnd(start,terms.snapshot.interval,terms.snapshot.intervalCount);
      const items=[{id:"line:0",quantityMicros:1000000,unitAmountMinor:terms.snapshot.periodAmountMinor,discountMinor:0,category:terms.snapshot.taxCategoryCode,requiresShipping:terms.snapshot.requiresShipping},
        ...(setupFeeMinor?[{id:"line:1",quantityMicros:1000000,unitAmountMinor:setupFeeMinor,discountMinor:0,category:terms.snapshot.taxCategoryCode,requiresShipping:terms.snapshot.requiresShipping}]:[])];
      const quote=merchantTaxPreviewOutput.parse(await ctx.callAsSystem(previewMerchantTax,{profileId:terms.profileId,profileVersion:terms.profileVersion,contactId:parent.contactId,
        destination:terms.taxDestination,currency:parent.currency,items,shippingMinor:0,occurredAt:start}));
      const net=BigInt(terms.snapshot.periodAmountMinor)+BigInt(setupFeeMinor);
      if(net>BigInt(Number.MAX_SAFE_INTEGER)||quote.amounts.subtotalMinor!==Number(net)||quote.amounts.discountMinor!==0||quote.amounts.shippingMinor!==0||quote.sellerUserId!==policy.sellerUserId||quote.liability!==terms.taxLiability)throw new ServiceError("conflict","The actual future tax quote differs from the original agreement's seller or line amounts.");
      phases.push(freezeProviderPhase({termsId:terms.id,profileId:terms.profileId,profileVersion:terms.profileVersion,start:start.toISOString(),end:end.toISOString(),taxOccurredAt:start.toISOString(),
        currency:parent.currency,interval:terms.snapshot.interval,intervalCount:terms.snapshot.intervalCount,periodAmountMinor:terms.snapshot.periodAmountMinor,setupFeeMinor,taxMinor:quote.amounts.taxMinor,totalMinor:quote.amounts.totalMinor,
        siteFeeBps:policy.siteFeeBps,applicationFeeMinor:originalPhaseFee([terms.snapshot.periodAmountMinor,setupFeeMinor],policy.siteFeeBps),taxQuoteDigest:quote.quoteDigest}));
      start=end;
    }
    assertPhaseHorizon(phases);
    if(dependency!==await exemptionFingerprint(ctx,terms.profileId,parent.contactId))throw new ServiceError("conflict","The original exemption evidence changed during quotation. Read it again before admitting a schedule.");
    const result={subscriptionId:parent.id,termsId:terms.id,mode,anchor:{...anchor,sourceOperationId},resourceRevision:resource.operationRevision,evidenceRevision:resource.evidenceRevision,
      operationDigest:scheduleOperationDigest(operations),originalScope:scope,exemptionFingerprint:dependency,providerScheduleRef,providerSubscriptionRef:resource.providerSubscriptionRef,
      providerCustomerRef:method.providerCustomerRef,providerMethodRef:method.providerMethodRef,phases,endBehavior:"cancel" as const,horizonEnd:phases.at(-1)!.end,
      admissionReady:false as const,requiresActualFeeSettlement:true as const};
    return {...result,horizonDigest:merchantTaxDigest({version:1,kind:"original-provider-horizon",...result})};
  },
});
export default [quoteMerchantProviderHorizon];
