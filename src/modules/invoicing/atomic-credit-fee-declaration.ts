// Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0
// C12.38: only independently current server source proof can mark a NEW B plan.
import {randomUUID} from "node:crypto";
import {eq} from "drizzle-orm";
import {ServiceError,type ServiceContext} from "@/core/service";
import {invoices,payments} from "./schema";
import {ATOMIC_CREDIT_FEE_DECLARATION_PROTOCOL} from "./atomic-credit-fee-protocol";
import type {AtomicCreditFeeDeclaration} from "./atomic-credit-fee-declaration-contract";
import {controlledAtomicCreditFeePartition} from "./atomic-credit-fee-partition";
import {atomicCreditFeeDeclarationKeys,signAtomicCreditFeeDeclaration,verifiedAtomicCreditFeeDeclaration} from "./atomic-credit-fee-declaration-proof";
type Principal={sourcePaymentId:string;sourceApplicationId:string|null;amountMinor:number;feeObligationMinor:number;feeProvenCollectedMinor:number;feeCollectionState:string;feeEvidenceDigest:string;feeUnexpected:boolean};
function refuse():never{throw new ServiceError("conflict","Restore the real unchanged original credit source and exact mandatory B funding plan before retaining this quote; an uncreated funding UUID supplies no money authority.");}
async function currentSources(ctx:ServiceContext,principal:readonly Principal[]){
 if(principal.length>1000||new Set(principal.map(row=>`${row.sourcePaymentId}:${row.sourceApplicationId??"direct"}`)).size!==principal.length)refuse();
 const sources=[];
 for(const source of principal){
  const[payment]=await ctx.tx.select().from(payments).where(eq(payments.id,source.sourcePaymentId)).limit(1);if(!payment||payment.refundedMinor!==0)refuse();
  const[original]=await ctx.tx.select({refundedMinor:invoices.refundedMinor}).from(invoices).where(eq(invoices.id,payment.invoiceId)).limit(1);if(!original)refuse();
  if(original.refundedMinor===0)continue;
  const current=await controlledAtomicCreditFeePartition(ctx,{paymentId:payment.id,sourceApplicationId:source.sourceApplicationId,takeMinor:source.amountMinor});if(!current)continue;
  const actual=current.allocation;if(!current.requiresChild||actual.feeObligationMinor!==source.feeObligationMinor||actual.provenCollectedMinor!==source.feeProvenCollectedMinor||actual.collectionState!==source.feeCollectionState||actual.evidenceDigest!==source.feeEvidenceDigest||actual.unexpectedFee!==source.feeUnexpected)refuse();
  sources.push({sourcePaymentId:payment.id,sourceApplicationId:source.sourceApplicationId,amountMinor:source.amountMinor,feeEvidenceDigest:source.feeEvidenceDigest});
 }
 return sources;
}
export async function prepareAtomicCreditFeeDeclaration(ctx:ServiceContext,input:{quoteId:string;resourceId:string;subscriptionId:string;plannedProrationId:string;originalInvoiceId:string|null;originalInvoiceLineId:string|null;principal:readonly Principal[];quoteCreatedAt:Date}){
 const fundings=(await currentSources(ctx,input.principal)).map(source=>({fundingId:randomUUID(),...source}));
 if(!fundings.length)return null;
 if(!input.originalInvoiceId||!input.originalInvoiceLineId)refuse();const keys=atomicCreditFeeDeclarationKeys(),key=keys[0];if(!key)refuse();
 const body:Omit<AtomicCreditFeeDeclaration,"digest"|"authentication">={protocol:ATOMIC_CREDIT_FEE_DECLARATION_PROTOCOL,quoteId:input.quoteId,resourceId:input.resourceId,subscriptionId:input.subscriptionId,plannedProrationId:input.plannedProrationId,originalInvoiceId:input.originalInvoiceId,originalInvoiceLineId:input.originalInvoiceLineId,fundings};
 const declaration=signAtomicCreditFeeDeclaration(body,input.quoteCreatedAt,key);if(!verifiedAtomicCreditFeeDeclaration(declaration,input.quoteCreatedAt,keys))refuse();return declaration;
}
/** Independent acceptance read: preserve the genuine planned UUIDs, recompute
 * ALL actual source safety, require exact source PK relationships and amounts.
 * Absence of a declaration is accepted only for genuinely ordinary sources. */
export async function assertAtomicCreditFeeDeclarationCurrent(ctx:ServiceContext,input:{declaration:AtomicCreditFeeDeclaration|null;quoteCreatedAt:Date;originalInvoiceId:string|null;originalInvoiceLineId:string|null;principal:readonly Principal[]}){
 const sources=await currentSources(ctx,input.principal),declaration=input.declaration;
 if(!declaration){if(sources.length)refuse();return;}
 if(!verifiedAtomicCreditFeeDeclaration(declaration,input.quoteCreatedAt,atomicCreditFeeDeclarationKeys())||declaration.originalInvoiceId!==input.originalInvoiceId||declaration.originalInvoiceLineId!==input.originalInvoiceLineId||declaration.fundings.length!==sources.length)refuse();
 for(const source of sources){const declared=declaration.fundings.find(row=>row.sourcePaymentId===source.sourcePaymentId&&row.sourceApplicationId===source.sourceApplicationId);
  if(!declared||declared.amountMinor!==source.amountMinor||declared.feeEvidenceDigest!==source.feeEvidenceDigest)refuse();}
}
