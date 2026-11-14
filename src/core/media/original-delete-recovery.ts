// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Fresh-person shared recovery uses the exact existing conditional removal;
// written evidence does not supply a remote ACK, local finish or new dispatch.
import {eq} from "drizzle-orm";
import {z} from "zod";
import {hasModuleAccess,type Actor} from "@/core/service";
import {defineMediaService} from "./guarded-service";
import {storageRecoveryConfirmation,type StorageRecoveryConfirmation} from "./storage-recovery-contract";
import {mediaObjectWrites} from "./write-schema";
import {lockTransferInventory} from "./transfer-authority";
import {checkedTransferBinding} from "./transfer-witness";
import {transferConflict} from "./transfer-proof";
import {retireOriginalMediaObject} from "./original-retirement";
const claim=defineMediaService({name:"media.captureOriginalDeleteRecovery",summary:"Bind fresh-person recovery to its exact existing conditional DELETE without replay.",kind:"mutation",permission:"scoped",agentCallable:false,stepUp:true,external:false,orchestratedBy:"media.reconcileStorageOperation",input:storageRecoveryConfirmation,output:z.custom<{key:string;binding:ReturnType<typeof checkedTransferBinding>}>(),auditInputFields:["id","outcome","stopDrainId"],handler:async(input,ctx)=>{
 if(ctx.actor.kind!=="user"||ctx.actor.keyScopes||!hasModuleAccess(ctx.actor,"media","manage"))transferConflict("Sign in as a freshly verified person with media management access.");
 await lockTransferInventory(ctx.tx);const[row]=await ctx.tx.select().from(mediaObjectWrites).where(eq(mediaObjectWrites.id,input.id)).limit(1).for("update");
 if(!row||row.operation!=="delete"||!row.originalReservationId||!row.namespace||!row.storageKind||!row.storageLocation||row.redactedAt||input.outcome!=="applied"||row.updatedAt.toISOString()!==input.expectedUpdatedAt||row.namespace!==input.originalNamespace||input.originalKey&&input.originalKey!==row.key||input.sha256&&input.sha256!==row.sha256||input.bytes!==undefined&&input.bytes!==row.bytes)transferConflict("Reload the exact original conditional removal; only fresh absence verification is available, never another DELETE.");
 const binding=checkedTransferBinding({kind:row.storageKind,namespace:row.namespace,location:row.storageLocation});ctx.setSubject("media_storage_operation",row.id);return{key:row.key,binding};
}});
export async function recoverExactOriginalDelete(input:StorageRecoveryConfirmation,actor:Actor):Promise<{ok:true}>{
 const original=await claim.call(input,actor);
 if(!await retireOriginalMediaObject(original.key,original.binding,input.id,input.stopDrainId))transferConflict("The original file remains owned or held. Keep its exact original removal receipt for recovery.");
 return{ok:true};
}
export default[claim];
