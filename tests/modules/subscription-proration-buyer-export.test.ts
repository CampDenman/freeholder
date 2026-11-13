// Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0
// C1.08/C12.38: PREPARED / UNRUN buyer archive minimization controls.
import { describe,expect,it } from "vitest";
import { buyerAcceptedProration,type BuyerProrationSource } from "@/modules/subscriptions/proration-buyer-export";
const id=(n:number)=>`10000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
const date=(day:number)=>new Date(`2026-11-${String(day).padStart(2,"0")}T00:00:00.000Z`);
const marker="private-financial-canary";
function original(){
 const snapshot={version:1 as const,name:"Accepted buyer plan",description:"Buyer legal description",productVariantId:id(4),taxCategoryCode:"digital",requiresShipping:false,
  currency:"CAD",periodAmountMinor:2400,setupFeeMinor:100,interval:"month" as const,intervalCount:1,trialDays:7,trialRequiresCard:true,cancelBehaviour:"period_end" as const,proration:"create_prorations" as const,billingMode:"provider" as const,
  siteFeeBps:marker,feeReview:{sources:[{evidence:marker}]},review:{provider:{account:marker,method:marker},hosting:{body:marker}},unknown:{nested:{private:marker}}};
 const taxDestination={country:"CA",region:"BC",postalCode:"V0R 1T0",city:"Denman Island",privateBank:marker};
 const noticeSnapshot={locale:"fr" as const,text:"Accepted buyer notice",actorEvidence:{hosting:marker}};
 const row={id:id(1),subscriptionId:id(2),planId:id(3),previousTermsId:id(5),termsId:id(6),snapshot,taxDestination,noticeSnapshot,
  effectiveAt:date(15),originalPeriodStart:date(1),originalPeriodEnd:date(30),originalTrialEndsAt:null,proposedPeriodStart:date(15),proposedPeriodEnd:date(30),
  originalInvoiceId:id(7),originalInvoiceLineId:id(8),debitInvoiceId:id(9),creditNoteId:id(10),debitNetMinor:1200,debitTaxMinor:60,creditNetMinor:600,creditTaxMinor:30,
  state:"awaiting_payment" as const,appliedAt:null,cancelledAt:null,createdAt:date(13),acceptedBy:marker,originalTask:{queueBody:marker},sourceActor:{private:marker}};
 const invoice={id:id(9),currency:"CAD",totalMinor:1260,paidMinor:200,creditedMinor:630,refundedMinor:50,providerCustomer:marker};
 return{row,invoice};
}
describe("accepted proration buyer financial projection",()=>{
 it("retains actual buyer IDs, legal terms, calendar, consideration and status while excluding nested private keys",()=>{
  const{row,invoice}=original(),before=JSON.stringify({row,invoice}),projected=buyerAcceptedProration(row,invoice);
  const accepted:BuyerProrationSource=row;
  expect(projected).toEqual({id:accepted.id,subscriptionId:accepted.subscriptionId,planId:accepted.planId,previousTermsId:accepted.previousTermsId,termsId:accepted.termsId,
   snapshot:{version:1,name:"Accepted buyer plan",description:"Buyer legal description",productVariantId:id(4),taxCategoryCode:"digital",requiresShipping:false,currency:"CAD",periodAmountMinor:2400,setupFeeMinor:100,
    interval:"month",intervalCount:1,trialDays:7,trialRequiresCard:true,cancelBehaviour:"period_end",proration:"create_prorations",billingMode:"provider"},
   taxDestination:{country:"CA",region:"BC",postalCode:"V0R 1T0",city:"Denman Island"},noticeSnapshot:{locale:"fr",text:"Accepted buyer notice"},
   effectiveAt:row.effectiveAt,originalPeriodStart:row.originalPeriodStart,originalPeriodEnd:row.originalPeriodEnd,originalTrialEndsAt:null,proposedPeriodStart:row.proposedPeriodStart,proposedPeriodEnd:row.proposedPeriodEnd,
   originalInvoiceId:id(7),originalInvoiceLineId:id(8),debitInvoiceId:id(9),creditNoteId:id(10),debitNetMinor:1200,debitTaxMinor:60,creditNetMinor:600,creditTaxMinor:30,
   state:"awaiting_payment",appliedAt:null,cancelledAt:null,createdAt:row.createdAt,invoiceConsideration:{invoiceId:id(9),currency:"CAD",totalMinor:1260,paidMinor:200,creditedMinor:630,refundedMinor:50}});
  expect(JSON.stringify(projected)).not.toContain(marker);expect(JSON.stringify(projected)).not.toMatch(/feeReview|siteFee|sourceActor|acceptedBy|originalTask|hosting|queueBody|providerCustomer/);
  expect(JSON.stringify({row,invoice})).toBe(before);expect(before).toContain(marker);
 });
 it("retains genuine trial/null legal values without inventing a payment, invoice or credit amount",()=>{
  const{row}=original(),trial={...row,originalTrialEndsAt:row.originalPeriodEnd,taxDestination:null,originalInvoiceId:null,originalInvoiceLineId:null,debitInvoiceId:null,creditNoteId:null,
   debitNetMinor:0,debitTaxMinor:0,creditNetMinor:0,creditTaxMinor:0,snapshot:{...row.snapshot,description:null}};
  expect(buyerAcceptedProration(trial,null)).toMatchObject({originalTrialEndsAt:row.originalPeriodEnd,taxDestination:null,originalInvoiceId:null,debitInvoiceId:null,creditNoteId:null,
   debitNetMinor:0,debitTaxMinor:0,creditNetMinor:0,creditTaxMinor:0,invoiceConsideration:null,snapshot:{description:null}});
 });
 it("refuses a different actual invoice even when every financial amount is equal",()=>{
  const{row,invoice}=original();expect(()=>buyerAcceptedProration(row,{...invoice,id:id(99)})).toThrow("exact accepted proration invoice");
  expect(()=>buyerAcceptedProration(row,null)).toThrow("exact accepted proration invoice");
 });
 it("preserves actual applied/cancelled times and locale notice without exposing extra lifecycle bodies",()=>{
  const{row,invoice}=original();const applied={...row,state:"applied" as const,appliedAt:date(16)};
  expect(buyerAcceptedProration(applied,invoice)).toMatchObject({state:"applied",appliedAt:date(16),noticeSnapshot:{locale:"fr",text:"Accepted buyer notice"}});
  expect(buyerAcceptedProration({...row,state:"cancelled",cancelledAt:date(17)},invoice)).toMatchObject({state:"cancelled",cancelledAt:date(17)});
 });
});
