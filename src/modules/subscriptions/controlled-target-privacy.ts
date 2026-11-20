// Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0
// C1.08/C12.38: accepted target ownership, never caller-selected contacts.
import { sql } from "drizzle-orm";
import { z } from "zod";
import { ServiceError, type Tx } from "@/core/service";

/** Read only. The actual caller holds shared contact identity through the
 * complete effect transaction; verified-erasure/hold/marker writers hold the
 * real exclusive key before their writes. The guarded SQL source independently
 * calls the same exact target-derived predicate. Observation GET recovery is
 * separate and never calls this write/access gate. */
export async function controlledTargetPrivacyReady(tx:Tx,collectionId:string):Promise<boolean>{
 z.uuid().parse(collectionId);
 const[present]=await tx.execute<{present:boolean}>(sql`select to_regprocedure('freeholder_controlled_target_privacy_ready(uuid)') is not null as present`);
 if(present?.present!==true)throw new ServiceError("conflict","Install the complete original-owner privacy and independent paid-access guards before activating a new paid period.");
 const[answer]=await tx.execute<{ready:boolean}>(sql`select freeholder_controlled_target_privacy_ready(${collectionId}::uuid) as ready`);
 return answer?.ready===true;
}
