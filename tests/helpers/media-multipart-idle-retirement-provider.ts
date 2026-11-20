// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Fictional owned TCP provider, never an account/provider terminal witness.
// Idle-retirement copy; all earlier helper bytes and positive oracles are preserved.
import {createServer} from "node:http";
import {createHash} from "node:crypto";
export async function multipartIdleRetirementProvider(){
 type Part={body:Buffer;etag:string;checksum:string};
 type Session={key:string;type:string;requestId:string;requestToken:string;parts:Map<number,Part>};
 type ObjectBytes={body:Buffer;etag:string;type:string;requestId:string;requestToken:string};
 const calls:Array<{method:string;key:string;query:string;bodyDigest:string}>=[],sessions=new Map<string,Session>(),objects=new Map<string,ObjectBytes>();const versions=new Map<string,Buffer>();let loseAbort=false,retainSession=false,retainVersion=false,abortGate:undefined|{started:()=>void;wait:Promise<void>};let sequence=0,loseCreate=false,wrongChecksum=false,loseListing=false,extraPart=false,loseComplete=false,keepSession=false,completeGate:undefined|{started:()=>void;wait:Promise<void>};const releases=new Set<()=>void>();
 const escape=(value:string)=>value.replaceAll('&','&amp;').replaceAll('"','&quot;').replaceAll('<','&lt;').replaceAll('>','&gt;');
 const server=createServer((req,res)=>{void(async()=>{
  const chunks:Buffer[]=[];for await(const chunk of req){const value:unknown=chunk;if(typeof value==="string")chunks.push(Buffer.from(value));else if(value instanceof Uint8Array)chunks.push(Buffer.from(value));else throw Error("Non-byte fixture request");}
  const body=Buffer.concat(chunks),url=new URL(req.url??"/","http://fictional.invalid"),key=decodeURIComponent(url.pathname),method=req.method??"GET",id=url.searchParams.get("uploadId"),session=id?sessions.get(id):undefined;
  calls.push({method,key,query:url.search,bodyDigest:createHash("sha256").update(body).digest("hex")});
  const xml=(value:string)=>res.writeHead(200,{"content-type":"application/xml"}).end(value),absent=()=>res.writeHead(404,{"content-type":"application/xml"}).end("<Error><Code>NoSuchUpload</Code></Error>");
  if(method==="GET"&&key==="/source"){
   if(url.searchParams.has("versioning")){xml("<VersioningConfiguration/>");return;}
   if(url.searchParams.has("versions")){xml(`<ListVersionsResult><Name>source</Name><EncodingType>url</EncodingType><IsTruncated>false</IsTruncated>${[...versions].map(([name,value])=>`<Version><Key>${encodeURIComponent(name.slice('/source/'.length))}</Key><VersionId>fictional-retained-version</VersionId><IsLatest>false</IsLatest><ETag>"retained"</ETag><Size>${value.length}</Size></Version>`).join('')}</ListVersionsResult>`);return;}
   if(url.searchParams.has("list-type")){xml(`<ListBucketResult><Name>source</Name><EncodingType>url</EncodingType><KeyCount>${objects.size}</KeyCount><IsTruncated>false</IsTruncated>${[...objects].map(([name,value])=>`<Contents><Key>${encodeURIComponent(name.slice('/source/'.length))}</Key><ETag>${escape(value.etag)}</ETag><Size>${value.body.length}</Size></Contents>`).join('')}</ListBucketResult>`);return;}
   if(url.searchParams.has("uploads")){xml(`<ListMultipartUploadsResult><Bucket>source</Bucket><EncodingType>url</EncodingType><IsTruncated>false</IsTruncated>${[...sessions].map(([identity,value])=>`<Upload><Key>${encodeURIComponent(value.key.slice('/source/'.length))}</Key><UploadId>${identity}</UploadId></Upload>`).join('')}</ListMultipartUploadsResult>`);return;}
  }
  if(method==="POST"&&url.searchParams.has("uploads")){
   const requestId=req.headers["x-amz-meta-freeholder-original-request"],requestToken=req.headers["x-amz-meta-freeholder-original-token"];
   if(typeof requestId!=="string"||typeof requestToken!=="string"||req.headers["x-amz-checksum-algorithm"]!=="SHA256"||req.headers["x-amz-checksum-type"]!=="COMPOSITE")throw Error("Actual original checksum-enabled CREATE required");
   const identity=`actual-fictional-complete-session-${++sequence}`;sessions.set(identity,{key,type:typeof req.headers["content-type"]==="string"?req.headers["content-type"]:"application/octet-stream",requestId,requestToken,parts:new Map()});if(loseCreate){loseCreate=false;req.socket.destroy();return;}xml(`<InitiateMultipartUploadResult><Bucket>source</Bucket><Key>${escape(key.slice('/source/'.length))}</Key><UploadId>${identity}</UploadId></InitiateMultipartUploadResult>`);return;
  }
  if(id&&(!session||session.key!==key)){absent();return;}
  if(session&&method==="DELETE"){
   if(abortGate){const gate=abortGate;abortGate=undefined;gate.started();await gate.wait;}
   if(retainVersion)versions.set(key,Buffer.from("fictional-retained-private-version"));if(!retainSession)sessions.delete(id!);if(loseAbort){loseAbort=false;req.socket.destroy();return;}res.writeHead(204).end();return;
  }
  if(session&&method==="PUT"){
   const partNumber=Number(url.searchParams.get("partNumber")),hex=createHash("sha256").update(body).digest("hex"),checksum=createHash("sha256").update(body).digest("base64");
   if(!Number.isInteger(partNumber)||partNumber<1||req.headers["x-amz-content-sha256"]!==hex||req.headers["x-amz-checksum-sha256"]!==checksum||Number(req.headers["content-length"])!==body.length||typeof req.headers["x-freeholder-original-part-id"]!=="string")throw Error("Actual original body-bound PUT headers required");
   const etag=`"part-${hex}"`;session.parts.set(partNumber,{body,etag,checksum});res.writeHead(200,{etag,"x-amz-checksum-sha256":checksum}).end();return;
  }
  if(session&&method==="GET"){
   if(loseListing){loseListing=false;req.socket.destroy();return;}
   const entries=[...session.parts].sort(([a],[b])=>a-b).map(([partNumber,part])=>({partNumber,...part}));if(extraPart)entries.push({partNumber:10000,body:Buffer.from("unissued"),etag:'"unissued"',checksum:Buffer.alloc(32).toString("base64")});
   xml(`<ListPartsResult><Bucket>source</Bucket><Key>${escape(key.slice('/source/'.length))}</Key><UploadId>${id}</UploadId><IsTruncated>false</IsTruncated>${entries.map(part=>`<Part><PartNumber>${part.partNumber}</PartNumber><ETag>${escape(part.etag)}</ETag><Size>${part.body.length}</Size><ChecksumSHA256>${wrongChecksum?Buffer.alloc(32).toString("base64"):part.checksum}</ChecksumSHA256></Part>`).join('')}</ListPartsResult>`);return;
  }
  if(session&&method==="POST"){
   if(completeGate){const gate=completeGate;completeGate=undefined;gate.started();await gate.wait;}
   if(req.headers["if-none-match"]!=="*"||objects.has(key)||req.headers["x-amz-checksum-type"]!=="COMPOSITE")throw Error("Original conditional COMPLETE required");
   const parts=[...session.parts].sort(([a],[b])=>a-b),expected=`<CompleteMultipartUpload>${parts.map(([number,part])=>`<Part><PartNumber>${number}</PartNumber><ETag>${escape(part.etag)}</ETag><ChecksumSHA256>${part.checksum}</ChecksumSHA256></Part>`).join('')}</CompleteMultipartUpload>`;
   if(body.toString()!==expected)throw Error("COMPLETE changed the original browser manifest");
   const stored=Buffer.concat(parts.map(([,part])=>part.body)),etag=`"object-${createHash("sha256").update(stored).digest("hex")}"`;
   objects.set(key,{body:stored,etag,type:session.type,requestId:session.requestId,requestToken:session.requestToken});if(!keepSession)sessions.delete(id!);if(loseComplete){loseComplete=false;req.socket.destroy();return;}xml(`<CompleteMultipartUploadResult><Bucket>source</Bucket><Key>${escape(key.slice('/source/'.length))}</Key><ETag>${escape(etag)}</ETag></CompleteMultipartUploadResult>`);return;
  }
  const object=objects.get(key);if(object&&(method==="GET"||method==="HEAD")){
   if(req.headers["if-match"]&&req.headers["if-match"]!==object.etag){res.writeHead(412).end();return;}
   const range=typeof req.headers.range==="string"?/^bytes=(\d+)-(\d+)$/.exec(req.headers.range):null,bytes=range?object.body.subarray(Number(range[1]),Math.min(object.body.length,Number(range[2])+1)):object.body;
   res.writeHead(range?206:200,{etag:object.etag,"content-length":bytes.length,"content-type":object.type,"x-amz-meta-freeholder-original-request":object.requestId,"x-amz-meta-freeholder-original-token":object.requestToken});res.end(method==="HEAD"?undefined:bytes);return;
  }
  res.writeHead(404).end();
 })().catch((error:unknown)=>res.destroy(error instanceof Error?error:Error("Fictional multipart completion failed")));});
 await new Promise<void>((resolve,reject)=>{server.once("error",reject);server.listen(0,"127.0.0.1",resolve);});const address=server.address();if(!address||typeof address==="string")throw Error("Fictional provider did not bind");
 function pauseNextComplete(){let entered!:()=>void,release!:()=>void;const started=new Promise<void>(resolve=>{entered=resolve;}),wait=new Promise<void>(resolve=>{release=resolve;});releases.add(release);completeGate={started:entered,wait};return{started,release(){release();releases.delete(release);}};}
 function pauseNextAbort(){let entered!:()=>void,done!:()=>void;const started=new Promise<void>(resolve=>{entered=resolve;}),wait=new Promise<void>(resolve=>{done=resolve;});releases.add(done);abortGate={started:entered,wait};return{started,release(){done();releases.delete(done);}};}
 return{calls,objects,pauseNextComplete,pauseNextAbort,retainVersionAfterAbort(){retainVersion=true;},retainSessionAfterAbort(){retainSession=true;},loseNextAbortResponse(){loseAbort=true;},loseNextCreateResponse(){loseCreate=true;},releaseAll(){for(const release of releases)release();releases.clear();},loseNextCompleteResponse(){loseComplete=true;},retainOriginalSession(){keepSession=true;},endpoint:`http://127.0.0.1:${address.port}`,reportWrongPartChecksum(){wrongChecksum=true;},reportExtraPart(){extraPart=true;},loseNextPartListing(){loseListing=true;},close:()=>new Promise<void>((resolve,reject)=>{for(const release of releases)release();releases.clear();server.close(error=>error?reject(error):resolve());server.closeAllConnections();})};
}
