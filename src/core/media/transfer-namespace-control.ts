// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
import {eq,sql} from "drizzle-orm";
import type {Tx} from "@/core/service";
import {mediaStorageTransferObjects,mediaStorageTransferPlans,mediaStorageWriterDrains} from "./transfer-schema";
import {requireTransferNamespaceControl} from "./transfer-namespace-control-proof";
import {transferConflict} from "./transfer-proof";
/** Both logical admission and actual physical dispatch re-read controllers
 * under the inventory fence; an old token is not a namespace generation. */
export async function assertTransferNamespaceMutation(tx:Tx,objectId:string,namespace:string,kind:string):Promise<void>{
 await tx.execute(sql`select pg_advisory_xact_lock_shared(1691709,82)`);
 const[original]=await tx.select({object:mediaStorageTransferObjects,plan:mediaStorageTransferPlans}).from(mediaStorageTransferObjects).innerJoin(mediaStorageTransferPlans,eq(mediaStorageTransferPlans.id,mediaStorageTransferObjects.planId)).where(eq(mediaStorageTransferObjects.id,objectId)).limit(1);
 if(!original)transferConflict("The actual original transfer object and plan are unavailable.");
 const sourceClaims=await tx.select({id:mediaStorageTransferPlans.id,state:mediaStorageTransferPlans.state}).from(mediaStorageTransferPlans).where(eq(mediaStorageTransferPlans.sourceNamespace,namespace)).limit(1001);
 const drains=await tx.select().from(mediaStorageWriterDrains).where(eq(mediaStorageWriterDrains.namespace,namespace)).limit(1001);
 if(sourceClaims.length>1000||drains.length>1000)transferConflict("The complete original namespace controller inventory exceeds the bounded proof; no subset may grant dispatch.");
 requireTransferNamespaceControl({plan:original.plan,objectState:original.object.state,namespace,kind,sourceClaims,drains});
}
