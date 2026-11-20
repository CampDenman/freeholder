// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Recovery never adopts the current reservation merely because a key matches.
import {sql} from "drizzle-orm";
import type {Tx} from "@/core/service";
import {transferConflict} from "./transfer-proof";
export function originalQuotaSettlement(originalToken:string,row:{bytes:string;pendingToken:string|null;settledToken:string|null}|undefined,bytes:number):"already_settled"|"pending"{
 if(!Number.isSafeInteger(bytes)||bytes<0||!row)transferConflict("Restore the exact original quota reservation; recovery cannot invent a current-key reservation.");
 if(row.pendingToken===null){if(row.settledToken!==originalToken||BigInt(row.bytes)!==BigInt(bytes))transferConflict("The current settled quota belongs to another original operation.");return"already_settled";}
 if(row.pendingToken!==originalToken||BigInt(row.bytes)<BigInt(bytes))transferConflict("Another quota token or changed reserved bytes cannot settle this original caller.");
 return"pending";
}
export async function settleRecoveredOriginalQuota(tx:Tx,original:{namespace:string;physicalKey:string;quotaToken:string|null},bytes:number):Promise<void>{
 if(!original.quotaToken)return; // This actual admission made no quota claim.
 await tx.execute(sql`select namespace from storage_quota_state where namespace=${original.namespace} for update`);
 const rows=await tx.execute<{bytes:string;pendingToken:string|null;settledToken:string|null}>(sql`select bytes::text,pending_token as "pendingToken",last_settled_token as "settledToken" from storage_quota_objects where namespace=${original.namespace} and object_key=${original.physicalKey} for update`),row=rows[0];
 if(originalQuotaSettlement(original.quotaToken,row,bytes)==="already_settled")return;
 const changed=await tx.execute(sql`update storage_quota_objects set bytes=${bytes},pending_token=null,last_settled_token=${original.quotaToken}::uuid where namespace=${original.namespace} and object_key=${original.physicalKey} and pending_token=${original.quotaToken}::uuid returning object_key`);if(changed.length!==1)transferConflict();
}

/** Actual all-version/session retirement has already been proved under the
 * original fence. Release only this caller's original quota token; retain the
 * token and locator until the separate privacy minimization phase succeeds. */
export async function releaseRetiredOriginalQuota(tx:Tx,original:{namespace:string;physicalKey:string;quotaToken:string|null},bytes:number):Promise<void>{
 await tx.execute(sql`select namespace from storage_quota_state where namespace=${original.namespace} for update`);
 const rows=await tx.execute<{bytes:string;pendingToken:string|null;settledToken:string|null}>(sql`select bytes::text,pending_token as "pendingToken",last_settled_token as "settledToken" from storage_quota_objects where namespace=${original.namespace} and object_key=${original.physicalKey} for update`),row=rows[0];
 if(!original.quotaToken){if(row)transferConflict("An unbound current quota charge cannot be released by an equal key.");return;}
 if(!row||row.pendingToken!==null&&row.pendingToken!==original.quotaToken||row.settledToken!==null&&row.settledToken!==original.quotaToken||row.pendingToken===null&&row.settledToken!==original.quotaToken||!Number.isSafeInteger(bytes)||bytes<0||BigInt(row.bytes)<BigInt(bytes)&&BigInt(row.bytes)!==0n)transferConflict("Keep the exact original quota token debt; another reservation cannot be released by this retirement.");
 await tx.execute(sql`update storage_quota_objects set bytes=0,pending_token=null,last_settled_token=${original.quotaToken}::uuid where namespace=${original.namespace} and object_key=${original.physicalKey}`);
}
