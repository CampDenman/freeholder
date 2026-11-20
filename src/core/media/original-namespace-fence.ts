// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// A provider/recovery writer tag does not authorize ordinary mutation through
// a captured executor drain or an immutable active source transfer claim.
import {sql} from "drizzle-orm";
import type {Tx} from "@/core/service";
import {transferConflict} from "./transfer-proof";
export async function assertOriginalNamespaceMutation(tx:Tx,namespace:string):Promise<void>{
 // Same shared fence as the parent admission: an operator/claim takes the
 // exclusive side before its complete inventory. No lock upgrade is needed.
 await tx.execute(sql`select pg_advisory_xact_lock_shared(1691709,82)`);
 const[fence]=await tx.execute<{blocked:boolean}>(sql`select exists(select 1 from media_storage_writer_drains where namespace=${namespace} and state<>'released') or exists(select 1 from media_storage_transfer_plans where source_namespace=${namespace} and state<>'cancelled') as blocked`);
 if(fence?.blocked!==false)transferConflict("The exact original namespace is fenced. Recovery reads cannot grant an ordinary mutation or restart an earlier caller.");
}
