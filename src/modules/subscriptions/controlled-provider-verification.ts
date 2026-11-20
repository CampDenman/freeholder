// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.38: copy the genuine original returned SDK result, never an operator's replacement assertion.
import { eq,sql } from "drizzle-orm";
import { z } from "zod";
import { defineService,ServiceError } from "@/core/service";
import { lockContactIdentityForRead } from "@/core/contacts/identity-lock";
import { merchantTaxDigest } from "@/modules/invoicing/merchant-tax-store";
import { subscriptionControlledOperations,subscriptionControlledVerifications } from "./controlled-provider-schema";
import { controlledProviderJournal,finishedControlledCall } from "./controlled-provider-proof";
import { requireControlledProviderSchema } from "./controlled-provider-source";
import { createControlledHistoricalFinReference } from "./controlled-provider-safe-response-proof";
import { CONTROLLED_SAFE_RESPONSE_PROTOCOL, CONTROLLED_PROJECTION_KEY } from "@/adapters/payments/merchant-controlled-safe-response-contract";
export const retainControlledProviderVerification=defineService({name:"subscriptions.retainControlledProviderVerification",summary:"Retain an exact genuine original returned SDK result; this alone supplies neither paid principal nor stopped-calendar authority.",
 kind:"mutation",permission:"system",external:false,writeClass:"money",input:z.object({operationId:z.uuid()}),output:z.object({operationId:z.uuid(),callId:z.uuid(),result:z.record(z.string(),z.unknown())}),
 handler:async({operationId},ctx)=>{
  await lockContactIdentityForRead(ctx.tx);await requireControlledProviderSchema(ctx);
  const[operation]=await ctx.tx.select().from(subscriptionControlledOperations).where(eq(subscriptionControlledOperations.id,operationId)).limit(1);
  if(!operation)throw new ServiceError("not_found","There is no such original controlled operation.");
  await ctx.tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`controlled-provider:${operation.resourceId}`}))`);
  const history=await controlledProviderJournal(ctx.tx,operation.resourceId),calls=history.calls.filter(row=>row.operationId===operation.id),call=calls[0];
  const finish=call?history.finishes.find(row=>row.callId===call.id)??null:null;
  if(calls.length!==1||!call||!finish||!finishedControlledCall(operation,call,finish)||finish.actualResult.outcome!=="returned")
   throw new ServiceError("conflict","The actual original SDK result did not return successfully. Preserve its raw facts and recover the original resource with a new admitted read after real finish/stop.");
  const[prior]=await ctx.tx.select().from(subscriptionControlledVerifications).where(eq(subscriptionControlledVerifications.operationId,operationId)).limit(1);
  if(prior){const view=history.verificationViews.find(row=>row.operationId===operationId);if(prior.callId!==call.id||!view)throw new ServiceError("conflict","Preserve the first actual returned result and its exact original caller.");return{operationId,callId:call.id,result:view.resultView};}
  const originalResult=z.record(z.string(),z.unknown()).parse(finish.actualResult.result);
  const safe=call.admission.payload.responseProjectionProtocol===CONTROLLED_SAFE_RESPONSE_PROTOCOL;
  const result=safe?originalResult:await createControlledHistoricalFinReference(ctx.tx,operation,call,finish),actualResultDigest=merchantTaxDigest(result);
  if(safe&&z.record(z.string(),z.unknown()).parse(originalResult[CONTROLLED_PROJECTION_KEY]).protocol!==CONTROLLED_SAFE_RESPONSE_PROTOCOL)throw new ServiceError("conflict","Retain only the actual safe-projected result of this original new caller.");
  if(history.count>=5000)throw new ServiceError("conflict","Restore a bounded complete controlled result inventory; verification cannot truncate original history.");
  await ctx.tx.execute(sql`select set_config('freeholder.controlled_provider_v1','1',true)`);
  await ctx.tx.insert(subscriptionControlledVerifications).values({operationId,callId:call.id,actualResult:result,actualResultDigest,evidenceRevision:history.revision});
  return{operationId,callId:call.id,result:z.record(z.string(),z.unknown()).parse(safe?result:result.safeView)};
 }});
