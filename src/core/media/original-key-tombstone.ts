// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Metadata-only reservations confer no physical capability. Every actual
// creator must supply its original namespace/key before dispatch or signing.
import {sql} from "drizzle-orm";
import type {Tx} from "@/core/service";
import {transferConflict} from "./transfer-proof";
export type OriginalCreatorRole="ordinary_put"|"target_put"|"multipart_create"|"multipart_complete"|"multipart_part";
export async function assertOriginalKeyCreator(tx:Tx,input:{namespace:string|null|undefined;key:string;role:OriginalCreatorRole}):Promise<void>{
 if(!input.namespace||!/^[a-f0-9]{64}$/.test(input.namespace)||!input.key||/[\u0000-\u001f]/.test(input.key))transferConflict("Restore the exact original storage resource before starting another upload.");
 const{objectKeyDigest}=await import("./write-ledger");
 await tx.execute(sql`select pg_advisory_xact_lock_shared(1691709,82)`);
 const[available]=await tx.execute<{present:boolean}>(sql`select to_regprocedure('freeholder_media_original_key_recreation_fenced(text,text)') is not null as present`);
 if(available?.present!==true)transferConflict("Upload recovery is not fully available. Keep the original upload for review.");
 const[row]=await tx.execute<{fenced:boolean}>(sql`select freeholder_media_original_key_recreation_fenced(${input.namespace},${objectKeyDigest(input.key)}) as fenced`);
 if(row?.fenced!==false)transferConflict("This original file key is permanently closed to new uploads. Start a new upload with a new key.");
}
