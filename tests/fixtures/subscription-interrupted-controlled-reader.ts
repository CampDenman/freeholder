// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// PREPARED / UNRUN. The real isolated process admits and begins its exact GET,
// then remains physically alive until the parent actually stops and awaits it.
import { z } from "zod";
const operationId=z.uuid().parse(process.argv[2]);let atOriginalGet:(()=>Promise<void>)|undefined;
globalThis.fetch=async(input,init={})=>{
 const url=new URL(typeof input==="string"?input:input instanceof URL?input.href:input.url);
 if(url.origin!=="https://api.stripe.com"||init.method!=="GET")throw Error("Only this fictional exact original Stripe GET is allowed in the interrupted process");
 if(url.pathname==="/v1/account")return Response.json({id:"acct_fixturePlatform"});
 if(url.pathname==="/v1/subscriptions/sub_actualControlledZero"){await atOriginalGet?.();return new Promise<Response>(()=>{/* original GET remains unresolved until actual process stop */});}
 throw Error("Unexpected fictional controlled GET path");
};
async function original(){try{
 const[{executeControlledOperation},{subscriptionControlledCalls},{db},{eq}]=await Promise.all([import("@/modules/subscriptions/controlled-provider-execution"),import("@/modules/subscriptions/controlled-provider-schema"),import("@/core/db"),import("drizzle-orm")]);
 atOriginalGet=async()=>{const[call]=await db().select({callId:subscriptionControlledCalls.id}).from(subscriptionControlledCalls).where(eq(subscriptionControlledCalls.operationId,operationId));if(!call||!process.send)throw Error("The actual original child admission/channel is unavailable");process.send(call);};
 await executeControlledOperation(operationId,{kind:"system"});throw Error("Interrupted actual controlled GET unexpectedly returned");
}catch(error){process.send?.({error:error instanceof Error?error.message:"Actual controlled child reader failed"});process.exitCode=1;}}
void original();
