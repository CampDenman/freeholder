// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C1.12/C11.08: pure original-receipt projection, no provider/adoption claim.
import { describe,expect,it } from "vitest";
import type { StorageBinding } from "@/adapters/storage/types";
import type { mediaObjectWrites } from "@/core/media/write-schema";
import { objectKeyDigest } from "@/core/media/write-ledger";
import { storageNamespace } from "@/core/media/storage-quota";
import { checkedTransferBinding,originalTransferObject,transferInventoryDigest } from "@/core/media/transfer-witness";
const key="original/site/immutable.png",date=new Date("2026-11-12T00:00:00Z");
function binding(bucket="source"):StorageBinding{return{kind:"s3",namespace:storageNamespace({id:"s3",endpoint:"https://objects.example.test",bucket}),location:{endpoint:"https://objects.example.test",bucket}};}
function receipt(overrides:Partial<typeof mediaObjectWrites.$inferSelect>={}):typeof mediaObjectWrites.$inferSelect{return{
 id:"00000000-0000-4000-8000-000000000001",operation:"put",key,keyDigest:objectKeyDigest(key),namespace:binding().namespace,storageKind:"s3",storageLocation:binding().location,
 sha256:"a".repeat(64),bytes:5,contentType:"image/png",actor:"user:fixture",contactId:"00000000-0000-4000-8000-000000000010",state:"accepted",observedAcceptedAt:date,reviewedAt:null,reviewedBy:null,evidenceDigest:null,deletedAt:null,redactedAt:null,createdAt:date,updatedAt:date,...overrides};}
describe("original storage transfer evidence",()=>{
 it("projects actual accepted source facts without rebasing either namespace",()=>{
  const row=receipt(),before=structuredClone(row),source=binding();
  const projected=originalTransferObject(source,key,[row]);
  expect(projected).toMatchObject({key,keyDigest:objectKeyDigest(key),sha256:row.sha256,bytes:5,contentType:"image/png",contactIds:[row.contactId]});
  expect(projected.receipts).toHaveLength(1);
  expect(Object.keys(projected.receipts[0]!)).toEqual(["id","witnessDigest"]);
  expect(projected.receipts[0]!.id).toBe(row.id);
  expect(projected.receipts[0]!.witnessDigest).toMatch(/^[a-f0-9]{64}$/);
  expect(row).toEqual(before);expect(source).toEqual(binding());
 });
 it.each(["unverified","started","unknown"] as const)("refuses original %s intent even beside a positive receipt",state=>{
  expect(()=>originalTransferObject(binding(),key,[receipt(),receipt({id:"00000000-0000-4000-8000-000000000002",state})])).toThrow();
 });
 it("refuses erased, absent, retired or missing original facts",()=>{
  for(const rows of [[],[receipt({redactedAt:date})],[receipt({deletedAt:date})],[receipt({state:"confirmed_absent"})]])expect(()=>originalTransferObject(binding(),key,rows)).toThrow();
 });
 it("refuses a receipt from another key, namespace or resource",()=>{
  for(const change of [{key:"replacement.png"},{keyDigest:"b".repeat(64)},{namespace:binding("other").namespace},{storageLocation:binding("other").location}])expect(()=>originalTransferObject(binding(),key,[receipt(change)])).toThrow();
 });
 it("refuses inconsistent live byte, size or type witnesses",()=>{
  for(const change of [{sha256:"b".repeat(64)},{bytes:6},{contentType:"image/jpeg"}])expect(()=>originalTransferObject(binding(),key,[receipt(),receipt({id:"00000000-0000-4000-8000-000000000002",...change})])).toThrow();
 });
 it("refuses duplicate original IDs and unsafe sizes",()=>{
  expect(()=>originalTransferObject(binding(),key,[receipt(),receipt()])).toThrow();
  for(const bytes of [-1,1.5,Number.MAX_SAFE_INTEGER+1])expect(()=>originalTransferObject(binding(),key,[receipt({bytes})])).toThrow();
 });
 it("keeps all original subjects and makes row order irrelevant",()=>{
  const a=receipt(),b=receipt({id:"00000000-0000-4000-8000-000000000002",contactId:"00000000-0000-4000-8000-000000000020"});
  const one=originalTransferObject(binding(),key,[a,b]),two=originalTransferObject(binding(),key,[b,a]);
  expect(one).toEqual(two);expect(one.contactIds).toEqual([a.contactId,b.contactId]);
  expect(originalTransferObject(binding(),key,[a,{...b,contactId:a.contactId}]).receiptSetDigest).not.toBe(one.receiptSetDigest);
 });
 it("binds inventory to the exact target and refuses duplicate keys",()=>{
  const object=originalTransferObject(binding(),key,[receipt()]);
  expect(transferInventoryDigest(binding(),binding("target"),[object])).not.toBe(transferInventoryDigest(binding(),binding("other"),[object]));
  expect(()=>transferInventoryDigest(binding(),binding(),[object])).toThrow();
  expect(()=>transferInventoryDigest(binding(),binding("target"),[object,object])).toThrow();
 });
 it("requires the captured locator and excludes credentials or extra fields",()=>{
  expect(()=>checkedTransferBinding({...binding(),location:binding("other").location})).toThrow();
  expect(()=>checkedTransferBinding({...binding(),location:{...binding().location,token:"fixture-only"}})).toThrow();
  const authenticated=new URL("https://objects.example.test");
  authenticated.username="fixture";authenticated.password="fake";
  const endpoint=authenticated.href;
  expect(()=>checkedTransferBinding({kind:"s3",namespace:storageNamespace({id:"s3",endpoint,bucket:"source"}),location:{endpoint,bucket:"source"}})).toThrow();
 });
 it("returns a validation error for an unsupported local source instead of a server schema exception",()=>{
  let caught:unknown;
  try{checkedTransferBinding({kind:"local",namespace:"a".repeat(64),location:{root:"/synthetic/local"}});}catch(error){caught=error;}
  expect(caught).toMatchObject({code:"validation"});
 });
});
