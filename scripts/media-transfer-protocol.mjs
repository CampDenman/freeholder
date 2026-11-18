// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C1.12/C11.08: explicit physical requests; no hidden resumable session/retry.
import {createHash} from "node:crypto";
import {createS3MultipartProtocol} from "./media-multipart-protocol.mjs";
import {originalMultipartReadback} from "./media-multipart-readback.mjs";
import {readOriginalStorageXml} from "./media-storage-xml.mjs";
const MAX_PAGE=250;
const digest=value=>createHash("sha256").update(typeof value==="string"||value instanceof Uint8Array?value:JSON.stringify(value)).digest("hex");
const httpStatus=value=>/^([1-5][0-9]{2})$/.test(String(value))?Number(value):null;
// Every refusal names WHICH check refused. 47 call sites shared one message,
// so a refused demo seed in the replit recipe gate reported only "The exact
// original provider inventory or request result is incomplete." and named no
// field, no provider response and no stage -- the same shape of blindness that
// cost three CI runs on the migration boundary. The reason is a fixed token
// authored here, never a provider value, a key, a URL or a response body, and
// the code lets the readiness discriminator name it without the message.
const failure=reason=>{throw Object.assign(new Error(`The exact original provider inventory or request result is incomplete: ${reason}.`),{code:"FH_STORAGE_PROTOCOL_REFUSED",reason});};
function objectKey(key){if(typeof key!=="string"||!key||key.length>2048||/[\u0000-\u001f\u007f]/.test(key)||key.split("/").some(part=>part==="."||part===".."))failure("object_key");return key;}
function size(value){if(typeof value!=="string"||! /^(0|[1-9][0-9]*)$/.test(value)||BigInt(value)>BigInt(Number.MAX_SAFE_INTEGER))failure("byte_count");return Number(value);}
function opaque(value){if(typeof value!=="string"||!value||value.length>4096||/[\u0000-\u001f\u007f]/.test(value))failure("opaque_token");return value;}
function entities(value){if(typeof value!=="string")failure("xml_text");return value;}
function revision(binding,key,value,versionId){
 objectKey(key);if(binding.kind!=="s3"&&versionId!==undefined)failure("revision_shape");if(typeof value!=="string"||(binding.kind==="s3"?!/^"[\x21\x23-\x7e\x80-\xff]+"$/.test(value):!/^[1-9][0-9]{0,19}$/.test(value)))failure("revision_shape");
 return{kind:binding.kind==="s3"?"etag":"generation",key,namespace:binding.namespace,value,...(versionId!==undefined?{versionId:opaque(versionId)}:{})};
}
function exactRevision(input,binding,key){const checked=revision(binding,key,input?.value,input?.versionId);if(input?.kind!==checked.kind||input?.namespace!==checked.namespace||input?.key!==key)failure("revision_identity");return checked;}
function originalRequestProof(id,token){
 if(id===undefined&&token===undefined)return undefined;
 if(typeof id!=="string"||!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)||typeof token!=="string"||token.length<36||token.length>200||/[\u0000-\u001f\u007f]/.test(token))failure("request_proof");
 return{id,tokenDigest:createHash("sha256").update("freeholder:verified-storage-transfer:v1\0").update(JSON.stringify(token)).digest("hex")};
}
function originalRequestHeaders(identity){return identity?{"x-amz-meta-freeholder-original-request":identity.id,"x-amz-meta-freeholder-original-token":identity.token}:{};}
async function observed(observer,descriptor,operation){return observer?observer(descriptor,operation):operation(async()=>{});}
function expectedBytes(value){if(!Number.isSafeInteger(value)||value<0)failure("expected_bytes");return value;}
function joined(chunks,bytes){const body=new Uint8Array(bytes);let offset=0;for(const chunk of chunks){body.set(chunk,offset);offset+=chunk.byteLength;}return body;}
export async function readS3ObjectBody(response,expected){
 const header=response.headers.get("content-length"),declared=header===null?undefined:size(header),bound=expected===undefined?declared:expectedBytes(expected);if(bound===undefined||(declared!==undefined&&declared!==bound))failure("body_length_header");
 if(!response.body){if(bound===0)return new Uint8Array();failure("body_absent");}
 const reader=response.body.getReader(),chunks=[];let bytes=0;
 try{for(;;){const item=await reader.read();if(item.done)break;const remaining=bound+1-bytes,chunk=item.value.byteLength>remaining?item.value.subarray(0,remaining):item.value;chunks.push(chunk);bytes+=chunk.byteLength;if(bytes>bound)break;}}finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
 if(bytes!==bound)failure("body_length_mismatch");return joined(chunks,bytes);
}
function awsS3Host(hostname){return /(?:^|\.)s3(?:[.-](?:dualstack\.)?[a-z0-9-]+)?\.amazonaws\.com$/.test(hostname);}
function s3ConditionalAuthority(binding,url,key){
 let endpoint,target;try{endpoint=new URL(typeof binding.location.endpoint==="string"?binding.location.endpoint:url(key));target=new URL(url(key));}catch{failure("endpoint_url");}
 return awsS3Host(endpoint.hostname)&&awsS3Host(target.hostname);
}
export function requireS3ConditionalAuthority(binding,url,key,versionId){
 // Other S3-compatible providers stay fail-closed for CREATE and current-key
 // DELETE until their actual conditional semantics pass provider acceptance.
 if(versionId===undefined&&!s3ConditionalAuthority(binding,url,key))failure("conditional_authority");
}
export async function readReplitObjectBody(file,expected){
 const bound=expectedBytes(expected),stream=file.createReadStream({validation:false,decompress:false,...(bound>0?{start:0,end:bound}:{})}),chunks=[];let bytes=0;
 try{for await(const value of stream){if(!(value instanceof Uint8Array))failure("stream_chunk");const remaining=bound+1-bytes,chunk=value.byteLength>remaining?value.subarray(0,remaining):value;chunks.push(chunk);bytes+=chunk.byteLength;if(bytes>bound)break;}}finally{stream.destroy();}
 return joined(chunks,bytes);
}
async function xml(response,notify){
 return readOriginalStorageXml(response,notify,{stage:"inventory_raw",requireSuccess:true});
}
function root(document,name,bucket){const value=document[name];if(!value||typeof value!=="object"||Array.isArray(value)||entities(value.Name??value.Bucket)!==bucket)failure("list_root");return value;}
function rows(value){return value===undefined?[]:Array.isArray(value)?value:[value];}
function objectEntry(binding,key,bytes,rev,kind="object",current=true){return{kind,key:objectKey(key),bytes,revision:rev,current};}
function parsedS3Page(document,kind,binding,cursor){
 const bucket=binding.location.bucket,value=root(document,kind==="objects"?"ListBucketResult":kind==="sessions"?"ListMultipartUploadsResult":"ListVersionsResult",bucket);
 if(value.EncodingType!=="url"||!["true","false"].includes(value.IsTruncated))failure("list_encoding_or_truncation");
 const entries=[];
 if(kind==="objects"){
  for(const row of rows(value.Contents)){const key=objectKey(decodeURIComponent(entities(row.Key)));entries.push(objectEntry(binding,key,size(row.Size),revision(binding,key,entities(row.ETag))));}
  if(size(value.KeyCount)!==entries.length||entries.length>MAX_PAGE)failure("list_key_count");
 }else if(kind==="versions"){
  for(const row of rows(value.Version)){const key=objectKey(decodeURIComponent(entities(row.Key))),versionId=entities(row.VersionId);if(!["true","false"].includes(row.IsLatest))failure("version_is_latest");entries.push(objectEntry(binding,key,size(row.Size),revision(binding,key,entities(row.ETag),versionId==="null"?undefined:versionId),"version",row.IsLatest==="true"));}
  for(const row of rows(value.DeleteMarker)){const key=objectKey(decodeURIComponent(entities(row.Key)));if(!["true","false"].includes(row.IsLatest))failure("delete_marker_is_latest");entries.push({kind:"delete_marker",key,bytes:0,versionId:opaque(entities(row.VersionId)),current:row.IsLatest==="true"});}
 }else{
  for(const row of rows(value.Upload)){const key=objectKey(decodeURIComponent(entities(row.Key)));entries.push({kind:"session",key,bytes:0,sessionId:opaque(entities(row.UploadId)),current:false});}
 }
 if(entries.length>MAX_PAGE)failure("page_entry_count");
 let next=null;
 if(value.IsTruncated==="true"){
  if(!entries.length)failure("page_entries_empty");
  next=kind==="objects"?{token:opaque(entities(value.NextContinuationToken))}:kind==="versions"?{key:objectKey(decodeURIComponent(entities(value.NextKeyMarker))),version:opaque(entities(value.NextVersionIdMarker))}:{key:objectKey(decodeURIComponent(entities(value.NextKeyMarker))),upload:opaque(entities(value.NextUploadIdMarker))};
  if(JSON.stringify(next)===JSON.stringify(cursor))failure("page_cursor_repeat");
 }else if(value.NextContinuationToken||value.NextVersionIdMarker||value.NextUploadIdMarker)failure("page_cursor_unexpected");
 return{entries,next};
}
export function createS3TransferProtocol({client,url,binding,observer}){
 const bucketUrl=new URL(url("__freeholder_inventory__"));bucketUrl.pathname=bucketUrl.pathname.slice(0,bucketUrl.pathname.lastIndexOf("/"));
 async function readVersioned(key,expected,expectedObjectBytes){objectKey(key);if(expectedObjectBytes!==undefined)expectedBytes(expectedObjectBytes);const pinned=expected?exactRevision(expected,binding,key):undefined,target=new URL(url(key));if(pinned?.versionId!==undefined)target.searchParams.set("versionId",pinned.versionId);return observed(observer,{kind:"object.read",binding,key,...(pinned?{expectedRevision:pinned}:{}),...(expectedObjectBytes!==undefined?{bytes:expectedObjectBytes}:{})},async notify=>{
  const response=await client.fetch(target,{redirect:"error",headers:{"accept-encoding":"identity",...(pinned?{"if-match":pinned.value}:{})}});
  await notify({stage:"response",status:response.status,detailDigest:digest({etag:response.headers.get("etag"),versionId:response.headers.get("x-amz-version-id"),bytes:response.headers.get("content-length")})});
  if(response.status===404){await notify({stage:"absence",status:404});return undefined;}if(!response.ok)failure("head_response");
  const rev=revision(binding,key,response.headers.get("etag"),response.headers.get("x-amz-version-id")??undefined),requestProof=originalRequestProof(response.headers.get("x-amz-meta-freeholder-original-request")??undefined,response.headers.get("x-amz-meta-freeholder-original-token")??undefined);
  await notify({stage:"metadata",status:response.status,revision:rev,...(requestProof?{requestProof}:{})});const body=await readS3ObjectBody(response,expectedObjectBytes);
  await notify({stage:"body",status:response.status,revision:rev,sha256:digest(body),bytes:body.byteLength});return{body,contentType:response.headers.get("content-type")??"application/octet-stream",revision:rev,...(requestProof?{requestProof}:{})};
 });}
 return{binding,readVersioned,
  async inspectMultipart(key,uploadId){if(!observer||binding.kind!=="s3")failure("multipart_unsupported");return createS3MultipartProtocol({client,binding,url,observer,retainXmlEvidence:true,requirePartChecksums:true}).inspect(key,uploadId);},
  async metadataVersioned(key,input){
   objectKey(key);const pinned=input?exactRevision(input,binding,key):undefined,target=new URL(url(key));if(pinned?.versionId!==undefined)target.searchParams.set("versionId",pinned.versionId);
   return observed(observer,{kind:"object.metadata",binding,key,...(pinned?{expectedRevision:pinned}:{})},async notify=>{
    const response=await client.fetch(target,{method:"HEAD",redirect:"error",headers:{"accept-encoding":"identity",...(pinned?{"if-match":pinned.value}:{})}});await notify({stage:"response",status:response.status});
    if(response.status===404){await notify({stage:"absence",status:404});return undefined;}if(!response.ok)failure("read_response");
    const actual=revision(binding,key,response.headers.get("etag"),response.headers.get("x-amz-version-id")??undefined);if(pinned&&JSON.stringify(actual)!==JSON.stringify(pinned))failure("read_revision_mismatch");
    const bytes=size(response.headers.get("content-length")),requestProof=originalRequestProof(response.headers.get("x-amz-meta-freeholder-original-request")??undefined,response.headers.get("x-amz-meta-freeholder-original-token")??undefined);
    await notify({stage:"metadata",status:response.status,revision:actual,bytes,...(requestProof?{requestProof}:{})});return{revision:actual,bytes,contentType:response.headers.get("content-type")??"application/octet-stream",...(requestProof?{requestProof}:{})};
   });
  },
  async readDigestVersioned(key,input,maxBytes,originalParts){
   const partReadback=originalParts===undefined?undefined:originalMultipartReadback(originalParts,maxBytes);
   const pinned=exactRevision(input,binding,key);if(!Number.isSafeInteger(maxBytes)||maxBytes<0)failure("read_max_bytes");const target=new URL(url(key));if(pinned.versionId!==undefined)target.searchParams.set("versionId",pinned.versionId);
   return observed(observer,{kind:"object.read",binding,key,expectedRevision:pinned,bytes:maxBytes,...(partReadback?{partsDigest:partReadback.partsDigest}:{})},async notify=>{
    const response=await client.fetch(target,{redirect:"error",headers:{"accept-encoding":"identity","if-match":pinned.value}});await notify({stage:"response",status:response.status});
    if(response.status===404){await notify({stage:"absence",status:404});return undefined;}if(!response.ok)failure("stream_response");
    const original=revision(binding,key,response.headers.get("etag"),response.headers.get("x-amz-version-id")??undefined);if(JSON.stringify(original)!==JSON.stringify(pinned))failure("stream_revision_mismatch");
    const requestProof=originalRequestProof(response.headers.get("x-amz-meta-freeholder-original-request")??undefined,response.headers.get("x-amz-meta-freeholder-original-token")??undefined);
    await notify({stage:"metadata",status:response.status,revision:original,...(requestProof?{requestProof}:{})});
    const hash=createHash("sha256");let bytes=0;if(response.body){const reader=response.body.getReader();try{for(;;){const item=await reader.read();if(item.done)break;bytes+=item.value.byteLength;if(bytes>maxBytes)failure("stream_body");partReadback?.update(item.value);hash.update(item.value);}}finally{await reader.cancel().catch(()=>{});reader.releaseLock();}}
    const verifiedParts=partReadback?.finish(),sha256=hash.digest("hex");await notify({stage:"body",status:response.status,revision:original,sha256,bytes,...(verifiedParts?{partsDigest:verifiedParts.partsDigest}:{})});return{sha256,bytes,...(verifiedParts?{partsDigest:verifiedParts.partsDigest}:{}),contentType:response.headers.get("content-type")??"application/octet-stream",revision:original,...(requestProof?{requestProof}:{})};
   });
  },
  async get(key){return(await readVersioned(key))?.body;},
  async put(key,body,contentType){objectKey(key);return observed(observer,{kind:"object.put",binding,key,createOnly:true,sha256:digest(body),bytes:body.byteLength},async(notify,identity)=>{
   requireS3ConditionalAuthority(binding,url,key);const response=await client.fetch(url(key),{method:"PUT",redirect:"error",body:new Blob([body],{type:contentType}),headers:{"content-length":String(body.byteLength),"if-none-match":"*",...originalRequestHeaders(identity)}});
   await notify({stage:"response",status:response.status});if(!response.ok)failure("write_response");await notify({stage:"accepted",status:response.status});const written=revision(binding,key,response.headers.get("etag"),response.headers.get("x-amz-version-id")??undefined);await notify({stage:"metadata",status:response.status,revision:written});
  });},
  async deleteVersioned(key,input){const rev=exactRevision(input,binding,key),target=new URL(url(key));if(rev.versionId!==undefined)target.searchParams.set("versionId",rev.versionId);
   return observed(observer,{kind:"object.delete",binding,key,expectedRevision:rev},async notify=>{requireS3ConditionalAuthority(binding,url,key,rev.versionId);const response=await client.fetch(target,{method:"DELETE",redirect:"error",headers:{"if-match":rev.value}});await notify({stage:"response",status:response.status});if(!response.ok)failure("delete_response");await notify({stage:"accepted",status:response.status});});
  },
  async inventoryPage(kind,cursor=null){
   if(!["objects","versions","sessions"].includes(kind))failure("inventory_kind");const target=new URL(bucketUrl);target.searchParams.set("encoding-type","url");
   if(kind==="objects"){target.searchParams.set("list-type","2");target.searchParams.set("max-keys",String(MAX_PAGE));if(cursor){target.searchParams.set("continuation-token",opaque(cursor.token));}}
   else if(kind==="versions"){target.searchParams.set("versions","");target.searchParams.set("max-keys",String(MAX_PAGE));if(cursor){target.searchParams.set("key-marker",objectKey(cursor.key));target.searchParams.set("version-id-marker",opaque(cursor.version));}}
   else{target.searchParams.set("uploads","");target.searchParams.set("max-uploads",String(MAX_PAGE));if(cursor){target.searchParams.set("key-marker",objectKey(cursor.key));target.searchParams.set("upload-id-marker",opaque(cursor.upload));}}
   return observed(observer,{kind:`inventory.${kind}`,binding,cursor},async notify=>{const response=await client.fetch(target,{redirect:"error"});await notify({stage:"response",status:response.status});const result=parsedS3Page(await xml(response,notify),kind,binding,cursor);await notify({stage:"inventory",status:response.status,detailDigest:digest(result),count:result.entries.length});return result;});
  },
  async inventoryConfiguration(){const target=new URL(bucketUrl);target.searchParams.set("versioning","");return observed(observer,{kind:"bucket.metadata",binding},async notify=>{
   const response=await client.fetch(target,{redirect:"error"});await notify({stage:"response",status:response.status});const document=await xml(response,notify),value=document.VersioningConfiguration;
   if(value!==""&&(!value||typeof value!=="object"||Array.isArray(value)||!["Enabled","Suspended"].includes(value.Status)))failure("versioning_configuration");
   const result={versioning:value===""?"disabled":value.Status,softDeleteSeconds:0,retentionSeconds:0};await notify({stage:"configuration",status:response.status,detailDigest:digest(result)});return result;
  });},
 };
}
function replitObject(metadata,key,binding){
 if(!metadata||metadata.name!==key||metadata.bucket!==binding.location.bucket)failure("replit_object_identity");
 if(typeof metadata.generation!=="string")failure("replit_generation");
 const requestProof=originalRequestProof(metadata.metadata?.freeholderOriginalRequest,metadata.metadata?.freeholderOriginalToken);return{bytes:size(String(metadata.size??"")),contentType:typeof metadata.contentType==="string"?metadata.contentType:"application/octet-stream",revision:revision(binding,key,metadata.generation),...(requestProof?{requestProof}:{})};
}
export function createReplitTransferProtocol({destination,binding,requireOriginalEndpoint,observer}){
 async function metadata(key,expected){objectKey(key);const pinned=expected?exactRevision(expected,binding,key):undefined;return observed(observer,{kind:"object.metadata",binding,key,...(pinned?{expectedRevision:pinned}:{})},async notify=>{
  requireOriginalEndpoint();let value;try{[value]=await(await destination()).file(key,pinned?{generation:pinned.value}:undefined).getMetadata();}catch(error){const code=error&&typeof error==="object"&&"code"in error?error.code:undefined;await notify({stage:"response",status:httpStatus(code)});if(code===404||code==="404"){await notify({stage:"absence",status:404});return undefined;}throw Error("The exact original Replit metadata request failed.");}
  await notify({stage:"response",status:null,detailDigest:digest(value)});const result=replitObject(value,key,binding);if(pinned&&JSON.stringify(result.revision)!==JSON.stringify(pinned))failure("replit_read_revision");await notify({stage:"metadata",status:null,...result});return result;
 });}
 async function readVersioned(key,expected,expectedObjectBytes){if(expectedObjectBytes!==undefined)expectedBytes(expectedObjectBytes);const original=await metadata(key,expected);if(!original)return undefined;if(expectedObjectBytes!==undefined&&original.bytes!==expectedObjectBytes)failure("replit_expected_bytes");return observed(observer,{kind:"object.body",binding,key,expectedRevision:original.revision,bytes:original.bytes},async notify=>{
  requireOriginalEndpoint();let body;try{body=await readReplitObjectBody((await destination()).file(key,{generation:original.revision.value}),original.bytes);}catch(error){const code=error&&typeof error==="object"&&"code"in error?error.code:undefined;await notify({stage:"response",status:httpStatus(code)});throw Error("The exact original pinned Replit body request failed.");}
  if(body.byteLength!==original.bytes)failure("replit_body_length");await notify({stage:"body",status:null,revision:original.revision,sha256:digest(body),bytes:body.byteLength});return{body,contentType:original.contentType,revision:original.revision,...(original.requestProof?{requestProof:original.requestProof}:{})};
 });}
 return{binding,readVersioned,async get(key){return(await readVersioned(key))?.body;},
  async put(key,body,contentType){objectKey(key);return observed(observer,{kind:"object.put",binding,key,createOnly:true,sha256:digest(body),bytes:body.byteLength},async(notify,identity)=>{
   requireOriginalEndpoint();const file=(await destination()).file(key);try{await file.save(Buffer.from(body),{resumable:false,validation:false,preconditionOpts:{ifGenerationMatch:0},metadata:{contentType,...(identity?{metadata:{freeholderOriginalRequest:identity.id,freeholderOriginalToken:identity.token}}:{})}});}catch(error){const code=error&&typeof error==="object"&&"code"in error?error.code:undefined;await notify({stage:"response",status:httpStatus(code)});throw Error("The original non-resumable create-only Replit upload failed.");}await notify({stage:"accepted",status:null,detailDigest:digest(file.metadata??null)});const written=replitObject(file.metadata,key,binding);await notify({stage:"metadata",status:null,revision:written.revision,bytes:written.bytes,...(written.requestProof?{requestProof:written.requestProof}:{})});if(written.bytes!==body.byteLength)failure("replit_write");
  });},
  async deleteVersioned(key,input){const rev=exactRevision(input,binding,key);return observed(observer,{kind:"object.delete",binding,key,expectedRevision:rev},async notify=>{
   requireOriginalEndpoint();try{await(await destination()).file(key,{generation:rev.value}).delete({ifGenerationMatch:rev.value});}catch(error){const code=error&&typeof error==="object"&&"code"in error?error.code:undefined;await notify({stage:"response",status:httpStatus(code)});throw Error("The original conditional Replit deletion failed.");}await notify({stage:"accepted",status:null});
  });},
  async inventoryPage(kind,cursor=null){
   if(!["objects","versions","retained"].includes(kind))failure("replit_inventory_kind");if(cursor&&Object.keys(cursor).some(key=>key!=="token"))failure("replit_inventory_kind");
   return observed(observer,{kind:`inventory.${kind}`,binding,cursor},async notify=>{
    requireOriginalEndpoint();let files,next;try{[files,next]=await(await destination()).getFiles({autoPaginate:false,maxResults:MAX_PAGE,...(cursor?{pageToken:opaque(cursor.token)}:{}),...(kind==="versions"?{versions:true}:{}),...(kind==="retained"?{softDeleted:true}:{})});}catch(error){const code=error&&typeof error==="object"&&"code"in error?error.code:undefined;await notify({stage:"response",status:httpStatus(code)});throw Error("The complete original Replit inventory request failed.");}
    await notify({stage:"response",status:null});if(!Array.isArray(files)||files.length>MAX_PAGE)failure("replit_inventory_page");
    const entries=files.map(file=>{const key=objectKey(file.name),value=replitObject(file.metadata,key,binding);return objectEntry(binding,key,value.bytes,value.revision,kind==="retained"?"retained":kind==="versions"?"version":"object",kind==="objects");});
    const token=next?.pageToken,result={entries,next:token?{token:opaque(token)}:null};if(result.next&&(!entries.length||JSON.stringify(result.next)===JSON.stringify(cursor)))failure("replit_page_cursor");await notify({stage:"inventory",status:null,detailDigest:digest(result),count:entries.length});return result;
   });
  },
  async inventoryConfiguration(){return observed(observer,{kind:"bucket.metadata",binding},async notify=>{
   requireOriginalEndpoint();let metadata;try{[metadata]=await(await destination()).getMetadata();}catch(error){const code=error&&typeof error==="object"&&"code"in error?error.code:undefined;await notify({stage:"response",status:httpStatus(code)});throw Error("The original Replit bucket policy request failed.");}
   await notify({stage:"response",status:null,detailDigest:digest(metadata)});if(!metadata||metadata.name!==binding.location.bucket)failure("replit_bucket_metadata");
   const result={versioning:metadata.versioning?.enabled===true?"Enabled":"disabled",softDeleteSeconds:metadata.softDeletePolicy?.retentionDurationSeconds===undefined?0:size(String(metadata.softDeletePolicy.retentionDurationSeconds)),retentionSeconds:metadata.retentionPolicy?.retentionPeriod===undefined?0:size(String(metadata.retentionPolicy.retentionPeriod))};await notify({stage:"configuration",status:null,detailDigest:digest(result)});return result;
  });},
 };
}
