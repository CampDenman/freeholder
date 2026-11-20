// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Parent-owned financial composition is a prerequisite for newly admitted controlled work.
import { z } from "zod";
import { getService,ServiceError,type ServiceContext } from "@/core/service";
export async function controlledFinancialReadiness(ctx:ServiceContext,subscriptionId:string,excludeUnadmittedOperationId?:string){
 const reader=getService("invoicing.controlledProviderFinancialReadiness");
 if(!reader)throw new ServiceError("conflict","Restore the complete original-cash/refund/principal namespace and controlled resource/caller/fact witnesses before admitting new provider work.");
 // The parent verifies any exclusion names this exact owned operation with no
 // actual caller, fact or origin children. Actual caller debt is never excluded.
 return z.object({ready:z.literal(true),revision:z.string().regex(/^[a-f0-9]{64}$/)}).parse(await ctx.callAsSystem(reader,{subscriptionId,...(excludeUnadmittedOperationId?{excludeUnadmittedOperationId}:{})}));
}
export const controlledWorkNeedsParentReadiness=(kind:string)=>["bootstrap","create_product","create_schedule","update_calendar","set_invoice_fee","finalize_invoice","pay_invoice"].includes(kind);

/** Extended coverage is an explicit ABI. The earlier nine-family parent query
 * rejects this field until all six genuine canonical-target families are wired.
 * Coverage readiness never declares principal, fee settlement or caller stop. */
export async function controlledCollectionReadiness(ctx:ServiceContext,subscriptionId:string,excludeUnadmittedOperationId?:string){
 const reader=getService("invoicing.controlledProviderFinancialReadiness");
 if(!reader)throw new ServiceError("conflict","Restore authenticated original financial coverage for the controlled canonical-target protocol before admitting any bank request.");
 return z.object({ready:z.literal(true),revision:z.string().regex(/^[a-f0-9]{64}$/)}).parse(await ctx.callAsSystem(reader,{subscriptionId,requiredProtocol:"controlled_net_gross.v1",...(excludeUnadmittedOperationId?{excludeUnadmittedOperationId}:{})}));
}
export const controlledWorkNeedsCollectionReadiness=(kind:string)=>["preview_proration","preview_update","update_calendar","create_draft","add_invoice_component","read_manifest","set_invoice_fee","finalize_invoice","pay_invoice"].includes(kind);
