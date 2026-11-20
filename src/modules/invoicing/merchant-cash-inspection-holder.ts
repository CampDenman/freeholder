// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.38: the exact live original holder, shared by real read callbacks only.
import { createHash } from "node:crypto";
import { eq,sql } from "drizzle-orm";
import { ServiceError,type ServiceContext } from "@/core/service";
import { merchantCashReturnInspections,merchantCashReturnInspectionFinishes } from "./merchant-refund-schema";
import { merchantCashReturnInspectionStops } from "./merchant-cash-inspection-stop-schema";
import { merchantPhysicalCaller } from "./merchant-physical-caller";
export async function originalCashInspection(ctx:ServiceContext,inspectionId:string){const[row]=await ctx.tx.select().from(merchantCashReturnInspections).where(eq(merchantCashReturnInspections.id,inspectionId));if(!row)throw new ServiceError("conflict","Restore the actual original cash-return inspection before associating evidence.");return row;}
export async function cashInspectionHolder(ctx:ServiceContext,inspectionId:string,completionNonce:string,finishing=false){
 await ctx.tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`merchant-return-read:${inspectionId}`}))`);
 const row=await originalCashInspection(ctx,inspectionId),caller=merchantPhysicalCaller();
 const[stop]=await ctx.tx.select().from(merchantCashReturnInspectionStops).where(eq(merchantCashReturnInspectionStops.inspectionId,inspectionId)).limit(1);
 if(stop)throw new ServiceError("conflict","This original caller has an independent stopped-process receipt; a late callback or invented wrapper finish cannot change its evidence.");
 if(row.caller.id!==caller.id||row.completionNonceHash!==createHash("sha256").update(completionNonce).digest("hex"))throw new ServiceError("permission","Only this exact original admitted inspection caller can submit its private physical evidence.");
 const[finish]=await ctx.tx.select().from(merchantCashReturnInspectionFinishes).where(eq(merchantCashReturnInspectionFinishes.inspectionId,inspectionId)).limit(1);
 if(finish&&!finishing)throw new ServiceError("conflict","This exact original inspection already finished; a late callback cannot change its evidence or supersede a later actual read.");
 return row;
}
