// Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0
// C12.38/C1.08: private genuine retained-cash context, never a virtual payment.
import { sql } from "drizzle-orm";
import { z } from "zod";
import { ServiceError,type ServiceContext,type Tx } from "@/core/service";
import type { ControlledCollectionCashProof } from "@/modules/subscriptions/controlled-provider-collection-cash-contract";
import { merchantTaxDigest } from "./merchant-tax-store";
type Frozen<T>=T extends readonly (infer Item)[]?readonly Frozen<Item>[]:T extends object?{readonly[Key in keyof T]:Frozen<T[Key]>}:T;
export type RetainedUnappliedControlledCash={readonly kind:"retained_unapplied";readonly receiptId:string;readonly collectionId:string;readonly resourceId:string;readonly subscriptionId:string;readonly canonicalInvoiceId:string;
 readonly providerInvoiceRef:string;readonly providerIntentRef:string;readonly providerChargeRef:string;readonly amountMinor:number;readonly currency:string;
 readonly originOperationId:string;readonly originCallId:string;readonly originFactId:string;readonly inspectionId:string;readonly bankObservationId:string;readonly finishCallerId:string;
 readonly immutableBankRevision:string;readonly namespaceRevision:string};
export type ControlledCashProspectiveProjection={readonly purpose:"controlled_cash_prospective_read.v1";readonly collectionId:string;readonly resourceId:string;readonly subscriptionId:string;readonly invoiceId:string;
 readonly acceptedQuoteDigest:string;readonly canonicalTargetDigest:string;readonly manifestOperationId:string;readonly manifestCallId:string;readonly manifestResultDigest:string;readonly manifestDigest:string;
 readonly actualCanonicalPaidMinor:number;readonly actualBankPaidMinor:number;readonly actualBankRemainingMinor:number;readonly receipts:readonly RetainedUnappliedControlledCash[];
 readonly bankProofRevision:string;readonly parentPgRevision:string;readonly revision:string};
const active=new WeakMap<Tx,ControlledCashProspectiveProjection>();
const sha=z.string().regex(/^[a-f0-9]{64}$/),snapshotSchema=z.object({entries:z.array(z.object({table:z.string(),id:z.string(),fingerprint:sha,hashDomain:z.literal("postgres_row")}).strict()).min(1).max(5000),revision:sha,physicalRowCount:z.number().int().min(1).max(5000)}).strict();
function refuse():never{throw new ServiceError("conflict","Use only the genuine current complete retained-receipt bank proof under the original locked parent before evaluating prospective debt. No supplied context, fake payment or flat raw-fact exemption is accepted.");}
function freeze<T>(value:T):Frozen<T>{
 if(value&&typeof value==="object"){for(const child of Object.values(value))freeze(child);Object.freeze(value);}
 // Object.freeze is recursive above; this assertion reflects its actual runtime
 // immutability, not a money-authority or unsupported DTO assertion.
 return value as Frozen<T>;
}
/** Ordinary consumers can READ only. There is no setter/public DTO/session
 * override. The sole initializer below obtains its own genuine producer proof;
 * the projection has no paymentId/paid counter/caller waiver/allowed flag. */
export function controlledCashProspectiveProjection(tx:Tx,scope:{resourceId:string;collectionId?:string;invoiceId?:string}):ControlledCashProspectiveProjection|null{
 const current=active.get(tx);return current&&current.resourceId===scope.resourceId&&(!scope.collectionId||current.collectionId===scope.collectionId)&&(!scope.invoiceId||current.invoiceId===scope.invoiceId)?current:null;
}
/** Real read-only prewrite evaluation only. Caller already owns contact→own
 * resource→parent→sorted canonical/cash locks. Dynamic import deliberately keeps
 * the ordinary raw/principal reader graph free of service-registration cycles.
 * No external input supplies a proof, callback fact ID or authorization value.
 * Money mutation stages require their separate genuine authenticated 783 proof;
 * this initializer never caches a scalar grant across canonical writes. */
export async function withControlledCashProspectiveEvaluation<Result>(ctx:ServiceContext,input:{collectionId:string;receiptIds:readonly string[]},evaluate:(proof:Frozen<ControlledCollectionCashProof>)=>Promise<Result>):Promise<Result>{
 const parsed=z.object({collectionId:z.uuid(),receiptIds:z.array(z.uuid()).min(1).max(5000)}).strict().parse(input);
 if(ctx.actor.kind!=="system"||active.has(ctx.tx)||new Set(parsed.receiptIds).size!==parsed.receiptIds.length)refuse();
 const request={collectionId:parsed.collectionId,receiptIds:[...parsed.receiptIds].sort()};
 const{readControlledCollectionCashAuthority}=await import("@/modules/subscriptions/controlled-provider-collection-cash");
 const proof=await readControlledCollectionCashAuthority(ctx,request);
 const[rawBefore]=await ctx.tx.execute<{snapshot:unknown}>(sql`select freeholder_controlled_cash_parent_snapshot(${proof.collectionId}::uuid) as snapshot`),before=snapshotSchema.parse(rawBefore?.snapshot);
 const physical=new Map(before.entries.map(row=>[`${row.table}:${row.id}`,row.fingerprint]));
 if(physical.size!==before.entries.length||before.physicalRowCount!==before.entries.length||proof.unfinishedControlledCallIds.length||proof.unfinishedInspectionIds.length||proof.unfinishedNamespaceCallers.length
  ||proof.receipts.some(receipt=>receipt.physicalWitnessEntries.some(row=>physical.get(`${row.table}:${row.id}`)!==row.fingerprint)))refuse();
 const retained:RetainedUnappliedControlledCash[]=proof.receipts.filter(row=>row.existingPaymentId===null).map(row=>({kind:"retained_unapplied",receiptId:row.receiptId,collectionId:proof.collectionId,resourceId:proof.resourceId,subscriptionId:proof.subscriptionId,canonicalInvoiceId:proof.invoiceId,
  providerInvoiceRef:proof.bankInvoice.providerInvoiceRef,providerIntentRef:row.originalExpectation.providerRef,providerChargeRef:row.originalExpectation.chargeRef,amountMinor:row.amountMinor,currency:row.currency,
  originOperationId:row.originOperationId,originCallId:row.originCallId,originFactId:row.originFactId,inspectionId:row.inspectionId,bankObservationId:row.bankObservationId,finishCallerId:row.finishCallerId,immutableBankRevision:row.immutableBankRevision,namespaceRevision:row.namespaceRevision}));
 if(!retained.length)refuse();
 const body={purpose:"controlled_cash_prospective_read.v1" as const,collectionId:proof.collectionId,resourceId:proof.resourceId,subscriptionId:proof.subscriptionId,invoiceId:proof.invoiceId,acceptedQuoteDigest:proof.acceptedQuoteDigest,canonicalTargetDigest:proof.canonicalTargetDigest,
  manifestOperationId:proof.bankInvoice.manifestOperationId,manifestCallId:proof.bankInvoice.manifestCallId,manifestResultDigest:proof.bankInvoice.manifestResultDigest,manifestDigest:proof.bankInvoice.manifestDigest,
  actualCanonicalPaidMinor:proof.canonical.paidMinor,actualBankPaidMinor:proof.bankInvoice.paidMinor,actualBankRemainingMinor:proof.bankInvoice.remainingMinor,receipts:retained,bankProofRevision:proof.sourceRevision,parentPgRevision:before.revision};
 const projection=freeze({...body,revision:merchantTaxDigest(body)});active.set(ctx.tx,projection);
 try{
  const result=await evaluate(freeze(proof));
  const afterProof=await readControlledCollectionCashAuthority(ctx,request);
  const[rawAfter]=await ctx.tx.execute<{snapshot:unknown}>(sql`select freeholder_controlled_cash_parent_snapshot(${proof.collectionId}::uuid) as snapshot`),after=snapshotSchema.parse(rawAfter?.snapshot);
  if(merchantTaxDigest(afterProof)!==merchantTaxDigest(proof)||after.revision!==before.revision||JSON.stringify(after.entries)!==JSON.stringify(before.entries)||after.physicalRowCount!==before.physicalRowCount)refuse();
  return result;
 }finally{active.delete(ctx.tx);}
}
