// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C1.12/C11.08: enumeration is observation, never inferred original ownership.
import type {TransferInventoryConfiguration,TransferInventoryEntry,TransferInventoryPage,TransferRevision} from "../../../scripts/media-transfer.mjs";
import {transferConflict,transferDigest} from "./transfer-proof";
export function sameProviderRevision(a:TransferRevision|undefined|null,b:TransferRevision|undefined|null,configuration:TransferInventoryConfiguration):boolean{
 if(!a||!b||a.kind!==b.kind||a.key!==b.key||a.namespace!==b.namespace||a.value!==b.value)return false;
 const version=(value:string|undefined)=>configuration.versioning==="disabled"&&(value===undefined||value==="null")?null:value;
 return version(a.versionId)===version(b.versionId);
}
export function inventoryResourceDigest(entry:TransferInventoryEntry):string{
 const identity=entry.kind==="session"?{sessionId:entry.sessionId}:entry.kind==="delete_marker"?{versionId:entry.versionId}:entry.kind==="object"?{current:true}:entry.revision?.kind==="generation"?{generation:entry.revision.value}:{versionId:entry.revision?.versionId};
 return transferDigest({kind:entry.kind,key:entry.key,namespace:entry.revision?.namespace??null,identity});
}
export function currentProviderObjects(configuration:TransferInventoryConfiguration,entries:readonly TransferInventoryEntry[]){
 return entries.filter(row=>row.kind==="object").map(row=>{
  if(!row.revision||row.revision.key!==row.key)transferConflict("The current object has no exact original revision.");
  if(row.revision.kind!=="etag"||configuration.versioning==="disabled")return row;
  const latest=entries.filter(value=>value.kind==="version"&&value.key===row.key&&value.current);
  if(latest.length!==1||!latest[0]?.revision?.versionId||latest[0].revision.value!==row.revision.value||latest[0].revision.namespace!==row.revision.namespace)transferConflict("The current source version cannot be joined to its actual version listing.");
  return{...row,revision:latest[0].revision};
 });
}
export function physicalInventoryBytes(configuration:TransferInventoryConfiguration,entries:readonly TransferInventoryEntry[]):number{
 const current=currentProviderObjects(configuration,entries),resources=new Map<string,number>();
 for(const entry of [...current,...entries.filter(row=>row.kind!=="object")]){
  if(!entry.revision||entry.kind==="session"||entry.kind==="delete_marker")continue;
  const version=entry.revision.kind==="generation"?entry.revision.value:entry.revision.versionId??"null";
  const identity=transferDigest({namespace:entry.revision.namespace,key:entry.key,version});
  const previous=resources.get(identity);if(previous!==undefined&&previous!==entry.bytes)transferConflict("The original provider reports conflicting byte sizes for one physical version.");resources.set(identity,entry.bytes);
 }
 const total=[...resources.values()].reduce((sum,value)=>sum+BigInt(value),0n);if(total>BigInt(Number.MAX_SAFE_INTEGER))transferConflict("The full original physical inventory exceeds exact byte accounting.");return Number(total);
}
export function providerInventoryDigest(configuration:TransferInventoryConfiguration,entries:readonly TransferInventoryEntry[]):string{
 const keys=entries.map(inventoryResourceDigest);if(new Set(keys).size!==keys.length)transferConflict("The original provider repeated an inventory resource.");
 return transferDigest({configuration,entries:[...entries].sort((a,b)=>inventoryResourceDigest(a)<inventoryResourceDigest(b)?-1:1)});
}
export function requireCompletePages(pages:readonly {cursor:Record<string,string>|null;next:Record<string,string>|null;page:TransferInventoryPage}[]):void{
 let expected:Record<string,string>|null=null;const seen=new Set<string>();
 for(const row of pages){const cursor=transferDigest(row.cursor);if(cursor!==transferDigest(expected)||seen.has(cursor))transferConflict("The complete original provider page chain is missing, repeated or out of order.");seen.add(cursor);if(transferDigest(row.next)!==transferDigest(row.page.next))transferConflict();expected=row.next;}
 if(!pages.length||expected!==null)transferConflict("The original provider inventory is still truncated.");
}
export function classifySourceInventory(configuration:TransferInventoryConfiguration,entries:readonly TransferInventoryEntry[],objects:readonly {id:string;key:string;bytes:number;originalRevision?:TransferRevision|null}[],namespace:string){
 const current=currentProviderObjects(configuration,entries),byKey=new Map(current.map(row=>[row.key,row]));
 if(current.some(row=>row.revision?.namespace!==namespace)||byKey.size!==current.length)return{complete:false,reason:"duplicate_current_object" as const};
 if(current.length!==objects.length||objects.some(object=>byKey.get(object.key)?.bytes!==object.bytes))return{complete:false,reason:"unattributed_or_missing_object" as const};
 if(objects.some(object=>!sameProviderRevision(object.originalRevision,byKey.get(object.key)?.revision,configuration)))return{complete:false,reason:"unproven_original_provider_revision" as const};
 for(const entry of entries){
  const object=objects.find(row=>row.key===entry.key),live=byKey.get(entry.key);
  if(!object||entry.kind==="session"||entry.kind==="retained"||entry.kind==="delete_marker")return{complete:false,reason:"unattributed_version_or_session" as const};
  if(entry.kind==="version"&&(!live||!sameProviderRevision(entry.revision,live.revision,configuration)))return{complete:false,reason:"unattributed_historical_version" as const};
 }
 if(configuration.versioning!=="disabled"&&current.some(row=>row.revision?.kind==="etag"&&!row.revision.versionId))return{complete:false,reason:"missing_exact_current_version" as const};
 return{complete:true,reason:null};
}
export function originalResourceAbsent(entries:readonly TransferInventoryEntry[],key:string):boolean{return!entries.some(entry=>entry.key===key);}
