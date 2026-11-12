// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C1.12/C11.08: actual preserved pre75 production HTTP image, synthetic S3 only.
import {createServer} from "node:http";
import {afterAll,expect,it} from "vitest";
import {eq,sql} from "drizzle-orm";
import {db,closeDb} from "@/core/db";
import {users} from "@/core/auth/schema";
import {createSession,SESSION_COOKIE} from "@/core/auth/sessions";
import {CSRF_COOKIE,CSRF_HEADER,issueCsrfToken} from "@/core/http/csrf";
import {seedDefaultRoles} from "@/core/roles/defaults";
import {OWNER} from "../helpers/spine";
afterAll(closeDb);
it("keeps a real pre75 image unready and refuses ordinary HTTP upload before synthetic physical PUT",async()=>{
 const address=process.env.FREEHOLDER_OLD_MEDIA_IMAGE_URL,sinkPort=Number(process.env.FREEHOLDER_OLD_MEDIA_SINK_PORT),database=process.env.DATABASE_URL;
 if(!address||!database||!/test/i.test(new URL(database).pathname)||!["127.0.0.1","localhost"].includes(new URL(address).hostname)||!Number.isInteger(sinkPort)||sinkPort<1024)throw new Error("Use a local preserved older artifact, synthetic sink and explicit disposable migrated database.");
 const baseline=process.env.FREEHOLDER_OLD_MEDIA_EXPECT_BASELINE==="1";
 let physical=0;const objects=new Map<string,Buffer>();
 const sink=createServer((request,response)=>{const key=request.url??"";if(["PUT","POST","DELETE"].includes(request.method??""))physical++;
  if(request.method==="PUT"){const chunks:Buffer[]=[];request.on("data",(chunk:Buffer)=>chunks.push(chunk));request.on("end",()=>{objects.set(key,Buffer.concat(chunks));response.writeHead(200);response.end();});return;}
  if(request.method==="DELETE"){objects.delete(key);response.writeHead(204);response.end();return;}
  const body=objects.get(key);response.writeHead(body?200:404,body?{"content-length":String(body.byteLength),"content-type":"application/pdf"}:{});response.end(request.method==="HEAD"?undefined:body);
 });
 await new Promise<void>((resolve,reject)=>{sink.once("error",reject);sink.listen(sinkPort,"127.0.0.1",resolve);});
 try{
  await db().insert(users).values({id:OWNER.userId,email:"owner@example.test",role:"owner"}).onConflictDoNothing();
  await db().transaction(seedDefaultRoles);
  const user=(await db().select().from(users).where(eq(users.id,OWNER.userId)))[0];expect(user?.role).toBe("owner");
  const token=await db().transaction(tx=>createSession(tx,OWNER.userId,{twoFactorVerified:true})),csrf=issueCsrfToken();
  const snapshot=async()=>({objects:await db().execute(sql`select to_jsonb(t) as row from media_objects t order by key`),uploads:await db().execute(sql`select to_jsonb(t) as row from media_uploads t order by id`),writes:(await db().execute<{present:string|null}>(sql`select to_regclass('public.media_object_writes') as present`))[0]?.present?await db().execute(sql`select to_jsonb(t) as row from media_object_writes t order by id`):[]});
  const before=await snapshot();
  const health=await fetch(`${address}/api/health`);expect(health.status).toBe(baseline?200:503);expect(await health.json()).toMatchObject({ok:baseline});
  const form=new FormData();form.set("file",new File(["%PDF-1.7\nSynthetic old artifact refusal.\n%%EOF\n"],"original.pdf",{type:"application/pdf"}));
  const response=await fetch(`${address}/api/media`,{method:"POST",headers:{origin:address,[CSRF_HEADER]:csrf,cookie:`${SESSION_COOKIE}=${token.token}; ${CSRF_COOKIE}=${csrf}`},body:form});
  if(baseline){expect(response.status).toBe(200);expect(physical).toBe(1);}else{expect([409,500,503]).toContain(response.status);expect(physical).toBe(0);expect(await snapshot()).toEqual(before);}
 }finally{await new Promise<void>((resolve,reject)=>sink.close(error=>error?reject(error):resolve()));}
},60000);
