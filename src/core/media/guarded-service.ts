// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C1.12/C11.08: explicit current media entry; permission/audit remain shared.
import type {z} from "zod";
import {defineService,type ServiceDef} from "@/core/service";
import {allowMediaReceiptWrites} from "./write-ledger";
import {assertMediaActorLive} from "./upload-ownership";
import {lockContactIdentityForRead} from "@/core/contacts/identity-lock";
export function defineMediaService<In extends z.ZodType,Out>(definition:ServiceDef<In,Out>){
 return defineService({...definition,handler:async(input,ctx)=>{
  await lockContactIdentityForRead(ctx.tx);
  await assertMediaActorLive(ctx.tx,ctx.actor);
  await allowMediaReceiptWrites(ctx.tx);
  return definition.handler(input,ctx);
 }});
}
