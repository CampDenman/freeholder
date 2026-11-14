// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.38: authentic observational coverage is distinct from safe principal.
import { sql } from "drizzle-orm";
import { z } from "zod";
import { getService,ServiceError,type ServiceContext } from "@/core/service";
import { CONTROLLED_COLLECTION_PROTOCOL } from "@/modules/subscriptions/controlled-provider-collection-protocol";
import { readControlledCashObservationSource } from "@/modules/subscriptions/controlled-provider-cash-observation-source";
import { readControlledCashInspectionAncestry } from "@/modules/subscriptions/controlled-provider-cash-inspection-ancestry";
import { merchantTaxDigest } from "./merchant-tax-store";
const sha=z.string().regex(/^[a-f0-9]{64}$/);
export const controlledCashObservationAuthorityResult=z.object({allowed:z.literal(true),revision:sha,causalSourceRevision:sha}).strict();
export async function requireHeldControlledCashResource(ctx:ServiceContext,resourceId:string){
 const[held]=await ctx.tx.execute<{held:boolean}>(sql`select exists(select 1 from pg_locks l where l.pid=pg_backend_pid() and l.locktype='advisory' and l.database=(select oid from pg_database where datname=current_database()) and l.granted and l.mode='ExclusiveLock' and l.objsubid=1
  and l.classid::bigint=(case when hashtext(${`controlled-provider:${resourceId}`})<0 then 4294967295::bigint else 0::bigint end)
  and l.objid::bigint=(hashtext(${`controlled-provider:${resourceId}`})::bigint & 4294967295::bigint))
  and exists(select 1 from pg_locks c where c.pid=pg_backend_pid() and c.locktype='advisory' and c.database=(select oid from pg_database where datname=current_database()) and c.granted and c.mode in('ShareLock','ExclusiveLock') and c.objsubid=1
   and ((c.classid::bigint << 32) | c.objid::bigint)=hashtext('contact-identity-privacy')::bigint) as held`);
 if(!held?.held)throw new ServiceError("conflict","Acquire the contact-identity prefix then actual original controlled resource before parent/canonical money locks; finished inspection verification cannot reverse that order.");
}
export async function controlledCashObservationAuthority(ctx:ServiceContext,input:{collectionId:string;receiptId:string;inspectionId?:string}){
 const source=await readControlledCashObservationSource(ctx.tx,input);await requireHeldControlledCashResource(ctx,source.resourceId);
 if(source.unfinishedControlledCallIds.length)throw new ServiceError("conflict","The actual original controlled caller is still unfinished. Full raw coverage is not permission to start or certify another bank read.");
 const reader=getService("invoicing.controlledProviderCashObservationAuthority");
 if(reader.def.kind!=="query"||reader.def.permission!=="system"||reader.def.external!==false)throw new ServiceError("conflict","Restore the genuine private parent observational coverage/caller/privacy reader before any new cash GET or returned-evidence verification.");
 const authority=controlledCashObservationAuthorityResult.parse(await ctx.callAsSystem(reader,{collectionId:source.collectionId,receiptId:source.receiptId,requiredProtocol:CONTROLLED_COLLECTION_PROTOCOL,...(input.inspectionId?{inspectionId:input.inspectionId}:{})}));
 const current=await readControlledCashObservationSource(ctx.tx,input);
 if(current.sourceRevision!==source.sourceRevision)throw new ServiceError("conflict","The actual original cash source changed during parent observation review. Preserve every occurrence and obtain a genuine fresh read.");
 return{source:current,authority};
}
/** Called only with a REAL shared context/held resource. No public-supplied
 * source fields, boolean override, reason filter or mocked ServiceContext is
 * accepted. Parent FULL coverage retains this actual returned read and all debt. */
export async function readControlledCashInspectionObservationContext(ctx:ServiceContext,input:{collectionId:string;receiptId:string;inspectionId:string}){
 const own=await readControlledCashInspectionAncestry(ctx.tx,input),checked=await controlledCashObservationAuthority(ctx,input),currentOwn=await readControlledCashInspectionAncestry(ctx.tx,input);
 if(currentOwn.revision!==own.revision||checked.source.sourceRevision!==own.sourceRevision||checked.authority.causalSourceRevision!==own.parentPreAdmissionRevision)throw new ServiceError("conflict","The original pre-admission source no longer matches the exact returned-own causal graph. A later read cannot waive unrelated money, privacy or original caller debt.");
 return{source:checked.source,ancestry:currentOwn,parent:checked.authority,revision:merchantTaxDigest({sourceRevision:checked.source.sourceRevision,ownRevision:currentOwn.revision,currentParentRevision:checked.authority.revision,causalSourceRevision:checked.authority.causalSourceRevision}),suppliesPrincipalAuthority:false as const,suppliesApplicationAuthority:false as const};
}
