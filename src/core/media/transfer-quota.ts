// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C10.32/C11.08: copies consume capacity before physical admission.
import {sql} from "drizzle-orm";
import {env} from "@/core/env";
import type {Tx} from "@/core/service";
import {transferConflict} from "./transfer-proof";
import {transferQuotaOriginal,transferQuotaCharge,proveTransferQuotaRelease,transferQuotaReleaseDecision,retirePriorTransferQuota,type TransferQuotaRole} from "./transfer-quota-proof";
import {originalQuotaSettlement} from "./original-recovery-quota";
export async function reserveTransferQuota(tx:Tx,namespace:string,key:string,bytes:number,token:string):Promise<string|null>{
 const e=env(),configured=e.MEDIA_TRANSFER_TARGET_QUOTA_BYTES;
 if(!configured){if(e.FREEHOLDER_STORAGE_QUOTA_BYTES)transferConflict("Configure and inventory the destination quota before copying hosted storage.");return null;}
 const max=BigInt(configured);
 if(max>BigInt(Number.MAX_SAFE_INTEGER))transferConflict("The configured target quota exceeds exact accounting limits.");
 const rows=await tx.execute<{max_bytes:string}>(sql`select max_bytes::text from storage_quota_state where namespace=${namespace} for update`);
 if(!rows[0]||BigInt(rows[0].max_bytes)!==max)transferConflict("Inventory the exact original destination quota before copying bytes.");
 await(await import("./original-quota-evidence")).assertOriginalQuotaCoverage(tx,namespace,token);
 const existing=await tx.execute<{pendingToken:string|null;settledToken:string|null}>(sql`select pending_token as "pendingToken",last_settled_token as "settledToken" from storage_quota_objects where namespace=${namespace} and object_key=${key} for update`);
 let retiredToken:string|null=null;
 if(existing.length){const previous=existing[0]!.pendingToken??existing[0]!.settledToken;if(!previous)transferConflict("Unbound historical quota inventory needs its own genuine recovery.");retiredToken=await retirePriorTransferQuota(tx,namespace,key,bytes,previous);}
 const usage=await tx.execute<{used:string}>(sql`select coalesce(sum(bytes),0)::text as used from storage_quota_objects where namespace=${namespace}`);
 if(BigInt(usage[0]!.used)+BigInt(bytes)>max)transferConflict("The complete copied object exceeds destination storage capacity.");
 const changed=retiredToken===null?await tx.execute(sql`insert into storage_quota_objects(namespace,object_key,bytes,pending_token)values(${namespace},${key},${bytes},${token}::uuid) returning object_key`):await tx.execute(sql`update storage_quota_objects set bytes=${bytes},pending_token=${token}::uuid where namespace=${namespace} and object_key=${key} and bytes=0 and pending_token is null and last_settled_token=${retiredToken}::uuid returning object_key`);
 if(changed.length!==1)transferConflict("The exact destination quota reservation changed before admission.");
 return token;
}
export async function settleTransferQuota(tx:Tx,role:TransferQuotaRole):Promise<void>{
 const original=await transferQuotaOriginal(tx,role),row=await transferQuotaCharge(tx,original),token=original.caller?.quotaToken;if(!token)return;
 const[proof]=await tx.execute<{proven:boolean}>(sql`select freeholder_media_transfer_quota_settlement_proven(${original.caller!.id}::uuid,${token}::uuid,${original.object.bytes}::bigint) as proven`);
 if(proof?.proven!==true)transferConflict("The actual original accepted request is required before quota settlement.");
 const current=row?{bytes:String(row.bytes),pendingToken:row.pendingToken,settledToken:row.lastSettledToken}:undefined;
 if(originalQuotaSettlement(token,current,original.object.bytes)==="already_settled")return;
 const changed=await tx.execute(sql`update storage_quota_objects set bytes=${original.object.bytes},pending_token=null,last_settled_token=${token}::uuid where namespace=${original.binding.namespace} and object_key=${row!.objectKey} and pending_token=${token}::uuid returning object_key`);
 if(changed.length!==1)transferConflict("The exact original quota reservation changed before settlement.");
}
/** Release only the actual original physical role, preserving its settled
 * token and live copied lineage. Missing/current equal-key rows are no proof. */
export async function releaseTransferQuota(tx:Tx,role:TransferQuotaRole):Promise<void>{
 const original=await transferQuotaOriginal(tx,role),row=await transferQuotaCharge(tx,original),token=original.caller?.quotaToken;if(!token)return;
 if(!row)transferConflict();const closed=await proveTransferQuotaRelease(tx,original,role.side,row);
 if(transferQuotaReleaseDecision(token,original.object.bytes,row,closed)==="already_released")return;
 const changed=await tx.execute(sql`update storage_quota_objects set bytes=0,pending_token=null,last_settled_token=${token}::uuid where namespace=${original.binding.namespace} and object_key=${row.objectKey} and bytes=${row.bytes} and pending_token is not distinct from ${row.pendingToken}::uuid and last_settled_token is not distinct from ${row.lastSettledToken}::uuid returning object_key`);
 if(changed.length!==1)transferConflict("The exact original quota charge changed before physical-role release.");
}
