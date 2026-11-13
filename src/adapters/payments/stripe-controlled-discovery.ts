// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.38: complete actual original-namespace discovery is read-only, never a new POST or invented finish.
import { AdapterError } from "../types";
import { object,text } from "./http";
import { validateMerchantChargeScope } from "./stripe-merchant-scope";
import type { PaymentAccountScope } from "./types";
import type { MerchantControlledBootstrapDiscoveryRequest } from "./merchant-controlled-subscription-types";
type Api=(path:string,init:RequestInit,scope:PaymentAccountScope)=>Promise<Record<string,unknown>>;
function unproven():never{throw new AdapterError("payments","stripe","provider_failure","Restore complete actual original controlled-resource discovery. An absent/later row cannot prove an earlier caller finished or refused creation.",true);}
const ref=(value:unknown)=>text(value)??text(object(value)?.id);
export function stripeControlledDiscovery(api:Api){return{
 async discoverMerchantControlledBootstrap(request:MerchantControlledBootstrapDiscoveryRequest):Promise<{complete:true;matches:Array<{providerSubscriptionRef:string;providerInvoiceRef:string|null}>}>{
  validateMerchantChargeScope(request);if(request.providerApiVersion!=="2026-10-28.endive"||!request.providerPlatformAccountId||!/^cus_[A-Za-z0-9_]+$/.test(request.providerCustomerRef)||!/^([a-f0-9]{64})$/.test(request.bootstrapRequestDigest))unproven();
  let cursor:string|undefined,complete=false;const seen=new Set<string>(),matches:Array<{providerSubscriptionRef:string;providerInvoiceRef:string|null}>=[];
  for(let page=0;page<20;page++){
   const query=new URLSearchParams({customer:request.providerCustomerRef,status:"all",limit:"100",...(cursor?{starting_after:cursor}:{})});
   const raw=await api(`/v1/subscriptions?${query}`,{method:"GET"},request);await request.onObserved({kind:"subscription_list_read",raw});
   if(!Array.isArray(raw.data)||typeof raw.has_more!=="boolean")unproven();
   for(const value of raw.data){const sub=object(value),id=ref(sub?.id),tag=object(sub?.metadata);if(!sub||!id||seen.has(id))unproven();seen.add(id);if(seen.size>5000)unproven();
    if(tag?.freeholder_bootstrap_operation_id!==request.bootstrapOperationId)continue;
    if(tag.freeholder_bootstrap_request_digest!==request.bootstrapRequestDigest||tag.freeholder_subscription_id!==request.subscriptionId||tag.freeholder_subscription_terms_id!==request.termsId
      ||tag.freeholder_controlled_generation!==String(request.generation)||tag.freeholder_controlled_subscription_version!=="1"||tag.freeholder_platform_account_id!==request.providerPlatformAccountId
      ||ref(sub.customer)!==request.providerCustomerRef||!/^sub_[A-Za-z0-9_]+$/.test(id))unproven();
    matches.push({providerSubscriptionRef:id,providerInvoiceRef:ref(sub.latest_invoice)??null});
   }
   if(!raw.has_more){complete=true;break;}const next=ref(raw.data.at(-1));if(!next||next===cursor)unproven();cursor=next;
  }
  if(!complete)unproven();return{complete:true,matches};
 }
};}
