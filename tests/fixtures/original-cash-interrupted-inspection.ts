// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// PREPARED/UNRUN. Actual isolated process and committed admission before FIRST
// bank callback; an unresolved real adapter GET is terminated by the parent.
import { z } from "zod";
async function inspect(){try{
 const[{merchantRefundSource},{prepareMerchantCashReturnInspection,performMerchantCashReturnInspection,recordCashReturnPrimaryObservation,recordCashReturnObservation},{createStripePayments},{merchantPaymentEvidence},{recordMerchantRefundObservation}]=await Promise.all([import("@/modules/invoicing/merchant-refund-origin"),import("@/modules/invoicing/merchant-cash-return-service"),import("@/adapters/payments/stripe"),import("@/modules/invoicing/merchant-payment-observations"),import("@/modules/invoicing/merchant-refund-observations")]);
 const source=merchantRefundSource.parse(JSON.parse(z.string().parse(process.argv[2]))),claim=await prepareMerchantCashReturnInspection.call({source},{kind:"system"});
 globalThis.fetch=async(input,init={})=>{const url=new URL(typeof input==="string"?input:input instanceof URL?input.href:input.url);if(url.origin!=="https://api.stripe.com"||init.method!=="GET")throw Error("The interrupted cash inspection permits only its fictional original-account GET.");
  if(url.pathname==="/v1/account")return Response.json({id:claim.providerPlatformAccountId});
  if(url.pathname===`/v1/payment_intents/${claim.paymentProviderRef}`){process.send?.({inspectionId:claim.inspectionId});return new Promise<Response>(()=>{});}
  throw Error("Unexpected interrupted original cash GET path.");};
 const stripe=createStripePayments({secretKey:"sk_original_inspection_child_fixture_only",webhookSecrets:["whsec_original_inspection_child_fixture_only"]});
 const inspectCash=stripe.inspectMerchantReturnedCash?.bind(stripe);if(!inspectCash)throw Error("The real original-account GET adapter is required.");
 await performMerchantCashReturnInspection(claim,()=>inspectCash({providerPlatformAccountId:claim.providerPlatformAccountId,providerApiVersion:claim.providerApiVersion,...(claim.providerAccountId?{providerAccountId:claim.providerAccountId}:{}),paymentProviderRef:claim.paymentProviderRef,
  onOriginalCashObserved:async evidence=>{await recordCashReturnPrimaryObservation.call({...claim,evidence:merchantPaymentEvidence.extend({amountMinor:z.number().int().nonnegative(),currency:z.string().regex(/^[A-Z]{3}$/)}).parse(evidence)},{kind:"system"});},
  onRefundObserved:async evidence=>{await recordMerchantRefundObservation.call({source,inspectionId:claim.inspectionId,evidence:{...evidence,providerApiVersion:evidence.providerApiVersion??null,status:evidence.providerStatus??null}},{kind:"system"});},
  onReturnStateObserved:async evidence=>{await recordCashReturnObservation.call({...claim,evidence},{kind:"system"});}}));
 throw Error("The interrupted original cash GET unexpectedly returned.");
}catch(error){process.send?.({error:error instanceof Error?error.message:"Interrupted cash inspection failed."});process.exitCode=1;}}
void inspect();
