// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Actual streamed bytes, fixed original boundaries. No full-file buffering,
// provider acknowledgement, original writer FIN or delegated-link consumption.
import {createHash} from 'node:crypto';
const fail=()=>{throw Error('storage: completed bytes differ from the original declared multipart file');};
export function originalMultipartReadback(parts,maxBytes){
 if(!Array.isArray(parts)||parts.length<1||parts.length>10000||!Number.isSafeInteger(maxBytes)||maxBytes<=0)fail();
 const manifest=parts.map(({partNumber,etag,bytes,checksumSha256})=>({partNumber,etag,bytes,checksumSha256}));let expected=0;
 for(const[index,part]of manifest.entries()){
  if(part.partNumber!==index+1||typeof part.etag!=='string'||!part.etag||part.etag.length>256||/[\u0000-\u001f\u007f]/.test(part.etag)||!Number.isSafeInteger(part.bytes)||part.bytes<=0||part.bytes>8388608||index<manifest.length-1&&part.bytes!==8388608||typeof part.checksumSha256!=='string'||!(/^[A-Za-z0-9+/]{43}=$/.test(part.checksumSha256))||Buffer.from(part.checksumSha256,'base64').toString('base64')!==part.checksumSha256)fail();
  expected+=part.bytes;if(!Number.isSafeInteger(expected)||expected>maxBytes)fail();
 }
 if(expected!==maxBytes)fail();
 const partsDigest=createHash('sha256').update(JSON.stringify(manifest)).digest('hex');let index=0,inPart=0,total=0,closed=false,hash=createHash('sha256');
 return{
  partsDigest,
  update(chunk){
   if(closed||!(chunk instanceof Uint8Array)||total+chunk.byteLength>expected)fail();let offset=0;
   while(offset<chunk.byteLength){const part=manifest[index];if(!part)fail();const count=Math.min(chunk.byteLength-offset,part.bytes-inPart);hash.update(chunk.subarray(offset,offset+count));offset+=count;inPart+=count;total+=count;
    if(inPart===part.bytes){if(hash.digest('base64')!==part.checksumSha256)fail();index++;inPart=0;if(index<manifest.length)hash=createHash('sha256');}
   }
  },
  finish(){if(closed||index!==manifest.length||inPart!==0||total!==expected)fail();closed=true;return{partsDigest,bytes:total};},
 };
}
