// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Every actual request is admitted and finished by the original server caller.
// A lost CREATE reply remains debt; inventory cannot invent its session birth.
import {createHash} from 'node:crypto';
import {readOriginalStorageXml,storageXmlRecord,storageXmlText,storageXmlRows,storageXmlHasError} from './media-storage-xml.mjs';
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const escape=value=>value.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&apos;');
const objectKey=key=>{if(typeof key!=='string'||!key||key.length>2048||/[\u0000-\u001f\u007f]/.test(key)||key.split('/').some(part=>part==='.'||part==='..'))throw Error('storage: invalid original multipart object key');return key;};
const session=id=>{if(typeof id!=='string'||!id||id.length>4096||/[\u0000-\u001f\u007f]/.test(id))throw new Error('storage: invalid original multipart session');return id;};
const checksum=value=>{if(typeof value!=='string'||!(/^[A-Za-z0-9+/]{43}=$/.test(value))||Buffer.from(value,'base64').length!==32||Buffer.from(value,'base64').toString('base64')!==value)throw Error('storage: exact original SHA256 part checksum required');return value;};
const exactManifest=(parts,required)=>{const manifest=parts.map(({partNumber,etag,bytes,checksumSha256})=>({partNumber,etag,...(bytes===undefined?{}:{bytes}),...(checksumSha256===undefined?{}:{checksumSha256:checksum(checksumSha256)})}));if(!manifest.length||manifest.length>10000||manifest.some((part,index)=>part.partNumber!==index+1||typeof part.etag!=='string'||!part.etag||/[\u0000-\u001f\u007f]/.test(part.etag)||part.bytes!==undefined&&(!Number.isSafeInteger(part.bytes)||part.bytes<=0)||required&&(part.bytes===undefined||part.checksumSha256===undefined)))throw Error('storage: exact ordered original multipart manifest required');return manifest;};
const size=value=>{if(typeof value!=='string'||!/^(0|[1-9][0-9]*)$/.test(value)||BigInt(value)>BigInt(Number.MAX_SAFE_INTEGER))throw Error('storage: invalid original multipart byte count');return Number(value);};
export function createS3MultipartProtocol({client,binding,url,observer,retainXmlEvidence=false,requirePartChecksums=false}){
 if(binding.kind!=='s3'||typeof observer!=='function')throw new Error('storage: original multipart request observer required');
 const target=(key,id)=>{objectKey(key);const target=new URL(url(key));target.searchParams.set(id===undefined?'uploads':'uploadId',id===undefined?'':session(id));return target;};
 const request=(kind,key,extra,work)=>observer({kind,binding,key,...extra},work);
 const read=(response,notify,allowEmpty=false)=>readOriginalStorageXml(response,retainXmlEvidence?notify:undefined,{allowEmpty});
 const context=(document,name,key,uploadId)=>{
  if(storageXmlHasError(document))throw Error('storage: original multipart response contains a provider error');
  const root=storageXmlRecord(document,name);
  if(storageXmlText(root,'Key')!==key||root.Bucket!==undefined&&storageXmlText(root,'Bucket')!==binding.location.bucket||uploadId!==undefined&&storageXmlText(root,'UploadId')!==uploadId)throw Error('storage: original multipart parts context mismatch');
  return root;
 };
 const missingUpload=document=>Boolean(document?.Error&&storageXmlText(storageXmlRecord(document,'Error'),'Code')==='NoSuchUpload');
 const revision=(key,etag,versionId)=>{if(typeof etag!=='string'||!/^"[^"\u0000-\u0020\u007f]+"$/.test(etag))throw new Error('storage: actual multipart result lacks original revision');return{kind:'etag',key,namespace:binding.namespace,value:etag,...(versionId?{versionId:session(versionId)}:{})};};
 return{
  async create(key,contentType,onAccepted){
   return request('multipart.create',key,{contentType,...(requirePartChecksums?{checksumAlgorithm:'SHA256',checksumType:'COMPOSITE'}:{})},async(notify,identity)=>{
    if(!identity||!/^([a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12})$/i.test(identity.id)||typeof identity.token!=='string'||identity.token.length<36||identity.token.length>200||/[\u0000-\u001f\u007f]/.test(identity.token))throw new Error('storage: original multipart admission token required');
    const response=await client.fetch(target(key),{method:'POST',redirect:'error',headers:{'content-type':contentType,'x-amz-meta-freeholder-original-request':identity.id,'x-amz-meta-freeholder-original-token':identity.token,...(requirePartChecksums?{'x-amz-checksum-algorithm':'SHA256','x-amz-checksum-type':'COMPOSITE'}:{})}});
    await notify({stage:'response',status:response.status});const document=await read(response,notify);
    if(!response.ok||storageXmlHasError(document)||!document?.InitiateMultipartUploadResult)throw new Error(`storage: original multipart create failed (${response.status})`);
    const root=storageXmlRecord(document,'InitiateMultipartUploadResult'),uploadId=session(storageXmlText(root,'UploadId'));
    if(storageXmlText(root,'Key')!==key||root.Bucket!==undefined&&storageXmlText(root,'Bucket')!==binding.location.bucket)throw new Error('storage: actual multipart create names another original key or bucket');
    await notify({stage:'accepted',status:response.status,uploadId});await notify({stage:'session',status:response.status,uploadId});
    await onAccepted?.({uploadId});return{uploadId};
   });
  },
  async inspect(key,id,expectedParts){
   const uploadId=session(id),parts=[],expected=expectedParts===undefined?undefined:exactManifest(expectedParts,true),pages=[];let marker;
   for(let page=0;page<11;page++){
    const current=marker;
    const result=await request('multipart.inspect',key,{uploadId,cursor:current?{partNumber:current}:null,...(expected?{partsDigest:digest(expected)}:{})},async(notify,identity)=>{
     if(expected&&!identity?.id)throw Error('storage: original part verification requires actual physical page identity');
     const resource=target(key,uploadId);if(current)resource.searchParams.set('part-number-marker',current);
     const response=await client.fetch(resource,{redirect:'error'});await notify({stage:'response',status:response.status});const document=await read(response,notify,true);
     if(response.status===404&&missingUpload(document)){await notify({stage:'absence',status:404,uploadId});return{absent:true};}
     if(!response.ok||!document?.ListPartsResult||storageXmlHasError(document))throw new Error('storage: original multipart parts context mismatch');
     const root=context(document,'ListPartsResult',key,uploadId),entries=[];
     for(const row of storageXmlRows(root.Part)){
      const partNumber=size(storageXmlText(row,'PartNumber')),etag=storageXmlText(row,'ETag'),bytes=size(storageXmlText(row,'Size'));
      if(partNumber<1||partNumber>10000||!etag||/[\u0000-\u001f\u007f]/.test(etag)||entries.some(part=>part.partNumber>=partNumber)||partNumber<=Number(current??0))throw new Error('storage: invalid original multipart part inventory');
      const actualChecksum=row.ChecksumSHA256===undefined?undefined:checksum(storageXmlText(row,'ChecksumSHA256'));
      if(requirePartChecksums&&actualChecksum===undefined)throw Error('storage: original provider part checksum is missing');
      entries.push({partNumber,etag,bytes,...(actualChecksum===undefined?{}:{checksumSha256:actualChecksum})});
     }
     if(entries.length>1000)throw Error('storage: invalid original multipart part inventory');
     const truncated=storageXmlText(root,'IsTruncated');if(!['true','false'].includes(truncated))throw new Error('storage: multipart inventory termination missing');
     const next=truncated==='true'?storageXmlText(root,'NextPartNumberMarker'):undefined;
     if(truncated==='true'&&(!next||!/^\d+$/.test(next)||Number(next)<=Number(current??0)||!entries.length||Number(next)<entries.at(-1).partNumber)||truncated==='false'&&root.NextPartNumberMarker!==undefined)throw new Error('storage: incomplete original multipart part inventory');
     if(expected){for(let index=0;index<entries.length;index++){const actual=entries[index],intent=expected[parts.length+index];if(!intent||JSON.stringify(actual)!==JSON.stringify(intent))throw Error('storage: provider parts differ from the exact original declared manifest');}
      if(!next&&parts.length+entries.length!==expected.length)throw Error('storage: original provider part manifest is incomplete');}
     await notify({stage:'inventory',status:response.status,count:entries.length,uploadId,detailDigest:digest({parts:entries,next:next??null})});
     if(expected){pages.push(identity.id);if(!next)await notify({stage:'parts_verified',status:response.status,count:expected.length,uploadId,detailDigest:digest(expected),partPageIds:[...pages]});}
     return{entries,next};
    });
    if(result.absent){if(parts.length)throw new Error('storage: multipart session disappeared during inventory');return{state:'absent'};}
    if(result.entries.some(part=>parts.some(old=>old.partNumber===part.partNumber)))throw new Error('storage: repeated original multipart part');
    parts.push(...result.entries);if(!result.next)return{state:'open',parts};marker=result.next;
   }
   throw new Error('storage: original multipart inventory exceeds supported bound');
  },
  async complete(key,id,parts,onAccepted){
   const uploadId=session(id),manifest=exactManifest(parts,requirePartChecksums);
   const original=await request('multipart.complete',key,{uploadId,partsDigest:digest(manifest),createOnly:true},async notify=>{
    const body=`<CompleteMultipartUpload>${manifest.map(part=>`<Part><PartNumber>${part.partNumber}</PartNumber><ETag>${escape(part.etag)}</ETag>${part.checksumSha256===undefined?'':`<ChecksumSHA256>${part.checksumSha256}</ChecksumSHA256>`}</Part>`).join('')}</CompleteMultipartUpload>`;
    const response=await client.fetch(target(key,uploadId),{method:'POST',redirect:'error',headers:{'content-type':'application/xml','if-none-match':'*',...(requirePartChecksums?{'x-amz-checksum-type':'COMPOSITE'}:{})},body});
    await notify({stage:'response',status:response.status});const document=await read(response,notify);
    if(!response.ok||storageXmlHasError(document)||!document?.CompleteMultipartUploadResult)throw new Error(`storage: original multipart complete failed (${response.status})`);
    const root=context(document,'CompleteMultipartUploadResult',key),original=revision(key,storageXmlText(root,'ETag'),response.headers.get('x-amz-version-id'));
    await notify({stage:'accepted',status:response.status,uploadId});await notify({stage:'metadata',status:response.status,revision:original,uploadId});
    await onAccepted?.({uploadId,revision:original});return original;
   });
   return request('object.metadata',key,{expectedRevision:original},async notify=>{
    const resource=new URL(url(key));if(original.versionId)resource.searchParams.set('versionId',original.versionId);
    const response=await client.fetch(resource,{method:'HEAD',redirect:'error',headers:{'if-match':original.value}});await notify({stage:'response',status:response.status});
    const length=response.headers.get('content-length'),bytes=length===null?NaN:size(length);
    if(!response.ok||response.headers.get('etag')!==original.value||original.versionId&&response.headers.get('x-amz-version-id')!==original.versionId||!Number.isSafeInteger(bytes))throw new Error('storage: completed original multipart revision changed or is unavailable');
    await notify({stage:'metadata',status:response.status,revision:original,bytes});
    return{key,bytes,contentType:response.headers.get('content-type')??'application/octet-stream',etag:original.value};
   });
  },
  async abort(key,id,onAccepted){
   const uploadId=session(id);
   return request('multipart.abort',key,{uploadId},async notify=>{
    const response=await client.fetch(target(key,uploadId),{method:'DELETE',redirect:'error'});await notify({stage:'response',status:response.status});const document=await read(response,notify,true);
    if(response.status===404&&missingUpload(document)){await notify({stage:'absence',status:404,uploadId});return;}
    if(!response.ok||document!==null)throw new Error(`storage: original multipart abort failed (${response.status})`);
    await notify({stage:'accepted',status:response.status,uploadId});await onAccepted?.({uploadId});
   });
  },
 };
}
