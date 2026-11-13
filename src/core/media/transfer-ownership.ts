// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C1.12/C11.08: contact pointers move; physical evidence and first capture do not.
import {sql} from "drizzle-orm";
import {z} from "zod";
import {registerContactReference} from "@/core/contacts/service";
import {ServiceError,type Tx} from "@/core/service";
import {requireTransferCapability} from "./transfer-authority";
const pointer=z.object({id:z.uuid(),contactId:z.uuid().nullable(),witness:z.string().length(64)});
/** An unrelated contact merge does not operate a transfer. Prove that its
 * exact current pointer scope is empty under the same inventory fence before
 * bypassing the inactive protocol. Any real subject still needs full guards. */
async function hasOriginalTransferSubjects(tx:Tx,ids:string[]):Promise<boolean>{
 await tx.execute(sql`select pg_advisory_xact_lock(1691709,82)`);
 const[scope]=await tx.execute<{present:boolean}>(sql`select exists(select 1 from media_storage_transfer_subjects where contact_id in (${sql.join(ids.map(id=>sql`${id}::uuid`),sql`, `)})) as present`);
 if(typeof scope?.present!=="boolean")throw new ServiceError("conflict","The complete original transfer ownership scope could not be verified.");
 return scope.present;
}
async function capture(tx:Tx,ids:string[]){
 if(!await hasOriginalTransferSubjects(tx,ids))return{state:[],undoable:true};
 await requireTransferCapability(tx);
 const payloads=await tx.execute<{size:number}>(sql`select size from (
  select octet_length(to_jsonb(caller)::text)::integer as size from media_storage_transfer_calls caller join media_storage_transfer_subjects subject on subject.object_id=caller.object_id where subject.contact_id in (${sql.join(ids.map(id=>sql`${id}::uuid`),sql`,` )})
  union all
  select octet_length(to_jsonb(member)::text)::integer as size from media_storage_transfer_receipts member join media_storage_transfer_subjects subject on subject.object_id=member.object_id where subject.contact_id in (${sql.join(ids.map(id=>sql`${id}::uuid`),sql`,` )})
 ) evidence limit 5001`);
 if(payloads.length>5000||payloads.reduce((sum,row)=>sum+Number(row.size),0)>1024*1024)return{state:[],undoable:false,blocker:"Original transfer evidence exceeds the bounded merge witness."};
 const rows=await tx.execute<{id:string;contact_id:string|null;witness:string;size:number}>(sql`
  select subject.id,subject.contact_id,
  encode(sha256(convert_to((jsonb_build_object('subject',to_jsonb(subject)-'contact_id','object',to_jsonb(object),'plan',to_jsonb(plan),
   'calls',coalesce((select jsonb_agg(to_jsonb(caller) order by caller.id) from media_storage_transfer_calls caller where caller.object_id=object.id),'[]'::jsonb),
   'receipts',coalesce((select jsonb_agg(to_jsonb(member) order by member.id) from media_storage_transfer_receipts member where member.object_id=object.id),'[]'::jsonb)))::text,'UTF8')),'hex') as witness,
  coalesce((select sum(octet_length(to_jsonb(caller)::text)) from media_storage_transfer_calls caller where caller.object_id=object.id),0)::integer as size
  from media_storage_transfer_subjects subject join media_storage_transfer_objects object on object.id=subject.object_id
  join media_storage_transfer_plans plan on plan.id=object.plan_id where subject.contact_id in (${sql.join(ids.map(id=>sql`${id}::uuid`),sql`,`)}) order by subject.id limit 5001 for update of subject`);
 if(rows.length>5000||rows.reduce((sum,row)=>sum+Number(row.size),0)>1024*1024)return{state:[],undoable:false,blocker:"Original transfer lineage exceeds the bounded merge witness."};
 return{state:rows.map(row=>({id:row.id,contactId:row.contact_id,witness:row.witness})),undoable:true};
}
registerContactReference({table:"media_storage_transfer_subjects",columns:["contact_id"],captureForUndo:(tx,duplicate,survivor)=>capture(tx,[duplicate,survivor]),
 repoint:async(tx,duplicate,survivor)=>{if(!await hasOriginalTransferSubjects(tx,[duplicate,survivor]))return;await requireTransferCapability(tx);await tx.execute(sql`update media_storage_transfer_subjects set contact_id=${survivor}::uuid where contact_id=${duplicate}::uuid`);},
 restoreAfterUndo:async(tx,beforeValue,afterValue,duplicate,survivor)=>{
  const before=pointer.array().parse(beforeValue),after=pointer.array().parse(afterValue),current=await capture(tx,[duplicate,survivor]);
  if(!current.undoable||JSON.stringify(current.state)!==JSON.stringify(after))throw new ServiceError("conflict","Original transfer evidence changed after this merge. Review the physical lineage before undoing it.");
  for(const row of before)await tx.execute(sql`update media_storage_transfer_subjects set contact_id=${row.contactId}::uuid where id=${row.id}::uuid`);
 },
});
