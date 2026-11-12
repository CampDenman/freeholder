// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C1.12/C11.08: original ownership follows the contact, without copied payloads.
import {sql} from "drizzle-orm";
import {z} from "zod";
import {registerContactReference} from "@/core/contacts/service";
import {ServiceError,type Tx} from "@/core/service";
import {allowMediaReceiptWrites} from "./write-ledger";

const pointer=z.object({id:z.string(),contactId:z.uuid().nullable(),witness:z.string().length(64)});
const descriptors=[
 {table:"media_uploads",key:"id",owner:"owner_contact_id"},
 {table:"media_objects",key:"key",owner:"owner_contact_id"},
 {table:"media_multipart_resources",key:"id",owner:"contact_id"},
]as const;
for(const descriptor of descriptors){
 const capture=async(tx:Tx,ids:string[])=>{
  if(descriptor.table==="media_multipart_resources"){
   const operations=await tx.execute<{bytes:number}>(sql`select length(operation.parts::text) as bytes from media_multipart_operations operation
    join media_multipart_resources resource on resource.id=operation.resource_id
    where resource.contact_id in (${sql.join(ids.map(id=>sql`${id}::uuid`),sql`,`)}) order by operation.id limit 5001`);
   if(operations.length>5000||operations.reduce((sum,row)=>sum+Number(row.bytes),0)>1024*1024)return{state:[],undoable:false,blocker:"Original multipart call evidence exceeds the bounded merge witness."};
  }
  const owner=sql.identifier(descriptor.owner),key=sql.identifier(descriptor.key),table=sql.identifier(descriptor.table);
  const children=descriptor.table==="media_multipart_resources"?sql`coalesce((select jsonb_agg(to_jsonb(operation) order by operation.id) from media_multipart_operations operation where operation.resource_id=t.id),'[]'::jsonb)`:sql`'[]'::jsonb`;
  const rows=await tx.execute<{id:string;contact_id:string|null;witness:string}>(sql`select ${key}::text as id,${owner} as contact_id,
   encode(sha256(convert_to(((to_jsonb(t)-${descriptor.owner})||jsonb_build_object('original_operations',${children}))::text,'UTF8')),'hex') as witness
   from ${table} t where ${owner} in (${sql.join(ids.map(id=>sql`${id}::uuid`),sql`,`)}) order by ${key} limit 5001 for update`);
  if(rows.length>5000)return{state:[],undoable:false,blocker:"Original upload ownership exceeds the bounded merge witness."};
  return{state:rows.map(row=>({id:row.id,contactId:row.contact_id,witness:row.witness})),undoable:true};
 };
 registerContactReference({
  table:descriptor.table,
  columns:[descriptor.owner],
  captureForUndo:(tx,duplicate,survivor)=>capture(tx,[duplicate,survivor]),
  repoint:async(tx,duplicate,survivor)=>{await allowMediaReceiptWrites(tx);await tx.execute(sql`update ${sql.identifier(descriptor.table)} set ${sql.identifier(descriptor.owner)}=${survivor}::uuid where ${sql.identifier(descriptor.owner)}=${duplicate}::uuid`);},
  restoreAfterUndo:async(tx,beforeValue,afterValue,duplicate,survivor)=>{
   const before=pointer.array().parse(beforeValue),after=pointer.array().parse(afterValue),current=await capture(tx,[duplicate,survivor]);
   if(!current.undoable||JSON.stringify(current.state)!==JSON.stringify(after))throw new ServiceError("conflict","Original upload or multipart evidence changed after the merge. Review it before separating these contacts.");
   await allowMediaReceiptWrites(tx);
   for(const row of before)await tx.execute(sql`update ${sql.identifier(descriptor.table)} set ${sql.identifier(descriptor.owner)}=${row.contactId}::uuid where ${sql.identifier(descriptor.key)}::text=${row.id}`);
  },
 });
}
