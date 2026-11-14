// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C1.12/C11.08: negative pre-dispatch inventory is a first baseline, never
// positive session ancestry, remote quiescence or a substitute for caller FIN.
import {createHash} from "node:crypto";
import type {TransferInventoryConfiguration,TransferInventoryPage} from "../../../scripts/media-transfer.mjs";
import {transferConflict,transferDigest} from "./transfer-proof";
export const MULTIPART_BASELINE_KINDS=["configuration","objects","versions","sessions"]as const;
export type MultipartBaselineKind=typeof MULTIPART_BASELINE_KINDS[number];
export interface MultipartCreateBaselinePage {
 requestId:string;pass:0|1;kind:MultipartBaselineKind;cursorDigest:string;
 nextCursorDigest:string|null;resultDigest:string;count:number;
 configuration?:TransferInventoryConfiguration;
}
export interface MultipartCreateBaseline {
 format:"original-multipart-create-baseline/v1";callId:string;namespace:string;keyDigest:string;
 state:"capturing"|"complete";pages:MultipartCreateBaselinePage[];
}
export const multipartBaselineResultDigest=(result:TransferInventoryConfiguration|TransferInventoryPage)=>createHash("sha256").update(JSON.stringify(result)).digest("hex");
export function newMultipartCreateBaseline(input:{callId:string;namespace:string;keyDigest:string}):MultipartCreateBaseline {
 return{format:"original-multipart-create-baseline/v1",...input,state:"capturing",pages:[]};
}
export function nextMultipartBaselinePage(baseline:MultipartCreateBaseline):{pass:0|1;kind:MultipartBaselineKind;cursorDigest:string}|null {
 for(const pass of [0,1]as const)for(const kind of MULTIPART_BASELINE_KINDS){
  const pages=baseline.pages.filter(page=>page.pass===pass&&page.kind===kind);
  if(!pages.length)return{pass,kind,cursorDigest:transferDigest(null)};
  const last=pages.at(-1)!;if(last.nextCursorDigest)return{pass,kind,cursorDigest:last.nextCursorDigest};
 }
 return null;
}
export function appendMultipartCreateBaseline(baseline:MultipartCreateBaseline,input:MultipartCreateBaselinePage,key:string,result:TransferInventoryConfiguration|TransferInventoryPage):MultipartCreateBaseline {
 const next=nextMultipartBaselinePage(baseline);
 if(baseline.state!=="capturing"||baseline.pages.length>=8000||!next||next.pass!==input.pass||next.kind!==input.kind||next.cursorDigest!==input.cursorDigest||baseline.pages.some(page=>page.requestId===input.requestId)||!input.requestId||input.resultDigest!==multipartBaselineResultDigest(result))transferConflict("Preserve the exact complete original pre-dispatch inventory chain.");
 if(input.kind==="configuration"){
  if(!("versioning"in result)||!["disabled","Enabled","Suspended"].includes(result.versioning)||!Number.isSafeInteger(result.softDeleteSeconds)||result.softDeleteSeconds<0||!Number.isSafeInteger(result.retentionSeconds)||result.retentionSeconds<0||input.nextCursorDigest!==null||input.count!==0||transferDigest(input.configuration)!==transferDigest(result))transferConflict("The original multipart namespace policy is incomplete.");
  const original=baseline.pages.find(page=>page.kind==="configuration");if(original&&transferDigest(original.configuration)!==transferDigest(result))transferConflict("The original multipart namespace policy changed between complete passes.");
 }else{
  if(!("entries"in result)||!Array.isArray(result.entries)||result.entries.length>1000||result.entries.some(entry=>entry.key===key)||input.count!==result.entries.length||input.nextCursorDigest!==(result.next?transferDigest(result.next):null)||input.configuration!==undefined)transferConflict("Existing physical bytes, versions or sessions preserve their original ancestry; do not CREATE another session over them.");
  const kinds=input.kind==="objects"?["object"]:input.kind==="versions"?["version","delete_marker"]:["session"];
  if(result.entries.some(entry=>!kinds.includes(entry.kind)||!entry.key||!Number.isSafeInteger(entry.bytes)||entry.bytes<0)||input.nextCursorDigest&&(!result.entries.length||input.nextCursorDigest===input.cursorDigest||baseline.pages.some(page=>page.pass===input.pass&&page.kind===input.kind&&page.cursorDigest===input.nextCursorDigest)))transferConflict("The complete original multipart inventory has a conflicting page or cursor.");
 }
 return{...baseline,pages:[...baseline.pages,input]};
}
export function finishMultipartCreateBaseline(baseline:MultipartCreateBaseline):MultipartCreateBaseline {
 if(baseline.state!=="capturing"||nextMultipartBaselinePage(baseline)!==null)transferConflict("Both complete original pre-dispatch passes must finish before CREATE.");
 return{...baseline,state:"complete"};
}
