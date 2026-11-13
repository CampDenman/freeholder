// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// A separate public product labels merchant-declared tax collection; it is not Stripe Tax evidence.
import { AdapterError } from "../types";
import { object,text } from "./http";
import { validateMerchantChargeScope } from "./stripe-merchant-scope";
import type { PaymentAccountScope } from "./types";
import type { MerchantControlledProductRequest,MerchantControlledProductReadRequest } from "./merchant-controlled-subscription-types";
type Api=(path:string,init:RequestInit,scope:PaymentAccountScope)=>Promise<Record<string,unknown>>;
function invalid():never{throw new AdapterError("payments","stripe","provider_failure","Restore the actual original auxiliary merchant-tax collection product and independently admitted read.",true);}
function metadata(request:MerchantControlledProductRequest){
 validateMerchantChargeScope(request);
 if(request.providerApiVersion!=="2026-10-28.endive"||!request.providerPlatformAccountId||request.component!=="merchant_declared_tax_collection"||!request.name.trim()||request.name.length>500
  ||!/^([a-f0-9]{64})$/.test(request.requestDigest)||!request.idempotencyKey||request.idempotencyKey.length>200)invalid();
 return{freeholder_controlled_subscription_version:"1",freeholder_subscription_id:request.subscriptionId,freeholder_subscription_terms_id:request.termsId,freeholder_controlled_generation:String(request.generation),
  freeholder_platform_account_id:request.providerPlatformAccountId,freeholder_controlled_product_operation_id:request.operationId,freeholder_controlled_product_request_digest:request.requestDigest,freeholder_controlled_component:request.component};
}
export function stripeControlledProducts(api:Api){return{
 async createMerchantControlledTaxProduct(request:MerchantControlledProductRequest):Promise<{createdProductRef:string}>{
  const fields=metadata(request),form=new URLSearchParams({name:request.name,active:"true"});for(const[key,value]of Object.entries(fields))form.set(`metadata[${key}]`,value);
  const raw=await api("/v1/products",{method:"POST",headers:{"content-type":"application/x-www-form-urlencoded","idempotency-key":request.idempotencyKey},body:form},request);
  await request.onObserved({kind:"product_created",raw});
  const id=text(raw.id);if(!id||!/^prod_[A-Za-z0-9_]{1,195}$/.test(id))invalid();return{createdProductRef:id};
 },
 async inspectMerchantControlledTaxProduct(request:MerchantControlledProductReadRequest):Promise<{createdProductRef:string;component:"merchant_declared_tax_collection";taxAuthority:"canonical_merchant_tax_ledger"}>{
  const fields=metadata({...request,operationId:request.originalProductOperationId,requestDigest:request.originalProductRequestDigest});if(!/^prod_[A-Za-z0-9_]{1,195}$/.test(request.createdProductRef))invalid();
  const raw=await api(`/v1/products/${encodeURIComponent(request.createdProductRef)}`,{method:"GET"},request);await request.onObserved({kind:"product_read",raw});
  const tag=object(raw.metadata);if(raw.id!==request.createdProductRef||raw.active!==true||raw.name!==request.name||Object.entries(fields).some(([key,value])=>tag?.[key]!==value))invalid();
  return{createdProductRef:request.createdProductRef,component:request.component,taxAuthority:"canonical_merchant_tax_ledger"};
 }
};}
