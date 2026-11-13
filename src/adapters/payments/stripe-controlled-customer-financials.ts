// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Actual original-customer balances/credit notes remain independently retained.
import { AdapterError } from "../types";
import { object,text } from "./http";
import { validateMerchantChargeScope } from "./stripe-merchant-scope";
import { controlledSubscriptionFactsDigest } from "./controlled-subscription-digest";
import type { PaymentAccountScope } from "./types";
import type { MerchantControlledSubscriptionReadRequest,MerchantControlledCustomerFinancialInventory } from "./merchant-controlled-subscription-types";
type Api=(path:string,init:RequestInit,scope:PaymentAccountScope)=>Promise<Record<string,unknown>>;
const ref=(value:unknown)=>text(value)??text(object(value)?.id);
function refuse():never{throw new AdapterError("payments","stripe","provider_failure","Retain complete actual original-customer balances and issued credit-note inventory. Unknown or unrelated credit cannot silently fund a canonical target or release its original principal promise.",true);}
const money=(value:unknown)=>typeof value==="number"&&Number.isSafeInteger(value);
function zeroMap(value:unknown){const map=object(value);return!!map&&Object.entries(map).every(([currency,amount])=>/^[a-z]{3}$/.test(currency)&&money(amount)&&amount===0);}
export function stripeControlledCustomerFinancials(api:Api){return{
 async inspectMerchantControlledCustomerFinancials(request:MerchantControlledSubscriptionReadRequest):Promise<MerchantControlledCustomerFinancialInventory>{
  validateMerchantChargeScope(request);if(request.providerApiVersion!=="2026-10-28.endive"||!/^cus_[A-Za-z0-9_]{1,195}$/.test(request.providerCustomerRef))refuse();
  const customer=await api(`/v1/customers/${encodeURIComponent(request.providerCustomerRef)}?expand%5B%5D=cash_balance`,{method:"GET"},request);
  await request.onObserved({kind:"customer_financial_read",raw:customer});
  if(customer.id!==request.providerCustomerRef||customer.deleted===true||customer.currency!==null&&customer.currency!==request.currency.toLowerCase())refuse();
  const cashBalance=object(customer.cash_balance),cashZero=customer.cash_balance===null||!!cashBalance&&ref(cashBalance.customer)===request.providerCustomerRef&&zeroMap(cashBalance.available);
  const balancesZero=money(customer.balance)&&customer.balance===0&&zeroMap(customer.invoice_credit_balance)&&cashZero;
  const creditNotes:Array<Record<string,unknown>>=[],issuedCreditNoteRefs:string[]=[],seen=new Set<string>(),cursors=new Set<string>();let cursor:string|undefined,complete=false;
  for(let page=0;page<50;page++){
   const query=new URLSearchParams({customer:request.providerCustomerRef,limit:"100",...(cursor?{starting_after:cursor}:{})});
   const actual=await api(`/v1/credit_notes?${query}`,{method:"GET"},request);await request.onObserved({kind:"customer_credit_notes_read",raw:actual});
   if(!Array.isArray(actual.data)||typeof actual.has_more!=="boolean")refuse();
   for(const value of actual.data){const note=object(value),id=ref(note?.id);
    if(!note||!id||!/^cn_[A-Za-z0-9_]{1,196}$/.test(id)||seen.has(id)||ref(note.customer)!==request.providerCustomerRef||!/^in_[A-Za-z0-9_]{1,196}$/.test(ref(note.invoice)??"")
     ||!["issued","void"].includes(String(note.status))||!money(note.amount)||Number(note.amount)<0||!money(note.credit_amount)||Number(note.credit_amount)<0||!/^[a-z]{3}$/.test(String(note.currency)))refuse();
    seen.add(id);creditNotes.push(note);if(note.status==="issued"&&Number(note.amount)>0)issuedCreditNoteRefs.push(id);if(creditNotes.length+1>5000)refuse();
   }
   if(!actual.has_more){complete=true;break;}const next=ref(actual.data.at(-1));if(!next||cursors.has(next))refuse();cursors.add(next);cursor=next;
  }
  if(!complete)refuse();
  // An issued promise remains owned even when a later aggregate balance is
  // zero. It requires original note/invoice/payment disposition, never amount
  // matching or a synthetic credit/refund. The normal empty/zero path is exact.
  return{providerCustomerRef:request.providerCustomerRef,currency:request.currency,completeCreditNotes:true,customer,creditNotes,
   balanceState:balancesZero&&!issuedCreditNoteRefs.length?"known_zero":"review",issuedCreditNoteRefs,
   inventoryDigest:controlledSubscriptionFactsDigest({customer,creditNotes}),suppliesPaidAuthority:false};
 },
};}
