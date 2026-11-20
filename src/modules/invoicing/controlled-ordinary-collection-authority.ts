// Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0
// C12.38: an ordinary method cannot borrow controlled pay_invoice permission.
import { z } from "zod";
import { getService,ServiceError,type ServiceContext } from "@/core/service";
import type { ControlledOrdinaryCollectionParent } from "./controlled-ordinary-collection-parent";
import { CONTROLLED_FINANCIAL_PROTOCOL,requireControlledFinancialProtocol } from "./controlled-provider-financial-protocol";
const authority=z.object({allowed:z.literal(true),revision:z.string().regex(/^[a-f0-9]{64}$/)}).strict();
/** Deliberately no permissive fallback. A registered producer/reader for real
 * terminal/alternative disposition is required; none is manufactured here.
 * Read-only invoice balances and application of already retained signed cash
 * do not invoke this prospective new-money admission helper. */
export async function requireControlledOrdinaryCollectionAuthority(ctx:ServiceContext,parent:ControlledOrdinaryCollectionParent|null,request:{provider:string;method:string;paymentId?:string}){
 if(!parent)return null;
 await requireControlledFinancialProtocol(ctx.tx);
 const reader=getService("invoicing.controlledProviderOrdinaryCollectionAuthority");
 if(!reader)throw new ServiceError("conflict","Recover this exact controlled bank target's actual terminal inventory, original callers and reviewed alternative-collection disposition before using another payment path.");
 return authority.parse(await ctx.callAsSystem(reader,{collectionId:parent.collectionId,invoiceId:parent.invoiceId,requiredProtocol:CONTROLLED_FINANCIAL_PROTOCOL,
  provider:request.provider,method:request.method,...(request.paymentId?{paymentId:request.paymentId}:{})}));
}
