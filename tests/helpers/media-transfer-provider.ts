// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Synthetic owned TCP S3 fixture; never an account/provider acceptance claim.
import {createServer} from "node:http";
import {createHash} from "node:crypto";
export async function mediaTransferProvider(){
 const objects=new Map<string,{body:Uint8Array<ArrayBuffer>;type:string;etag:string}>();
 const calls:Array<{method:string;key:string;condition:string|undefined;body:Uint8Array<ArrayBuffer>}>=[];
 let losePutReply=false;
 const server=createServer(async(req,res)=>{
  const chunks:Buffer[]=[];for await(const chunk of req)chunks.push(Buffer.from(chunk));
  const body=new Uint8Array(Buffer.concat(chunks)),key=decodeURIComponent(new URL(req.url??"/","http://fixture.invalid").pathname),method=req.method??"GET";
  const condition=typeof req.headers["if-match"]==="string"?req.headers["if-match"]:typeof req.headers["if-none-match"]==="string"?req.headers["if-none-match"]:undefined;
  calls.push({method,key,condition,body});const object=objects.get(key);
  if(method==="PUT"){
   if(req.headers["if-none-match"]==="*"&&object){res.writeHead(412).end();return;}
   const type=String(req.headers["content-type"]??"application/octet-stream"),etag=`"${createHash("sha256").update(body).digest("hex")}"`;
   objects.set(key,{body,type,etag});
   if(losePutReply&&key.startsWith("/target/")){losePutReply=false;req.socket.destroy();return;}
   res.writeHead(200,{etag}).end();return;
  }
  if(method==="DELETE"){
   if(object&&req.headers["if-match"]&&req.headers["if-match"]!==object.etag){res.writeHead(412).end();return;}
   objects.delete(key);res.writeHead(204).end();return;
  }
  if(!object){res.writeHead(404).end();return;}
  res.writeHead(200,{"content-type":object.type,"content-length":String(object.body.byteLength),etag:object.etag});res.end(method==="HEAD"?undefined:object.body);
 });
 await new Promise<void>((resolve,reject)=>{server.once("error",reject);server.listen(0,"127.0.0.1",resolve);});
 const address=server.address();if(!address||typeof address==="string")throw Error("Synthetic provider did not bind TCP.");
 return{endpoint:`http://127.0.0.1:${address.port}`,objects,calls,loseNextTargetPutReply(){losePutReply=true;},close:()=>new Promise<void>((resolve,reject)=>{server.close(error=>error?reject(error):resolve());server.closeAllConnections();})};
}
