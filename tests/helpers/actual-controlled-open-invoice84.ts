// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// PREPARED/UNRUN. Actual admitted SDK phases stop at OPEN; never a pay request.
import { z } from "zod";
import { controlledCollectionOrchestrationState,bindObservedControlledCollection } from "@/modules/subscriptions/controlled-provider-collection-orchestration";
import { planControlledCollectionOperation } from "@/modules/subscriptions/controlled-provider-collection-plan";
import { planControlledProviderOperation } from "@/modules/subscriptions/controlled-provider-plan";
import { executeControlledOperation } from "@/modules/subscriptions/controlled-provider-execution";
import { retainControlledInvoiceProof } from "@/modules/subscriptions/controlled-provider-collection-retention";
import type { actualControlledPeriod84 } from "./actual-controlled-period84";
import { OWNER } from "./spine";
export async function actualControlledOpenInvoice84(f:Awaited<ReturnType<typeof actualControlledPeriod84>>){
 const system={kind:"system"} as const,collectionId=f.target.collectionId,resourceId=f.review.controlled.resourceId;
 const read=async(kind:"list_invoices"|"read_invoice"|"read_calendar",providerInvoiceRef?:string)=>{const op=await planControlledProviderOperation.call({resourceId,kind,...(providerInvoiceRef?{providerInvoiceRef}:{})},system);return executeControlledOperation(op.operationId,OWNER);};
 const inventory=async()=>{const list=z.object({complete:z.literal(true),providerInvoiceRefs:z.array(z.string()).max(5000)}).parse(await read("list_invoices"));for(const providerInvoiceRef of list.providerInvoiceRefs)await read("read_invoice",providerInvoiceRef);};
 const stage=async(kind:z.input<typeof planControlledCollectionOperation.def.input>["kind"],componentId?:string)=>{const op=await planControlledCollectionOperation.call({collectionId,kind,...(componentId?{componentId}:{})},system);await executeControlledOperation(op.operationId,OWNER);return op.operationId;};
 const manifest=async()=>{const operationId=await stage("read_manifest");await retainControlledInvoiceProof.call({collectionId,operationId},system);};
 await inventory();await stage("update_calendar");await read("read_calendar");await inventory();await stage("create_draft");await inventory();await bindObservedControlledCollection.call({collectionId},system);
 const state=await controlledCollectionOrchestrationState.call({collectionId},system);
 for(const componentId of state.missingComponentIds){await stage("add_invoice_component",componentId);await inventory();await bindObservedControlledCollection.call({collectionId},system);}
 await stage("set_invoice_fee");await inventory();await manifest();await stage("finalize_invoice");await inventory();await manifest();
 const current=await controlledCollectionOrchestrationState.call({collectionId},system);
 if(current.bankStatus!=="open"||!current.providerInvoiceRef||current.payAdmitted||current.bankPaidMinor!==0||f.remote.counts().payPosts!==0)throw Error("The actual exact target must be OPEN with no requested or received payment before external bank attachment.");
 return{collectionId,providerInvoiceRef:current.providerInvoiceRef};
}
