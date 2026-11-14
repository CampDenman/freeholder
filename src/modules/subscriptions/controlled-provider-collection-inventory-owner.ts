// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Exact bank invoice UUID ancestry, never ownership selected by price or amount.
import { and,eq,sql } from "drizzle-orm";
import { z } from "zod";
import { ServiceError,type ServiceContext } from "@/core/service";
import { invoiceSettled } from "@/modules/invoicing/invoice-balance";
import { subscriptionControlledInvoiceBindings,subscriptionControlledCollections,subscriptionControlledQuotes } from "./controlled-provider-collection-schema";
import { controlledCollectionState } from "./controlled-provider-collection-state";
import { readControlledCollectionInventory,originalBootstrapZeroInvoice,refuseControlledCollectionInventory } from "./controlled-provider-collection-inventory";
/** Caller holds contact→resource→parent and current parent canonical locks.
 * This adds no lock and supplies no bank/principal/payment/access authority. */
export async function controlledCollectionInventoryOwner(ctx:ServiceContext,source:Awaited<ReturnType<typeof controlledCollectionState>>,afterOrdinal=0){
 const inventory=readControlledCollectionInventory(source,afterOrdinal);const unknown:Array<typeof inventory.reads[number]>=[];
 let count=inventory.physicalRowCount;
 const firstUpdate=source.history.operations.find(op=>op.kind==="update_calendar"&&source.history.calls.some(call=>call.operationId===op.id));
 for(const row of inventory.reads){
  if(source.binding?.providerInvoiceRef===row.providerInvoiceRef){if(row.actual.autoAdvance!==false)refuseControlledCollectionInventory();continue;}
  if(originalBootstrapZeroInvoice(source,row,firstUpdate?.ordinal??Number.MAX_SAFE_INTEGER))continue;
  const[binding]=await ctx.tx.select({collectionId:subscriptionControlledInvoiceBindings.collectionId}).from(subscriptionControlledInvoiceBindings)
   .innerJoin(subscriptionControlledCollections,eq(subscriptionControlledCollections.id,subscriptionControlledInvoiceBindings.collectionId))
   .innerJoin(subscriptionControlledQuotes,eq(subscriptionControlledQuotes.id,subscriptionControlledCollections.quoteId))
   .where(and(eq(subscriptionControlledInvoiceBindings.resourceId,source.resource.id),eq(subscriptionControlledInvoiceBindings.providerInvoiceRef,row.providerInvoiceRef),eq(subscriptionControlledQuotes.resourceId,source.resource.id))).limit(1);
  if(!binding){unknown.push(row);continue;}
  if(binding.collectionId===source.collection.id)refuseControlledCollectionInventory();
  const previous=await controlledCollectionState(ctx.tx,binding.collectionId);count+=previous.canonical.count+previous.components.length+previous.itemReceipts.length+previous.proofs.length+4;
  if(count>5000||!previous.binding||previous.binding.providerInvoiceRef!==row.providerInvoiceRef||previous.canonical.invoice.status!=="paid"||!invoiceSettled(previous.canonical.invoice)
   ||previous.canonical.invoice.refundedMinor!==0||row.actual.status!=="paid"||row.actual.totalMinor!==previous.manifest.cashDueMinor||row.actual.paidMinor!==row.actual.totalMinor||row.actual.remainingMinor!==0||row.actual.autoAdvance!==false)
   throw new ServiceError("conflict","Retain the exact earlier target's actual cash/refund/dispute and canonical settlement before another bank obligation. A paid label or equal amount never frees an unresolved older invoice.");
 }
 return{...inventory,unknown,physicalRowCount:count};
}
export async function assertControlledCollectionInventoryProof(ctx:ServiceContext,source:Awaited<ReturnType<typeof controlledCollectionState>>,raw:unknown){
 const expected=z.object({listOperationId:z.uuid(),invoiceReadOperationIds:z.array(z.uuid()).max(5000),revision:z.string().regex(/^[a-f0-9]{64}$/),afterOrdinal:z.number().int().nonnegative()}).strict().parse(raw);
 const boundary=Math.max(0,...source.history.operations.filter(op=>source.history.calls.some(call=>call.operationId===op.id)&&["update_calendar","create_draft","add_invoice_component","set_invoice_fee","finalize_invoice","pay_invoice","cancel_calendar","pause_drafts"].includes(op.kind)).map(op=>op.ordinal));
 const actual=await controlledCollectionInventoryOwner(ctx,source,boundary);
 if(expected.afterOrdinal!==boundary||actual.unknown.length||actual.revision!==expected.revision||actual.list.id!==expected.listOperationId
  ||actual.reads.length!==expected.invoiceReadOperationIds.length||actual.reads.some((row,index)=>row.operation.id!==expected.invoiceReadOperationIds[index]))refuseControlledCollectionInventory();
 const calendar=source.history.verifications.filter(v=>source.history.operations.some(op=>op.id===v.operationId&&op.kind==="read_calendar")).at(-1);
 if(!calendar||calendar.actualResult.providerInvoiceRef!==null&&!actual.reads.some(row=>row.providerInvoiceRef===calendar.actualResult.providerInvoiceRef))refuseControlledCollectionInventory();
}

export async function requireControlledCollectionOrchestrationSchema(ctx:ServiceContext){
 const[installed]=await ctx.tx.execute<{ready:boolean}>(sql`select to_regprocedure('freeholder_controlled_collection_inventory(uuid)') is not null as ready`);
 if(!installed?.ready)throw new ServiceError("conflict","Install and qualify the genuine complete original inventory guards before positive collection orchestration.");
}
