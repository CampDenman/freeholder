// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C1.08/C11.10: real merge/undo, subject isolation and acknowledged erasure.
import {afterAll,beforeEach,describe,expect,it} from "vitest";
import {eq} from "drizzle-orm";
import {z} from "zod";
import {defineService} from "@/core/service";
import {db} from "@/core/db";
import {auditLog} from "@/core/events/schema";
import {resetStorageForTests} from "@/adapters/storage";
import {contactMergeOperations,mergeCandidates,timelineEvents} from "@/core/contacts/schema";
import {createContact,resolveContact,mergeContacts,undoContactMerge,updateContact} from "@/core/contacts/service";
import {contactPrivacySources,createDataRequest,verifyDataRequest,fulfillDataRequest,addRetentionException} from "@/core/privacy/service";
import {lockContactIdentity} from "@/core/contacts/identity-lock";
import {contactPrivacyIdentity} from "@/core/privacy/contact-identity";
import {OWNER,closeDb,hasDatabase,truncateSpine} from "../helpers/spine";
async function person(key:string){return (await resolveContact.call({name:`Synthetic ${key}`,email:`${key}-private@example.test`},OWNER)).contact;}
async function exportSource(scope:string,contactId:string){
 const source=contactPrivacySources().find(value=>value.scope===scope);if(!source)throw new Error(`Missing scope ${scope}`);
 return db().transaction(tx=>source.exportData(tx,contactId));
}
async function erase(contactId:string){
 const request=await createDataRequest.call({contactId,request:{kind:"erasure"}},OWNER);
 await verifyDataRequest.call({id:request.id,method:"Synthetic peer-review identity"},OWNER);
 expect((await fulfillDataRequest.call({id:request.id,confirmation:"ERASE"},OWNER)).request.status).toBe("completed");
}
const mergedBatch=defineService({name:"contacts.lineageBatchFixture",summary:"Privacy fixture using a real shared transaction.",kind:"mutation",permission:"scoped",external:false,input:z.object({a:z.uuid(),b:z.uuid(),email:z.email()}),output:z.object({operationId:z.uuid()}),handler:async(input,ctx)=>{
 await ctx.call(updateContact,{id:input.a,ownerNotes:"Owned note before the merge"});
 const merged=await ctx.call(mergeContacts,{survivingId:input.a,duplicateId:input.b});
 await ctx.call(resolveContact,{email:input.email});
 return {operationId:merged.mergeOperationId};
}});
describe.runIf(hasDatabase)("contact privacy lineage (C1.08/C11.10)",()=>{
 beforeEach(async()=>{resetStorageForTests();await truncateSpine();});afterAll(closeDb);
 it("does not export the separate other person's merge snapshot after undo",async()=>{
  const a=await person("subject-a"),b=await person("other-b");
  const merged=await mergeContacts.call({survivingId:a.id,duplicateId:b.id},OWNER);
  await undoContactMerge.call({operationId:merged.mergeOperationId},OWNER);
  expect(await db().transaction(tx=>contactPrivacyIdentity(tx,a.id))).toMatchObject({contactIds:[a.id]});
  expect(JSON.stringify(await exportSource("contact.merge_history",a.id))).not.toContain(b.email);
 });
 it("does not export another undone subject through contact audit differences",async()=>{
  const a=await person("audit-a"),b=await person("audit-other-b");
  const merged=await mergeContacts.call({survivingId:a.id,duplicateId:b.id},OWNER);
  await undoContactMerge.call({operationId:merged.mergeOperationId},OWNER);
  expect(JSON.stringify(await exportSource("contact.audit",a.id))).not.toContain(b.email);
 });
 it("erases every raw snapshot after a transitive active merge",async()=>{
  const a=await person("transitive-a"),b=await person("transitive-b"),c=await person("transitive-c");
  await mergeContacts.call({survivingId:a.id,duplicateId:b.id},OWNER);
  await mergeContacts.call({survivingId:c.id,duplicateId:a.id},OWNER);
  expect((await db().transaction(tx=>contactPrivacyIdentity(tx,c.id))).contactIds).toEqual(expect.arrayContaining([a.id,b.id,c.id]));
  await erase(c.id);
  const operations=await db().select().from(contactMergeOperations);
  expect(JSON.stringify(operations)).not.toContain(b.email);
  expect(JSON.stringify(operations)).not.toContain(a.email);
 });
 it("does not erase the separate undone person's historical snapshot",async()=>{
  const a=await person("erase-a"),b=await person("erase-other-b");
  const merged=await mergeContacts.call({survivingId:a.id,duplicateId:b.id},OWNER);
  await undoContactMerge.call({operationId:merged.mergeOperationId},OWNER);
  await erase(a.id);
  const [operation]=await db().select().from(contactMergeOperations).where(eq(contactMergeOperations.id,merged.mergeOperationId));
  expect((operation!.duplicateBefore as {email?:string}).email).toBe(b.email);
 });
 it("strictly erases merged audit differences while preserving actor, action and subject history",async()=>{
  const a=await person("audit-lineage-a"),b=await person("audit-lineage-b");
  const [before]=await db().select().from(auditLog).where(eq(auditLog.subjectId,b.id));
  expect(before!.diff).toMatchObject({email:b.email});
  await mergeContacts.call({survivingId:a.id,duplicateId:b.id},OWNER);
  await erase(a.id);
  const [after]=await db().select().from(auditLog).where(eq(auditLog.id,before!.id));
  expect(after!.diff).toEqual({});
  expect(after).toEqual({...before,diff:{}});
 });
 it("does not export the mixed survivor-after snapshot of another undone subject",async()=>{
  const a=await createContact.call({name:"No original address"},OWNER),b=await person("mixed-snapshot-b");
  const merged=await mergeContacts.call({survivingId:a.id,duplicateId:b.id},OWNER);
  const [operation]=await db().select().from(contactMergeOperations).where(eq(contactMergeOperations.id,merged.mergeOperationId));
  expect((operation!.survivorAfter as {email?:string}).email).toBe(b.email);
  await undoContactMerge.call({operationId:merged.mergeOperationId},OWNER);
  expect(JSON.stringify(await exportSource("contact.merge_history",a.id))).not.toContain(b.email);
 });
 it("excludes owner recovery payloads from an otherwise owned subject export",async()=>{
  const a=await person("recovery-a"),b=await person("recovery-b");
  const merged=await mergeContacts.call({survivingId:a.id,duplicateId:b.id},OWNER);
  const checkpoint={privateOtherPartyEmail:"unrelated-checkpoint-person@example.test",providerAccount:"private-other-account",state:"owner-only recovery data"};
  await db().update(contactMergeOperations).set({referenceState:[checkpoint]}).where(eq(contactMergeOperations.id,merged.mergeOperationId));
  const exported=JSON.stringify(await exportSource("contact.merge_history",a.id));
  expect(exported).not.toContain(checkpoint.privateOtherPartyEmail);
  expect(exported).not.toContain(checkpoint.providerAccount);
 });
 it("exports only this subject's duplicate-candidate fields and no other-party evidence value",async()=>{
  const a=await person("candidate-a"),b=await person("candidate-other-b");
  await db().insert(mergeCandidates).values({contactAId:a.id,contactBId:b.id,contactAName:a.name,contactAEmail:a.email,contactBName:b.name,contactBEmail:b.email,score:50,reasons:[{code:"similar_email",points:50,value:b.email}]});
  const exported=JSON.stringify(await exportSource("contact.merge_history",a.id));
  expect(exported).toContain(a.email);
  expect(exported).not.toContain(b.email);
  expect(exported).not.toContain(b.id);
 });
 it("keeps a named merge-history hold limited to its retained scope",async()=>{
  const a=await person("hold-a"),b=await person("hold-b");
  const merged=await mergeContacts.call({survivingId:a.id,duplicateId:b.id},OWNER);
  const [auditBefore]=await db().select().from(auditLog).where(eq(auditLog.subjectId,b.id));
  const request=await createDataRequest.call({contactId:a.id,request:{kind:"erasure"}},OWNER);
  await verifyDataRequest.call({id:request.id,method:"Synthetic held identity"},OWNER);
  await addRetentionException.call({dataRequestId:request.id,scope:"contact.merge_history",reason:"legal_obligation",legalBasis:"Synthetic named retention fixture"},OWNER);
  expect((await fulfillDataRequest.call({id:request.id,confirmation:"ERASE"},OWNER)).request.status).toBe("partially_completed");
  const [operation]=await db().select().from(contactMergeOperations).where(eq(contactMergeOperations.id,merged.mergeOperationId));
  expect(JSON.stringify(operation)).toContain(b.email);
  const [auditAfter]=await db().select().from(auditLog).where(eq(auditLog.id,auditBefore!.id));
  expect(auditAfter).toEqual({...auditBefore,diff:{}});
 });

 it("does not treat a borrowed address during an undone merge as this subject's own history",async()=>{
  const a=await createContact.call({name:"Address-free subject"},OWNER),b=await person("borrowed-address-b");
  const merged=await mergeContacts.call({survivingId:a.id,duplicateId:b.id},OWNER);
  const during=await resolveContact.call({email:b.email!},OWNER);expect(during.contact.id).toBe(a.id);
  await undoContactMerge.call({operationId:merged.mergeOperationId},OWNER);
  expect.soft((await db().transaction(tx=>contactPrivacyIdentity(tx,a.id))).emails).not.toContain(b.email);
  expect.soft(JSON.stringify(await exportSource("contact.audit",a.id))).not.toContain(b.email);
 });
 it("erases shared snapshots hidden behind nested undone merges without erasing separate before-images",async()=>{
  const a=await createContact.call({name:"Nested address-free subject"},OWNER),b=await person("nested-b"),c=await person("nested-c");
  const inner=await mergeContacts.call({survivingId:a.id,duplicateId:b.id},OWNER);
  const outer=await mergeContacts.call({survivingId:c.id,duplicateId:a.id},OWNER);
  await undoContactMerge.call({operationId:outer.mergeOperationId},OWNER);
  await undoContactMerge.call({operationId:inner.mergeOperationId},OWNER);
  await erase(b.id);
  const operations=await db().select().from(contactMergeOperations);
  expect(JSON.stringify(operations)).not.toContain(b.email);
  const outerAfter=operations.find(operation=>operation.id===outer.mergeOperationId)!;
  expect((outerAfter.survivorBefore as {email?:string}).email).toBe(c.email);
 });

 it("keeps pre-merge audit fields distinct from joint fields in one shared transaction",async()=>{
  const a=await createContact.call({name:"Composed address-free subject"},OWNER),b=await person("composed-b");
  const merged=await mergedBatch.call({a:a.id,b:b.id,email:b.email!},OWNER);
  await undoContactMerge.call({operationId:merged.operationId},OWNER);
  const exported=JSON.stringify(await exportSource("contact.audit",a.id));
  expect(exported).toContain("Owned note before the merge");
  expect(exported).not.toContain(b.email);
 });
 it("does not export or retain the separate person's data in shared merge timeline payloads",async()=>{
  const a=await person("timeline-a"),b=await person("timeline-b");
  const merged=await mergeContacts.call({survivingId:a.id,duplicateId:b.id},OWNER);
  await undoContactMerge.call({operationId:merged.mergeOperationId},OWNER);
  expect.soft(JSON.stringify(await exportSource("contact.timeline",a.id))).not.toContain(b.email);
  await erase(b.id);
  expect.soft(JSON.stringify(await db().select().from(timelineEvents))).not.toContain(b.email);
 });

 it("refuses merge, undo and fulfilment while another transaction owns privacy identity",async()=>{
  const a=await person("race-a"),b=await person("race-b"),c=await person("race-c"),d=await person("race-d");
  const merged=await mergeContacts.call({survivingId:a.id,duplicateId:b.id},OWNER);
  const request=await createDataRequest.call({contactId:a.id,request:{kind:"export"}},OWNER);
  await verifyDataRequest.call({id:request.id,method:"Synthetic race identity"},OWNER);
  let ready!:()=>void,release!:()=>void;
  const entered=new Promise<void>(resolve=>{ready=resolve;});
  const resumed=new Promise<void>(resolve=>{release=resolve;});
  const held=db().transaction(async tx=>{await lockContactIdentity(tx);ready();await resumed;});
  await entered;
  try{
   await expect(mergeContacts.call({survivingId:c.id,duplicateId:d.id},OWNER)).rejects.toMatchObject({code:"conflict"});
   await expect(undoContactMerge.call({operationId:merged.mergeOperationId},OWNER)).rejects.toMatchObject({code:"conflict"});
   await expect(fulfillDataRequest.call({id:request.id},OWNER)).rejects.toMatchObject({code:"conflict"});
  }finally{release();await held;}
  expect((await fulfillDataRequest.call({id:request.id},OWNER)).request.status).toBe("completed");
  expect((await mergeContacts.call({survivingId:c.id,duplicateId:d.id},OWNER)).id).toBe(c.id);
 });

});
