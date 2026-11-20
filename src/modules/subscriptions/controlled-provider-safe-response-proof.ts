// Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0
// C11.10/C1.08: immutable legacy FIN evidence and a safe historical VIEW have different domains.
import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { ServiceError, type Tx } from "@/core/service";
import { merchantTaxDigest } from "@/modules/invoicing/merchant-tax-store";
import { originalCashEvidenceKeys, originalCashSigningKey } from "@/modules/invoicing/original-cash-evidence-keys";
import { signOriginalCashRecovery, verifyOriginalCashRecovery } from "@/modules/invoicing/original-cash-recovery-proof";
import { CONTROLLED_SAFE_RESPONSE_PROTOCOL, CONTROLLED_HISTORICAL_FIN_PROTOCOL, CONTROLLED_PROJECTION_KEY } from "@/adapters/payments/merchant-controlled-safe-response-contract";
import type { ControlledIngressContext, ControlledSafeProducer } from "@/adapters/payments/merchant-controlled-safe-response-contract";
import { projectControlledHistoricalRecord, controlledProjectionHasUnknown } from "@/adapters/payments/stripe-controlled-safe-response";
import { verifiedProviderReadProof } from "./provider-read-signatures";
import { subscriptionControlledFinishes } from "./controlled-provider-schema";
import type { subscriptionControlledCalls, subscriptionControlledOperations, subscriptionControlledVerifications } from "./controlled-provider-schema";
type Operation=typeof subscriptionControlledOperations.$inferSelect;
type Call=typeof subscriptionControlledCalls.$inferSelect;
type Finish=typeof subscriptionControlledFinishes.$inferSelect;
type Verification=typeof subscriptionControlledVerifications.$inferSelect;
const record=z.record(z.string(),z.unknown()),sha=z.string().regex(/^[a-f0-9]{64}$/);
const referenceBody=z.object({protocol:z.literal(CONTROLLED_HISTORICAL_FIN_PROTOCOL),operationId:z.uuid(),callId:z.uuid(),finishCallId:z.uuid(),originalFinishPgSha256:sha,originalFramePgSha256:sha,originalResultPgSha256:sha,originalSignedFrameDigest:sha,originalSdkResultDigest:sha,safeView:record,safeViewDigest:sha,safeViewPgSha256:sha}).strict();
export const controlledHistoricalFinReference=referenceBody.extend({proof:z.object({createdAt:z.iso.datetime(),digest:sha,authentication:sha}).strict()}).strict();
const REFERENCE_PURPOSE="controlled-historical-fin-reference.v1";
const authenticViews=new WeakSet<object>();
function retainedView<T extends object>(view:T):T {
 const freeze=(value:unknown):void=>{if(value&&typeof value==="object"){for(const child of Object.values(value))freeze(child);Object.freeze(value);}};
 freeze(view);authenticViews.add(view);return view;
}
function refuse():never{throw new ServiceError("conflict","Restore the exact original signed FIN, its full PostgreSQL fingerprints and authenticated safe historical reference; obtain a new actual observation for current authority.");}
export function controlledSafeCurrentResult(value:unknown):value is Record<string,unknown> {
 const parsed=record.safeParse(value);return parsed.success&&parsed.data.protocol!==CONTROLLED_HISTORICAL_FIN_PROTOCOL&&!controlledProjectionHasUnknown(parsed.data);
}
export function requireControlledSafeCurrentResult(value:unknown):Record<string,unknown> {
 if(!controlledSafeCurrentResult(value))refuse();return value;
}
export function controlledCurrentResultData(value:unknown):Record<string,unknown> {
 const result={...record.parse(value)};delete result[CONTROLLED_PROJECTION_KEY];return result;
}
const producers:Readonly<Record<string,ControlledSafeProducer>>={bootstrap:"createMerchantControlledBootstrap",discover_bootstrap:"discoverMerchantControlledBootstrap",read_bootstrap:"inspectMerchantControlledBootstrap",pause_drafts:"pauseMerchantControlledBootstrap",read_invoice:"inspectMerchantControlledInvoice",read_customer_financials:"inspectMerchantControlledCustomerFinancials",list_invoices:"listMerchantControlledInvoices",read_calendar:"inspectMerchantControlledCalendar",cancel_calendar:"cancelMerchantControlledCalendar",create_product:"createMerchantControlledTaxProduct",read_product:"inspectMerchantControlledTaxProduct",preview_proration:"previewMerchantControlledProration",preview_update:"previewMerchantControlledCalendarUpdate",update_calendar:"updateMerchantControlledCalendar",create_draft:"prepareMerchantControlledDraft",add_invoice_component:"addMerchantControlledComponent",read_manifest:"inspectMerchantControlledInvoiceManifest",set_invoice_fee:"setMerchantControlledInvoiceFee",finalize_invoice:"finalizeMerchantControlledInvoice",pay_invoice:"payMerchantControlledInvoice"};
const scalarKeys=new Set("providerSubscriptionRef providerInvoiceRef providerCustomerRef providerInvoiceItemRef componentId origin requiresIndependentRead prorationSuppressed pauseRequested completeCreditNotes createdProductRef providerPreviewRef providerProductRef providerPriceRef providerLineRef subscriptionItemRef providerApiVersion providerPlatformAccountId providerAccountId providerPaymentIntentRef providerChargeRef destinationAccountId settlementMerchantAccountId customerChargeVerified merchantRouteVerified subscriptionId provider chargeAccountId currency status collectionPausedAsDraft financiallyQuiesced positiveCollectionAdmissible amountMinor totalMinor subtotalMinor paidMinor remainingMinor amountDueMinor autoAdvance completePayments completeLines suppliesPaidAuthority completeZeroRecurringItem fixedTaxRequiredBeforeCollection merchantTaxAuthority actualAnchor actualPeriodStart actualPeriodEnd actualTrialEnd originalAcceptedTrialEnd firstInvoiceFinancialState calendarCanceled actualBillingAnchor actualProviderTrialEnd currentReadDigest complete balanceState issuedCreditNoteRefs inventoryDigest requestedAnchor requestedProrationBehavior originalAnchor originalTrialEnd trialPolicy sealedTaxIncluded prorationAt actualInvoicePeriodStart actualInvoicePeriodEnd component kind periodStart periodEnd proration exactManifest manifestDigest customerFinancialDigest canonicalTargetDigest providerInvoiceRefs taxAuthority".split(" "));
const containerKeys=new Set("components matches actualCash actualPayments actualIntents actualLines actualPrices actualInvoices creditNotes customer actualRaw actualInvoice inventory financial lineBindings lines raw invoice intent invoicePayment cash".split(" "));
const safeEnums=new Set("active incomplete draft open paid void uncollectible canceled succeeded pending failed review known_zero unverified principal merchant_declared_tax_collection net locked_canonical_credit canonical_merchant_tax_ledger preserve_original_end created_draft existing_generated unchanged create_prorations none exclusive recurring one_time day week month year stripe".split(" "));
function safeScalar(value:unknown):boolean {
 return value===null||typeof value==="boolean"||typeof value==="number"&&Number.isSafeInteger(value)||typeof value==="string"&&(safeEnums.has(value)||/^[A-Z]{3}$/.test(value)||/^[a-f0-9]{64}$/.test(value)||/^[a-f0-9-]{36}$/.test(value)||/^(?:acct|cus|sub|in|upcoming_in|pi|ch|il|inpay|ii|si|price|prod|cn)_[A-Za-z0-9_]{1,195}$/.test(value)||z.iso.datetime().safeParse(value).success||value==="2026-10-28.endive");
}
/** A view of an old signed result, never a new occurrence or an ingress ticket. */
export function safeControlledHistoricalResult(value:unknown,operation:Operation,call:Call):Record<string,unknown> {
 const producer=producers[operation.kind];if(!producer)refuse();
 let unknown=0,ordinal=0;const payload=record.safeParse(operation.originalRequest.payload),invoiceRef=payload.success&&typeof payload.data.providerInvoiceRef==="string"?payload.data.providerInvoiceRef:"in_unknown";
 const context:ControlledIngressContext={binding:{operationId:operation.id,callId:call.id,requestDigest:operation.requestDigest,resourceId:operation.resourceId,kind:operation.kind},producer,method:"GET",requestPath:`/v1/invoices/${invoiceRef}`,dispatchOrdinal:1};
 const project=(raw:unknown,shape:Parameters<typeof projectControlledHistoricalRecord>[2])=>{
  // This counter is only a local projection traversal bound. It is NOT a
  // retroactive HTTP/page/pass identity and is never journaled as such.
  if(++ordinal>100000)refuse();const result=projectControlledHistoricalRecord(raw,context,shape),metadata=record.parse(result[CONTROLLED_PROJECTION_KEY]);
  unknown+=z.number().int().nonnegative().parse(metadata.unknownFinancialPathCount);return result;
 };
 const visit=(node:unknown,key:string):unknown=>{
  if(Array.isArray(node)){if(node.length>5000)refuse();return node.map(child=>visit(child,key));}
  const parsed=record.safeParse(node);
  if(!parsed.success){if(safeScalar(node))return node;unknown++;return null;}
  const row=parsed.data;
  const shape=key==="actualInvoice"||key==="actualInvoices"||key==="invoice"?"invoice":key==="actualIntents"||key==="intent"?"intent":key==="actualPayments"||key==="invoicePayment"?"invoice_payment":key==="actualPrices"?"price":key==="customer"?"customer":key==="creditNotes"?"credit_note":key==="raw"?"line":key==="actualRaw"?(operation.kind.startsWith("preview_")?"invoice":"subscription"):null;
  if(shape)return project(row,shape);
  // Full raw line arrays occur in invoice reads; preview lines carry a raw
  // child and are genuine SDK DTOs instead.
  if(key==="actualLines"&&!Object.hasOwn(row,"raw"))return project(row,"line");
  const result:Record<string,unknown>={};for(const[name,item]of Object.entries(row)){
   if(scalarKeys.has(name)){if(Array.isArray(item))result[name]=item.map((value:unknown)=>{if(safeScalar(value))return value;unknown++;return null;});else if(safeScalar(item))result[name]=item;else{unknown++;result[name]=null;}}
   else if(containerKeys.has(name))result[name]=visit(item,name);
   else if(name!==CONTROLLED_PROJECTION_KEY)unknown++;
  }return result;
 };
 const result=record.parse(visit(record.parse(value),"result"));
 return{...result,[CONTROLLED_PROJECTION_KEY]:{protocol:CONTROLLED_SAFE_RESPONSE_PROTOCOL,context:producer,unknownFinancialPaths:unknown?[{path:"historical_result",reason:"unsupported_financial_shape"},...(unknown>64?[{path:"response",reason:"unknown_path_capacity_exceeded"}]:[])]:[],unknownFinancialPathCount:unknown}};
}
async function finishFingerprints(tx:Tx,callId:string){
 const[entry]=await tx.execute(sql`select encode(sha256(convert_to(to_jsonb(f)::text,'UTF8')),'hex') as "finishPgSha",encode(sha256(convert_to(f.actual_result::text,'UTF8')),'hex') as "framePgSha",encode(sha256(convert_to((f.actual_result->'result')::text,'UTF8')),'hex') as "resultPgSha" from subscription_controlled_finishes f where f.call_id=${callId}::uuid`);
 return z.object({finishPgSha:sha,framePgSha:sha,resultPgSha:sha}).strict().parse(entry);
}
function originalReturned(operation:Operation,call:Call,finish:Finish){
 const admission=verifiedProviderReadProof(call.admission,"admission"),proof=verifiedProviderReadProof(finish.proof,"finish"),p=proof?.payload,actualResultDigest=merchantTaxDigest(finish.actualResult);
 if(!admission||!proof||admission.payload.purpose!=="subscription_controlled_provider_caller.v1"||p?.purpose!=="subscription_controlled_provider_caller.v1"||admission.payload.callId!==call.id||admission.payload.operationId!==operation.id||admission.payload.resourceId!==operation.resourceId||admission.payload.requestDigest!==operation.requestDigest||merchantTaxDigest(operation.originalRequest)!==operation.requestDigest||merchantTaxDigest(call.admission)!==call.admissionDigest||!sha.safeParse(admission.payload.completionDigest).success||proof.publicKey!==admission.publicKey||call.operationId!==operation.id||finish.callId!==call.id||p?.callId!==call.id||p.operationId!==operation.id||p.resourceId!==operation.resourceId||p.requestDigest!==operation.requestDigest||p.admissionDigest!==call.admissionDigest||p.callerId!==admission.payload.callerId||p.completionDigest!==admission.payload.completionDigest||p.outcome!=="returned"||finish.actualResult.outcome!=="returned"||p.factsDigest!==actualResultDigest||finish.proofDigest!==merchantTaxDigest(finish.proof))refuse();
 const result=record.parse(finish.actualResult.result);return{proof,result,resultDigest:merchantTaxDigest(result)};
}
export async function createControlledHistoricalFinReference(tx:Tx,operation:Operation,call:Call,finish:Finish){
 const original=originalReturned(operation,call,finish);if(call.admission.payload.responseProjectionProtocol===CONTROLLED_SAFE_RESPONSE_PROTOCOL)refuse();
 const[stored]=await tx.select().from(subscriptionControlledFinishes).where(eq(subscriptionControlledFinishes.callId,call.id)).limit(1);
 if(!stored||merchantTaxDigest(stored)!==merchantTaxDigest(finish))refuse();
 const hashes=await finishFingerprints(tx,call.id),safeView=safeControlledHistoricalResult(original.result,operation,call);
 const[safeHash]=await tx.execute(sql`select encode(sha256(convert_to(${JSON.stringify(safeView)}::jsonb::text,'UTF8')),'hex') as digest`);
 const body=referenceBody.parse({protocol:CONTROLLED_HISTORICAL_FIN_PROTOCOL,operationId:operation.id,callId:call.id,finishCallId:finish.callId,originalFinishPgSha256:hashes.finishPgSha,originalFramePgSha256:hashes.framePgSha,originalResultPgSha256:hashes.resultPgSha,originalSignedFrameDigest:original.proof.payload.factsDigest,originalSdkResultDigest:original.resultDigest,safeView,safeViewDigest:merchantTaxDigest(safeView),safeViewPgSha256:z.object({digest:sha}).parse(safeHash).digest});
 const createdAt=new Date(),digest=merchantTaxDigest(body),authentication=signOriginalCashRecovery(REFERENCE_PURPOSE,{id:operation.id,digest,createdAt},originalCashSigningKey());
 return controlledHistoricalFinReference.parse({...body,proof:{createdAt:createdAt.toISOString(),digest,authentication}});
}
export async function resolveControlledVerificationView(tx:Tx,operation:Operation,call:Call,finish:Finish,verification:Verification){
 const original=originalReturned(operation,call,finish),storedVerificationDigest=verification.actualResultDigest;
 if(verification.callId!==call.id||verification.operationId!==operation.id||merchantTaxDigest(verification.actualResult)!==storedVerificationDigest)refuse();
 if(verification.actualResult.protocol===CONTROLLED_HISTORICAL_FIN_PROTOCOL){
  const reference=controlledHistoricalFinReference.parse(verification.actualResult),{proof,...body}=reference,hashes=await finishFingerprints(tx,call.id);
  const[safeHash]=await tx.execute(sql`select encode(sha256(convert_to(${JSON.stringify(reference.safeView)}::jsonb::text,'UTF8')),'hex') as digest`);
  if(reference.operationId!==operation.id||reference.callId!==call.id||reference.finishCallId!==finish.callId||reference.originalFinishPgSha256!==hashes.finishPgSha||reference.originalFramePgSha256!==hashes.framePgSha||reference.originalResultPgSha256!==hashes.resultPgSha||reference.originalSignedFrameDigest!==original.proof.payload.factsDigest||reference.originalSdkResultDigest!==original.resultDigest||reference.safeViewDigest!==merchantTaxDigest(reference.safeView)||reference.safeViewPgSha256!==z.object({digest:sha}).parse(safeHash).digest||merchantTaxDigest(safeControlledHistoricalResult(original.result,operation,call))!==reference.safeViewDigest||!verifyOriginalCashRecovery(REFERENCE_PURPOSE,{id:operation.id,digest:proof.digest,authentication:proof.authentication,createdAt:new Date(proof.createdAt)},body,originalCashEvidenceKeys()))refuse();
  return retainedView({operationId:operation.id,callId:call.id,verificationKind:"legacy_fin_reference" as const,storedVerificationDigest,originalSignedFrameDigest:reference.originalSignedFrameDigest,originalFinishPgSha256:reference.originalFinishPgSha256,safeViewDigest:reference.safeViewDigest,resultView:reference.safeView,requiresFreshObservation:true});
 }
 if(original.resultDigest!==storedVerificationDigest)refuse();
 const safe=call.admission.payload.responseProjectionProtocol===CONTROLLED_SAFE_RESPONSE_PROTOCOL;
 if(safe){const metadata=record.safeParse(verification.actualResult[CONTROLLED_PROJECTION_KEY]);if(!metadata.success||metadata.data.protocol!==CONTROLLED_SAFE_RESPONSE_PROTOCOL||metadata.data.context!==producers[operation.kind])refuse();}
 const resultView=safe?verification.actualResult:safeControlledHistoricalResult(original.result,operation,call);
 return retainedView({operationId:operation.id,callId:call.id,verificationKind:safe?"safe_current" as const:"legacy_historical" as const,storedVerificationDigest,safeViewDigest:safe?storedVerificationDigest:merchantTaxDigest(resultView),resultView,requiresFreshObservation:!safe});
}

/** Caller first reads the authentic complete journal. Raw stored rows stay exact;
 * this separate view is never an alias replacing their digest or PG domain. */
export function requireControlledCurrentVerification(
 history:{verificationViews?:readonly {operationId:string;callId:string;verificationKind:string;storedVerificationDigest:string;safeViewDigest:string;resultView:Record<string,unknown>;requiresFreshObservation:boolean}[]},
 verification:{operationId:string;callId?:string;actualResult:Record<string,unknown>;actualResultDigest:string},
 purpose:"current_authority"|"observation_identity"="current_authority",
):Record<string,unknown>{
 const view=history.verificationViews?.find(row=>row.operationId===verification.operationId);
 if(!view||!authenticViews.has(view)||view.verificationKind!=="safe_current"||view.requiresFreshObservation||verification.callId!==undefined&&view.callId!==verification.callId||view.storedVerificationDigest!==verification.actualResultDigest||view.safeViewDigest!==verification.actualResultDigest)refuse();
 if(purpose==="observation_identity"){const metadata=record.safeParse(verification.actualResult[CONTROLLED_PROJECTION_KEY]);if(!metadata.success||metadata.data.protocol!==CONTROLLED_SAFE_RESPONSE_PROTOCOL)refuse();return verification.actualResult;}
 return requireControlledSafeCurrentResult(verification.actualResult);
}
