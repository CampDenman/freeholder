// Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0
// PREPARED/UNRUN. A genuine new GET/retention after bank writes, not a proof stub.
import {eq} from "drizzle-orm";
import {expect} from "vitest";
import {db} from "@/core/db";
import {invoices,payments} from "@/modules/invoicing/schema";
import {planControlledCollectionOperation} from "@/modules/subscriptions/controlled-provider-collection-plan";
import {executeControlledOperation} from "@/modules/subscriptions/controlled-provider-execution";
import {retainControlledInvoiceProof} from "@/modules/subscriptions/controlled-provider-collection-retention";
import type {actualControlledPeriod84} from "./actual-controlled-period84";
import {OWNER} from "./spine";
/** The public producer deliberately returns retained money without application.
 * Its pre-pay manifest authorizes that one bank write; application independently
 * needs a complete actual manifest AFTER the last real bank mutation. */
export async function retainActualControlledManifest84(f:Awaited<ReturnType<typeof actualControlledPeriod84>>){
 const beforeInvoice=await db().select().from(invoices).where(eq(invoices.id,f.target.invoiceId));
 const beforePayments=await db().select().from(payments).where(eq(payments.invoiceId,f.target.invoiceId)).orderBy(payments.id);
 const beforeBank=f.remote.counts(),system={kind:"system"} as const;
 const{operationId}=await planControlledCollectionOperation.call({collectionId:f.target.collectionId,kind:"read_manifest"},system);
 const actual=await executeControlledOperation(operationId,OWNER);
 expect(actual).toMatchObject({exactManifest:true,suppliesPaidAuthority:false});
 const{proofId}=await retainControlledInvoiceProof.call({collectionId:f.target.collectionId,operationId},system);
 expect(await db().select().from(invoices).where(eq(invoices.id,f.target.invoiceId))).toEqual(beforeInvoice);
 expect(await db().select().from(payments).where(eq(payments.invoiceId,f.target.invoiceId)).orderBy(payments.id)).toEqual(beforePayments);
 const afterBank=f.remote.counts();
 for(const key of ["updatePosts","draftPosts","itemPosts","feePosts","finalizePosts","payPosts"] as const)expect(afterBank[key]).toBe(beforeBank[key]);
 return{operationId,proofId,actual};
}
