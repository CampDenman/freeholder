// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C1.12/C11.08: signing a browser PUT grants physical mutation authority.
// Generic upload/request capability, session expiry and an open provider
// upload do not supply durable per-part caller/finish/retirement provenance.
import {sql} from "drizzle-orm";
import {ServiceError,type Tx} from "@/core/service";
export async function assertDurableMultipartPartIssuance(tx:Tx):Promise<void>{
 const unavailable=()=>new ServiceError("conflict","Direct upload links are unavailable until upload recovery is fully supported. Keep the existing upload for review.");
 // Only this current compiled issuer entry marks its own transaction. Old
 // pure-signing handlers never receive it through connection reuse. The
 // eventual capability function MUST independently require runtime eligibility
 // before returning its authority tag; it remains unpublished in this slice.
 await tx.execute(sql`select set_config('freeholder.media_part_runtime_v1','bound-original-part-issuer-v1',true)`);
 const[installed]=await tx.execute<{present:boolean}>(sql`select to_regprocedure('freeholder_media_original_part_capability_v1()') is not null as present`);
 if(installed?.present!==true)throw unavailable();
 const[capability]=await tx.execute<{capability:string}>(sql`select freeholder_media_original_part_capability_v1() as capability`);
 if(capability?.capability!=="verified-original-multipart-part-authority-v1")throw unavailable();
 // This checkpoint intentionally publishes NO such capability. The complete
 // protocol must supply its guarded durable admissions/finishes before it can.
}
