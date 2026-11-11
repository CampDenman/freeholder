// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C2.29/C11.10: active merged identities remain one privacy subject.
import { and, eq, inArray, isNull, sql, type SQL, type SQLWrapper } from "drizzle-orm";
import { contactMergeOperations, contacts } from "@/core/contacts/schema";
import { auditLog } from "@/core/events/schema";
import type { Tx } from "@/core/service";
import {lockContactIdentity} from "@/core/contacts/identity-lock";

const address = (value: unknown): string => typeof value === "string" ? value.trim().toLowerCase() : "";
const snapshotEmail = (value: unknown): string => value && typeof value === "object" ? address((value as { email?: unknown }).email) : "";

/** Immutable owned IDs plus recorded addresses; never infer another contact. */
export async function contactPrivacyIdentity(tx: Tx, contactId: string): Promise<{ contactIds: string[]; emails: string[] }> {
  await lockContactIdentity(tx);
  const [contact] = await tx.select({ email: contacts.email }).from(contacts).where(eq(contacts.id, contactId)).limit(1);
  const emails = new Set<string>();
  if (address(contact?.email)) emails.add(address(contact?.email));
  const seen = new Set<string>(), pending = [contactId];
  while (pending.length) {
    const ids = pending.splice(0).filter(id => !seen.has(id));
    if (!ids.length) break;
    for (const id of ids) seen.add(id);
    const merged = await tx.select().from(contactMergeOperations).where(and(
      inArray(contactMergeOperations.survivingContactId, ids), isNull(contactMergeOperations.undoneAt),
    ));
    for (const operation of merged) {
      for (const snapshot of [operation.survivorBefore, operation.duplicateBefore, operation.survivorAfter]) {
        const email = snapshotEmail(snapshot); if (email) emails.add(email);
      }
      pending.push(operation.duplicateContactId);
    }
  }
  const contactIds = [...seen];
  // Earlier caches predate explicit source bindings. A contact's own recorded
  // create/resolve/update addresses survive an address edit until erasure.
  const history = await tx.select({ email: sql<unknown>`${auditLog.diff}->'email'` }).from(auditLog).where(and(
    eq(auditLog.subjectType, "contact"), inArray(auditLog.subjectId, contactIds),
    inArray(auditLog.action, ["contacts.create", "contacts.resolve", "contacts.update"]),
    contactHistoryOwnership(auditLog.subjectId,auditLog.at,contactIds,"all"),
  ));
  for (const record of history) if (address(record.email)) emails.add(address(record.email));
  return { contactIds, emails: [...emails] };
}


/** Membership at the time of a record, including merges later undone.
 * A mixed historical payload is never evidence for a separate subject today.
 * UUID casting is guarded because audit subjects are polymorphic text.
 */
export function contactHistoryOwnership(subject:SQLWrapper,at:SQLWrapper,ownedIds:string[],mode:"any"|"all"):SQL<boolean>{
 if(!ownedIds.length)return sql<boolean>`false`;
 const owned=sql.join(ownedIds.map(id=>sql`${id}::uuid`),sql`, `);
 const members=sql`with recursive privacy_members(id) as (
   select case when ${subject}::text ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then ${subject}::uuid else null::uuid end
   union
   select operation.duplicate_contact_id from ${contactMergeOperations} operation
    join privacy_members member on operation.surviving_contact_id=member.id
    where operation.merged_at<=${at} and (operation.undone_at is null or operation.undone_at>=${at})
 )`;
 return mode==="any"
  ? sql<boolean>`(${members} select coalesce(bool_or(id in (${owned})),false) from privacy_members where id is not null)`
  : sql<boolean>`(${members} select count(*)>0 and coalesce(bool_and(id in (${owned})),false) from privacy_members where id is not null)`;
}

type MergePoint={id:string;survivingContactId:string;duplicateContactId:string;mergedMicros:string;undoneMicros:string|null};
/** Read only identity metadata first; owner recovery payloads never enter exports. */
export async function contactPrivacyHistory(tx:Tx,ownedIds:string[]){
 const owned=sql.join(ownedIds.map(id=>sql`${id}::uuid`),sql`, `);
 const operations=ownedIds.length?await tx.execute<MergePoint>(sql`
  with recursive connected(id) as (
   select unnest(array[${owned}]::uuid[])
   union
   select case when operation.surviving_contact_id=connected.id then operation.duplicate_contact_id else operation.surviving_contact_id end
    from ${contactMergeOperations} operation join connected
     on operation.surviving_contact_id=connected.id or operation.duplicate_contact_id=connected.id
  )
  select operation.id,operation.surviving_contact_id as "survivingContactId",operation.duplicate_contact_id as "duplicateContactId",
   (extract(epoch from operation.merged_at)*1000000)::bigint::text as "mergedMicros",
   (extract(epoch from operation.undone_at)*1000000)::bigint::text as "undoneMicros"
  from ${contactMergeOperations} operation where operation.surviving_contact_id in (select id from connected)
   or operation.duplicate_contact_id in (select id from connected)
 `):[];
 const byParent=new Map<string,MergePoint[]>(),byId=new Map(operations.map(operation=>[operation.id,operation]));
 const contactIds=new Set(ownedIds);
 for(const operation of operations){
  byParent.set(operation.survivingContactId,[...(byParent.get(operation.survivingContactId)??[]),operation]);
  contactIds.add(operation.survivingContactId);contactIds.add(operation.duplicateContactId);
 }
 const own=new Set(ownedIds),cache=new Map<string,{containsSubject:boolean;onlySubject:boolean}>();
 function at(contactId:string,micros:string,excludeOperation?:string){
  const key=JSON.stringify([contactId,micros,excludeOperation]);const prior=cache.get(key);if(prior)return prior;
  const point=BigInt(micros),seen=new Set<string>(),pending=[contactId];
  while(pending.length){
   const next=pending.pop()!;if(seen.has(next))continue;seen.add(next);
   for(const operation of byParent.get(next)??[]){
    if(operation.id!==excludeOperation && BigInt(operation.mergedMicros)<=point && (operation.undoneMicros===null || BigInt(operation.undoneMicros)>=point))pending.push(operation.duplicateContactId);
   }
  }
  const result={containsSubject:[...seen].some(id=>own.has(id)),onlySubject:[...seen].every(id=>own.has(id))};cache.set(key,result);return result;
 }
 return {contactIds:[...contactIds],operations:[...operations],operation:(id:string)=>byId.get(id),at};
}
