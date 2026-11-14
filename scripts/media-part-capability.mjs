// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C1.12/C11.08: local signing grants a replayable future PUT capability.
// A retained mint is NOT a provider ACK, part upload, FIN or consumption proof.
import {createHash} from 'node:crypto';
const hash=value=>createHash('sha256').update(value).digest('hex');
const canonical=value=>Array.isArray(value)?`[${value.map(canonical).join(',')}]`:value!==null&&typeof value==='object'?`{${Object.entries(value).sort(([a],[b])=>a<b?-1:a>b?1:0).map(([key,item])=>`${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`:JSON.stringify(value)??'null';
const factDigest=value=>hash('freeholder:verified-storage-transfer:v1\0'+canonical(value));
const invalid=()=>{throw Error('storage: original multipart part authority is incomplete or changed');};
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const date=value=>{if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)||!Number.isFinite(Date.parse(value))||new Date(Date.parse(value)).toISOString()!==value)invalid();return Date.parse(value);};
export function createS3MultipartPartIssuer({binding,url,client,observer}){
 if(binding.kind!=='s3'||typeof observer!=='function'||typeof client.sign!=='function')invalid();
 return async function signOriginalPart({key,uploadId,partNumber,sha256,bytes,expiresAt}){
  if(typeof key!=='string'||!key||key.length>2048||/[\u0000-\u001f\u007f]/.test(key)||key.split('/').some(part=>part==='.'||part==='..')||typeof uploadId!=='string'||!uploadId||uploadId.length>4096||/[\u0000-\u001f\u007f]/.test(uploadId)||!Number.isInteger(partNumber)||partNumber<1||partNumber>10000||!Number.isSafeInteger(bytes)||bytes<1||bytes>8*1024*1024||typeof sha256!=='string'||!/^[a-f0-9]{64}$/.test(sha256))invalid();
  const deadline=date(expiresAt),now=Date.now(),seconds=Math.floor((deadline-now)/1000);if(seconds<1||seconds>300)invalid();
  return observer({kind:'multipart.sign',binding,key,uploadId,partNumber,sha256,bytes,expiresAt},async(notify,identity)=>{
   if(!identity||!uuid.test(identity.id)||typeof identity.token!=='string'||identity.token.length<36||identity.token.length>200||/[\u0000-\u001f\u007f]/.test(identity.token))invalid();
   const target=new URL(url(key));if(target.search||target.hash)invalid();target.searchParams.set('partNumber',String(partNumber));target.searchParams.set('uploadId',uploadId);target.searchParams.set('X-Amz-Expires',String(seconds));
   const checksum=Buffer.from(sha256,'hex').toString('base64'),datetime=new Date(now).toISOString().replace(/[:-]|\.\d{3}/g,''),actualExpiry=new Date(Math.floor(now/1000)*1000+seconds*1000).toISOString();
   const headers={'content-length':String(bytes),'x-amz-checksum-sha256':checksum,'x-amz-content-sha256':sha256,'x-freeholder-original-part-id':identity.id};
   // aws4fetch normally excludes content-length. allHeaders explicitly binds
   // it, the checksum/body SHA and the public physical nonce. No caller token
   // or private signing credential enters the browser's required headers.
   const signed=await client.sign(target.toString(),{method:'PUT',headers,aws:{signQuery:true,allHeaders:true,datetime}}),actual=new URL(signed.url),required='content-length;host;x-amz-checksum-sha256;x-amz-content-sha256;x-freeholder-original-part-id';
   if(signed.method!=='PUT'||actual.origin!==target.origin||actual.pathname!==target.pathname||actual.hash||actual.searchParams.get('partNumber')!==String(partNumber)||actual.searchParams.get('uploadId')!==uploadId||actual.searchParams.get('X-Amz-Expires')!==String(seconds)||actual.searchParams.get('X-Amz-Date')!==datetime||actual.searchParams.get('X-Amz-Algorithm')!=='AWS4-HMAC-SHA256'||actual.searchParams.get('X-Amz-SignedHeaders')!==required||!/^[a-f0-9]{64}$/.test(actual.searchParams.get('X-Amz-Signature')??''))invalid();
   const names=new Set();for(const[name]of actual.searchParams){if(names.has(name)||!['partNumber','uploadId','X-Amz-Expires','X-Amz-Date','X-Amz-Algorithm','X-Amz-SignedHeaders','X-Amz-Signature','X-Amz-Credential','X-Amz-Security-Token'].includes(name))invalid();names.add(name);}
   for(const[name,value]of Object.entries(headers))if(signed.headers.get(name)!==value)invalid();
   const returnedHeaders={'x-amz-checksum-sha256':checksum,'x-amz-content-sha256':sha256,'x-freeholder-original-part-id':identity.id},proof={format:'original-multipart-part-capability/v1',requestId:identity.id,urlDigest:hash(signed.url),headersDigest:factDigest(returnedHeaders),expiresAt:actualExpiry,uploadIdDigest:factDigest(uploadId),partNumber,sha256,bytes},capabilityDigest=factDigest(proof);
   await notify({stage:'capability',status:null,uploadId,sha256,bytes,expiresAt:actualExpiry,detailDigest:capabilityDigest,capabilityProof:proof,requestProof:{id:identity.id,tokenDigest:factDigest(identity.token)}});
   return{url:signed.url,method:'PUT',headers:returnedHeaders,expiresAt:actualExpiry,capabilityDigest,proof};
  });
 };
}
