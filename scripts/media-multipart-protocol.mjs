// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Every actual request is admitted and finished by the original server caller.
// A lost CREATE reply remains debt; inventory cannot invent its session birth.
import {createHash} from 'node:crypto';
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const value=(xml,name)=>xml.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`))?.[1]?.replace(/&(quot|apos|lt|gt|amp);/g,(_,name)=>({quot:'"',apos:"'",lt:'<',gt:'>',amp:'&'})[name]);
const escape=value=>value.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&apos;');
const session=id=>{if(typeof id!=='string'||!id||id.length>4096||/[\u0000-\u001f]/.test(id))throw new Error('storage: invalid original multipart session');return id;};
export function createS3MultipartProtocol({client,binding,url,observer}){
 if(binding.kind!=='s3'||typeof observer!=='function')throw new Error('storage: original multipart request observer required');
 const target=(key,id)=>{const target=new URL(url(key));target.searchParams.set(id===undefined?'uploads':'uploadId',id===undefined?'':session(id));return target;};
 const request=(kind,key,extra,work)=>observer({kind,binding,key,...extra},work);
 const revision=(key,etag,versionId)=>{if(!etag||/[\u0000-\u001f]/.test(etag))throw new Error('storage: actual multipart result lacks original revision');return{kind:'etag',key,namespace:binding.namespace,value:etag,...(versionId?{versionId}:{})};};
 return{
  async create(key,contentType,onAccepted){
   return request('multipart.create',key,{contentType},async(notify,identity)=>{
    if(!identity)throw new Error('storage: original multipart admission token required');
    const response=await client.fetch(target(key),{method:'POST',headers:{'content-type':contentType,'x-amz-meta-freeholder-original-request':identity.id,'x-amz-meta-freeholder-original-token':identity.token}});
    await notify({stage:'response',status:response.status});const xml=await response.text();
    if(!response.ok||/<Error(?:\s|>)/.test(xml)||!/<InitiateMultipartUploadResult(?:\s|>)/.test(xml))throw new Error(`storage: original multipart create failed (${response.status})`);
    const uploadId=session(value(xml,'UploadId'));
    if(value(xml,'Key')!==key)throw new Error('storage: actual multipart create names another original key');
    await notify({stage:'accepted',status:response.status,uploadId});await notify({stage:'session',status:response.status,uploadId});
    await onAccepted?.({uploadId});return{uploadId};
   });
  },
  async inspect(key,id){
   const uploadId=session(id),parts=[];let marker;
   for(let page=0;page<11;page++){
    const current=marker;
    const result=await request('multipart.inspect',key,{uploadId,cursor:current?{partNumber:current}:null},async notify=>{
     const resource=target(key,uploadId);if(current)resource.searchParams.set('part-number-marker',current);
     const response=await client.fetch(resource);await notify({stage:'response',status:response.status});const xml=await response.text();
     if(response.status===404&&value(xml,'Code')==='NoSuchUpload'){await notify({stage:'absence',status:404,uploadId});return{absent:true};}
     if(!response.ok||!/<ListPartsResult(?:\s|>)/.test(xml)||/<Error(?:\s|>)/.test(xml)||value(xml,'Key')!==key||value(xml,'UploadId')!==uploadId)throw new Error('storage: original multipart parts context mismatch');
     const entries=[];
     for(const match of xml.matchAll(/<Part>([\s\S]*?)<\/Part>/g)){
      const partNumber=Number(value(match[1],'PartNumber')),etag=value(match[1],'ETag'),bytes=Number(value(match[1],'Size'));
      if(!Number.isInteger(partNumber)||partNumber<1||partNumber>10000||!etag||!Number.isSafeInteger(bytes)||bytes<0||entries.some(part=>part.partNumber===partNumber))throw new Error('storage: invalid original multipart part inventory');
      entries.push({partNumber,etag,bytes});
     }
     const truncated=value(xml,'IsTruncated');if(!['true','false'].includes(truncated))throw new Error('storage: multipart inventory termination missing');
     const next=truncated==='true'?value(xml,'NextPartNumberMarker'):undefined;
     if(truncated==='true'&&(!next||!/^\d+$/.test(next)||Number(next)<=Number(current??0)))throw new Error('storage: incomplete original multipart part inventory');
     await notify({stage:'inventory',status:response.status,count:entries.length,uploadId,detailDigest:digest({parts:entries,next:next??null})});
     return{entries,next};
    });
    if(result.absent){if(parts.length)throw new Error('storage: multipart session disappeared during inventory');return{state:'absent'};}
    if(result.entries.some(part=>parts.some(old=>old.partNumber===part.partNumber)))throw new Error('storage: repeated original multipart part');
    parts.push(...result.entries);if(!result.next)return{state:'open',parts};marker=result.next;
   }
   throw new Error('storage: original multipart inventory exceeds supported bound');
  },
  async complete(key,id,parts,onAccepted){
   const uploadId=session(id),manifest=parts.map(({partNumber,etag})=>({partNumber,etag}));
   if(!manifest.length||manifest.length>10000||manifest.some((part,index)=>part.partNumber!==index+1||typeof part.etag!=='string'||!part.etag||/[\u0000-\u001f]/.test(part.etag)))throw new Error('storage: exact ordered original multipart manifest required');
   const original=await request('multipart.complete',key,{uploadId,partsDigest:digest(manifest),createOnly:true},async notify=>{
    const body=`<CompleteMultipartUpload>${manifest.map(part=>`<Part><PartNumber>${part.partNumber}</PartNumber><ETag>${escape(part.etag)}</ETag></Part>`).join('')}</CompleteMultipartUpload>`;
    const response=await client.fetch(target(key,uploadId),{method:'POST',headers:{'content-type':'application/xml','if-none-match':'*'},body});
    await notify({stage:'response',status:response.status});const xml=await response.text();
    if(!response.ok||/<Error(?:\s|>)/.test(xml)||!/<CompleteMultipartUploadResult(?:\s|>)/.test(xml)||value(xml,'Key')!==key)throw new Error(`storage: original multipart complete failed (${response.status})`);
    const original=revision(key,value(xml,'ETag'),response.headers.get('x-amz-version-id'));
    await notify({stage:'accepted',status:response.status,uploadId});await notify({stage:'metadata',status:response.status,revision:original,uploadId});
    await onAccepted?.({uploadId,revision:original});return original;
   });
   return request('object.metadata',key,{expectedRevision:original},async notify=>{
    const resource=new URL(url(key));if(original.versionId)resource.searchParams.set('versionId',original.versionId);
    const response=await client.fetch(resource,{method:'HEAD',headers:{'if-match':original.value}});await notify({stage:'response',status:response.status});
    const bytes=Number(response.headers.get('content-length'));
    if(!response.ok||response.headers.get('etag')!==original.value||original.versionId&&response.headers.get('x-amz-version-id')!==original.versionId||response.headers.get('content-length')===null||!Number.isSafeInteger(bytes)||bytes<0)throw new Error('storage: completed original multipart revision changed or is unavailable');
    await notify({stage:'metadata',status:response.status,revision:original,bytes});
    return{key,bytes,contentType:response.headers.get('content-type')??'application/octet-stream',etag:original.value};
   });
  },
  async abort(key,id,onAccepted){
   const uploadId=session(id);
   return request('multipart.abort',key,{uploadId},async notify=>{
    const response=await client.fetch(target(key,uploadId),{method:'DELETE'});await notify({stage:'response',status:response.status});const xml=await response.text();
    if(!response.ok&&!(response.status===404&&value(xml,'Code')==='NoSuchUpload'))throw new Error(`storage: original multipart abort failed (${response.status})`);
    await notify({stage:'accepted',status:response.status,uploadId});await onAccepted?.({uploadId});
   });
  },
 };
}
