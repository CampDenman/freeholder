// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C10.32/C11.08: copies consume capacity before physical admission.
import {sql} from "drizzle-orm";
import {env} from "@/core/env";
import type {Tx} from "@/core/service";
import {transferConflict} from "./transfer-proof";
export async function reserveTransferQuota(tx:Tx,namespace:string,key:string,bytes:number,token:string):Promise<void>{
 const e=env(),configured=e.MEDIA_TRANSFER_TARGET_QUOTA_BYTES;
 if(!configured){if(e.FREEHOLDER_STORAGE_QUOTA_BYTES)transferConflict("Configure and inventory the destination quota before copying hosted storage.");return;}
 const max=BigInt(configured);
 if(max>BigInt(Number.MAX_SAFE_INTEGER))transferConflict("The configured target quota exceeds exact accounting limits.");
 const rows=await tx.execute<{max_bytes:string}>(sql`select max_bytes::text from storage_quota_state where namespace=${namespace} for update`);
 if(!rows[0]||BigInt(rows[0].max_bytes)!==max)transferConflict("Inventory the exact original destination quota before copying bytes.");
 const existing=await tx.execute(sql`select object_key from storage_quota_objects where namespace=${namespace} and object_key=${key}`);
 if(existing.length)transferConflict("The transfer destination quota key is already occupied.");
 const usage=await tx.execute<{used:string}>(sql`select coalesce(sum(bytes),0)::text as used from storage_quota_objects where namespace=${namespace}`);
 if(BigInt(usage[0]!.used)+BigInt(bytes)>max)transferConflict("The complete copied object exceeds destination storage capacity.");
 await tx.execute(sql`insert into storage_quota_objects(namespace,object_key,bytes,pending_token)values(${namespace},${key},${bytes},${token}::uuid)`);
}
export async function settleTransferQuota(tx:Tx,namespace:string,key:string,token:string):Promise<void>{
 await tx.execute(sql`select namespace from storage_quota_state where namespace=${namespace} for update`);
 await tx.execute(sql`update storage_quota_objects set pending_token=null where namespace=${namespace} and object_key=${key} and pending_token=${token}::uuid`);
}
/** Absence is established by an exact finished conditional deletion/read. */
export async function releaseTransferQuota(tx:Tx,namespace:string,key:string):Promise<void>{
 await tx.execute(sql`select namespace from storage_quota_state where namespace=${namespace} for update`);
 await tx.execute(sql`update storage_quota_objects set bytes=0,pending_token=null where namespace=${namespace} and object_key=${key}`);
}
