// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.38: actual zero preparation can close without inventing paid application access.
import { eq,sql } from "drizzle-orm";
import { z } from "zod";
import { lockContactIdentityForRead } from "@/core/contacts/identity-lock";
import { defineService,ServiceError } from "@/core/service";
import { merchantTaxDigest } from "@/modules/invoicing/merchant-tax-store";
import { controlledProviderJournal } from "./controlled-provider-proof";
import { subscriptionControlledResources,subscriptionControlledClosures } from "./controlled-provider-schema";
import { requireControlledProviderSchema } from "./controlled-provider-source";
import { controlledZeroTransportProof } from "./controlled-provider-zero-policy";
export { controlledZeroTransportProof } from "./controlled-provider-zero-policy";
export const closeControlledZeroProviderResource=defineService({name:"invoicing.closeControlledZeroProviderResource",summary:"Retain actual canceled zero-only transport and complete terminal zero-invoice proof, independently of paid access or a caller stop.",
 kind:"mutation",permission:"scoped",stepUp:true,writeClass:"money",input:z.object({resourceId:z.uuid()}),output:z.object({closed:z.literal(true)}),handler:async({resourceId},ctx)=>{
  await lockContactIdentityForRead(ctx.tx);await requireControlledProviderSchema(ctx);await ctx.tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`controlled-provider:${resourceId}`}))`);
  const[resource]=await ctx.tx.select().from(subscriptionControlledResources).where(eq(subscriptionControlledResources.id,resourceId)).limit(1).for("update");
  if(!resource)throw new ServiceError("not_found","There is no such original controlled provider resource.");
  const history=await controlledProviderJournal(ctx.tx,resource.id);
  if(history.closures.length)return{closed:true as const};
  const proof=controlledZeroTransportProof(history,resource.originalScope.currency);
  if(!proof)throw new ServiceError("conflict","Cancel and independently enumerate every original zero-only invoice/payment. Retain any unknown caller, positive money, open draft or changed balance for authentic financial recovery; it cannot be erased by a zero transport closure.");
  if(history.count>=5000)throw new ServiceError("conflict","Restore the complete bounded original financial inventory before retaining its closure.");
  await ctx.tx.execute(sql`select set_config('freeholder.controlled_provider_v1','1',true)`);
  await ctx.tx.insert(subscriptionControlledClosures).values({resourceId,kind:"zero_transport",originalEvidenceRevision:history.revision,proof,proofDigest:merchantTaxDigest(proof)});
  ctx.setSubject("subscription",resource.subscriptionId);return{closed:true as const};
 }});
