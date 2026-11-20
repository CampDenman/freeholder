// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
import { z } from "zod";
import { getService,ServiceError,type ServiceContext } from "@/core/service";
export const controlledTargetOperationKind=z.enum(["update_calendar","create_draft","add_invoice_component","read_manifest","set_invoice_fee","finalize_invoice","pay_invoice"]);
/** Current money/caller safety is separate from complete authenticated coverage.
 * Only an exact same owned planned operation with zero actual children may be
 * excluded, under the existing resource lock. No admitted read is excluded. */
export async function controlledTargetFinancialAuthority(ctx:ServiceContext,collectionId:string,kind:z.infer<typeof controlledTargetOperationKind>,excludeUnadmittedOperationId?:string){
 const reader=getService("invoicing.controlledProviderCollectionAuthority");
 if(!reader)throw new ServiceError("conflict","Restore current exact controlled-target original cash/refund/dispute/principal/caller authority before another bank operation.");
 return z.object({allowed:z.literal(true),revision:z.string().regex(/^[a-f0-9]{64}$/)}).parse(await ctx.callAsSystem(reader,{collectionId,kind,requiredProtocol:"controlled_net_gross.v1",...(excludeUnadmittedOperationId?{excludeUnadmittedOperationId}:{})}));
}
