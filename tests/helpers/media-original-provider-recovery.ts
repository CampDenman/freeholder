// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Synthetic owned TCP S3 fixture; never an account/provider acceptance claim.
import {createServer} from "node:http";
import {createHash} from "node:crypto";
export async function ordinaryMediaRecoveryProvider(){
 const objects=new Map<string,{body:Uint8Array<ArrayBuffer>;type:string;etag:string}>();
 const calls:Array<{method:string;key:string;condition:string|undefined;body:Uint8Array<ArrayBuffer>}>=[];
 const originalRequestTags=new Map<string,{id:string;token:string}>();
 let losePutReply=false,pause:undefined|{started:()=>void;wait:Promise<void>};
 const releases=new Set<()=>void>();
 const server=createServer((req,res)=>{void(async()=>{
  const chunks:Buffer[]=[];for await(const chunk of req){const input:unknown=chunk;if(typeof input==="string")chunks.push(Buffer.from(input));else if(input instanceof Uint8Array)chunks.push(Buffer.from(input));else throw Error("Synthetic provider received a non-byte request chunk.");}
  const body=new Uint8Array(Buffer.concat(chunks)),key=decodeURIComponent(new URL(req.url??"/","http://fixture.invalid").pathname),method=req.method??"GET";
  const condition=typeof req.headers["if-match"]==="string"?req.headers["if-match"]:typeof req.headers["if-none-match"]==="string"?req.headers["if-none-match"]:undefined;
  calls.push({method,key,condition,body});const object=objects.get(key),url=new URL(req.url??"/","http://fixture.invalid");
  if(method==="GET"&&["/source","/target"].includes(key)){
   const bucket=key.slice(1),prefix=key+"/",inventory=[...objects.entries()].filter(([name])=>name.startsWith(prefix));
   if(url.searchParams.has("versioning")){res.writeHead(200,{"content-type":"application/xml"}).end("<VersioningConfiguration/>");return;}
   if(url.searchParams.has("list-type")){
    const contents=inventory.map(([name,value])=>`<Contents><Key>${encodeURIComponent(name.slice(prefix.length))}</Key><ETag>&quot;${value.etag.slice(1,-1)}&quot;</ETag><Size>${value.body.byteLength}</Size></Contents>`).join("");
    res.writeHead(200,{"content-type":"application/xml"}).end(`<ListBucketResult><Name>${bucket}</Name><EncodingType>url</EncodingType><KeyCount>${inventory.length}</KeyCount><IsTruncated>false</IsTruncated>${contents}</ListBucketResult>`);return;
   }
   if(url.searchParams.has("versions")){
    const versions=inventory.map(([name,value])=>`<Version><Key>${encodeURIComponent(name.slice(prefix.length))}</Key><VersionId>null</VersionId><IsLatest>true</IsLatest><ETag>&quot;${value.etag.slice(1,-1)}&quot;</ETag><Size>${value.body.byteLength}</Size></Version>`).join("");
    res.writeHead(200,{"content-type":"application/xml"}).end(`<ListVersionsResult><Name>${bucket}</Name><EncodingType>url</EncodingType><IsTruncated>false</IsTruncated>${versions}</ListVersionsResult>`);return;
   }
   if(url.searchParams.has("uploads")){res.writeHead(200,{"content-type":"application/xml"}).end(`<ListMultipartUploadsResult><Bucket>${bucket}</Bucket><EncodingType>url</EncodingType><IsTruncated>false</IsTruncated></ListMultipartUploadsResult>`);return;}
  }
  if(method==="PUT"){
   if(req.headers["if-none-match"]==="*"&&object){res.writeHead(412).end();return;}
   if(pause&&key.startsWith("/source/")){const gate=pause;pause=undefined;gate.started();await gate.wait;}
   const type=String(req.headers["content-type"]??"application/octet-stream"),etag=`"${createHash("sha256").update(body).digest("hex")}"`;
   objects.set(key,{body,type,etag});
   const requestId=req.headers["x-amz-meta-freeholder-original-request"],requestToken=req.headers["x-amz-meta-freeholder-original-token"];
   if(typeof requestId==="string"&&typeof requestToken==="string")originalRequestTags.set(key,{id:requestId,token:requestToken});
   if(losePutReply&&key.startsWith("/source/")){losePutReply=false;req.socket.destroy();return;}
   res.writeHead(200,{etag}).end();return;
  }
  if(method==="DELETE"){
   if(object&&req.headers["if-match"]&&req.headers["if-match"]!==object.etag){res.writeHead(412).end();return;}
   objects.delete(key);res.writeHead(204).end();return;
  }
  if(!object){res.writeHead(404).end();return;}
  const tags=originalRequestTags.get(key);
  res.writeHead(200,{"content-type":object.type,"content-length":String(object.body.byteLength),etag:object.etag,...(tags?{"x-amz-meta-freeholder-original-request":tags.id,"x-amz-meta-freeholder-original-token":tags.token}:{})});res.end(method==="HEAD"?undefined:object.body);
 })().catch((error:unknown)=>{res.destroy(error instanceof Error?error:new Error("Synthetic provider handler failed."));});});
 await new Promise<void>((resolve,reject)=>{server.once("error",reject);server.listen(0,"127.0.0.1",resolve);});
 const address=server.address();if(!address||typeof address==="string")throw Error("Synthetic provider did not bind TCP.");
 return{pauseNextSourcePut(){let start!:()=>void,release!:()=>void;const started=new Promise<void>(resolve=>{start=resolve;}),wait=new Promise<void>(resolve=>{release=resolve;});releases.add(release);pause={started:start,wait};return{started,release:()=>{release();releases.delete(release);}};},releaseAll(){for(const release of releases)release();releases.clear();},endpoint:`http://127.0.0.1:${address.port}`,objects,calls,originalRequestTags,loseNextSourcePutReply(){losePutReply=true;},close:()=>new Promise<void>((resolve,reject)=>{for(const release of releases)release();releases.clear();server.close(error=>error?reject(error):resolve());server.closeAllConnections();})};
}
