// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Fictional owned TCP provider. No real account, credentials or terminal claim.
import {createServer} from "node:http";
export async function multipartBirthProvider(){
 const calls:Array<{method:string;key:string;query:string;requestId?:string;requestToken?:string}>=[],sessions=new Map<string,{key:string;body:Uint8Array<ArrayBuffer>}>(),versions=new Map<string,{key:string;body:Uint8Array<ArrayBuffer>}>();
 let sequence=0,loseCreate=false,inventoryGate:undefined|{started:()=>void;wait:Promise<void>},createGate:undefined|{started:()=>void;wait:Promise<void>};const releases=new Set<()=>void>();
 const server=createServer((req,res)=>{void(async()=>{
  for await(const chunk of req){const value:unknown=chunk;if(typeof value!=="string"&&!(value instanceof Uint8Array))throw Error("Non-byte fixture request");}
  const url=new URL(req.url??"/","http://fictional.invalid"),key=decodeURIComponent(url.pathname),method=req.method??"GET",requestId=typeof req.headers["x-amz-meta-freeholder-original-request"]==="string"?req.headers["x-amz-meta-freeholder-original-request"]:undefined,requestToken=typeof req.headers["x-amz-meta-freeholder-original-token"]==="string"?req.headers["x-amz-meta-freeholder-original-token"]:undefined;
  calls.push({method,key,query:url.search,...(requestId?{requestId}:{}),...(requestToken?{requestToken}:{})});
  const xml=(body:string)=>res.writeHead(200,{"content-type":"application/xml"}).end(body),relative=(name:string)=>encodeURIComponent(name.slice("/source/".length));
  if(method==="GET"&&key==="/source"){
   if(inventoryGate){const gate=inventoryGate;inventoryGate=undefined;gate.started();await gate.wait;}
   if(url.searchParams.has("versioning")){xml("<VersioningConfiguration/>");return;}
   if(url.searchParams.has("list-type")){xml("<ListBucketResult><Name>source</Name><EncodingType>url</EncodingType><KeyCount>0</KeyCount><IsTruncated>false</IsTruncated></ListBucketResult>");return;}
   if(url.searchParams.has("versions")){xml(`<ListVersionsResult><Name>source</Name><EncodingType>url</EncodingType><IsTruncated>false</IsTruncated>${[...versions].map(([id,value])=>`<Version><Key>${relative(value.key)}</Key><VersionId>${id}</VersionId><IsLatest>false</IsLatest><ETag>&quot;retained-original&quot;</ETag><Size>${value.body.byteLength}</Size></Version>`).join("")}</ListVersionsResult>`);return;}
   if(url.searchParams.has("uploads")){xml(`<ListMultipartUploadsResult><Bucket>source</Bucket><EncodingType>url</EncodingType><IsTruncated>false</IsTruncated>${[...sessions].map(([id,value])=>`<Upload><Key>${relative(value.key)}</Key><UploadId>${id}</UploadId></Upload>`).join("")}</ListMultipartUploadsResult>`);return;}
  }
  if(method==="POST"&&url.searchParams.has("uploads")){
   if(createGate){const gate=createGate;createGate=undefined;gate.started();await gate.wait;}
   const id=`actual-fictional-session-${++sequence}`;sessions.set(id,{key,body:new Uint8Array()});if(loseCreate){loseCreate=false;req.socket.destroy();return;}
   xml(`<InitiateMultipartUploadResult><Bucket>source</Bucket><Key>${key.slice("/source/".length)}</Key><UploadId>${id}</UploadId></InitiateMultipartUploadResult>`);return;
  }
  res.writeHead(404).end();
 })().catch((error:unknown)=>res.destroy(error instanceof Error?error:Error("Fictional multipart provider failed")));});
 await new Promise<void>((resolve,reject)=>{server.once("error",reject);server.listen(0,"127.0.0.1",resolve);});const address=server.address();if(!address||typeof address==="string")throw Error("Fictional TCP provider did not bind");
 function gate(kind:"inventory"|"create"){let started!:()=>void,release!:()=>void;const start=new Promise<void>(resolve=>{started=resolve;}),wait=new Promise<void>(resolve=>{release=resolve;});releases.add(release);if(kind==="inventory")inventoryGate={started,wait};else createGate={started,wait};return{started:start,release(){release();releases.delete(release);}};}
 return{calls,sessions,versions,endpoint:`http://127.0.0.1:${address.port}`,pauseNextInventory:()=>gate("inventory"),pauseNextCreate:()=>gate("create"),loseNextCreateResponse(){loseCreate=true;},close:()=>new Promise<void>((resolve,reject)=>{for(const release of releases)release();releases.clear();server.close(error=>error?reject(error):resolve());server.closeAllConnections();})};
}
