// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Logical aliases follow immutable receipt edges, never equal current keys.
import {sql} from "drizzle-orm";
import type {Tx} from "@/core/service";
import type {StorageBinding} from "@/adapters/storage/types";
import {checkedTransferBinding} from "./transfer-witness";
import {transferConflict} from "./transfer-proof";
export interface AdoptedPhysicalLineage{binding:StorageBinding;key:string;receiptId:string;namespace:string;keyDigest:string;sha256:string;bytes:number;hops:number}
export async function originalPhysicalLineage(executor:Pick<Tx,"execute">,key:string,excludedPlan:string|null=null):Promise<AdoptedPhysicalLineage|null>{
 const[row]=await executor.execute<{lineage:AdoptedPhysicalLineage|null}>(sql`select freeholder_media_transfer_physical_lineage(${key},${excludedPlan}::uuid) as lineage`);
 if(!row)transferConflict("The complete immutable physical lineage is unavailable.");
 if(!row.lineage)return null;
 const lineage=row.lineage,binding=checkedTransferBinding(lineage.binding);
 if(binding.namespace!==lineage.namespace||!Number.isSafeInteger(lineage.bytes)||lineage.bytes<0||!Number.isInteger(lineage.hops)||lineage.hops<1||lineage.hops>32)transferConflict("The original adopted resource has an invalid physical lineage.");
 return{...lineage,binding};
}
