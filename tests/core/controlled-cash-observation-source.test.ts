// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// PREPARED/UNRUN. Exact original namespace identity is distinct from spending it.
import { randomUUID } from "node:crypto";
import { describe,it,expect } from "vitest";
import { cashObservationSourceMatches } from "@/modules/subscriptions/controlled-provider-cash-observation-source";
import type { ControlledCashEvidence } from "@/modules/subscriptions/controlled-provider-cash-origin";
const subscriptionId=randomUUID();
const receipt={subscriptionId,providerPlatformAccountId:"acct_original",chargeAccountId:null,providerSubscriptionRef:"sub_original",providerInvoiceRef:"in_original",providerPaymentIntentRef:"pi_original",providerChargeRef:"ch_original",amountMinor:1499,currency:"CAD"};
const cash=():ControlledCashEvidence=>({provider:"stripe",subscriptionId,providerPlatformAccountId:"acct_original",providerSubscriptionRef:"sub_original",providerInvoiceRef:"in_original",providerPaymentIntentRef:"pi_original",providerChargeRef:"ch_original",providerCustomerRef:"cus_original",amountMinor:1499,currency:"CAD",customerChargeVerified:true,merchantRouteVerified:true});
describe("authentic observational original cash identity",()=>{
 it("permits observation of an exact source without claiming canonical application",()=>{expect(cashObservationSourceMatches(receipt,cash())).toBe(true);});
 it("refuses equal cash in another subscription or invoice",()=>{expect(cashObservationSourceMatches(receipt,{...cash(),subscriptionId:randomUUID()})).toBe(false);expect(cashObservationSourceMatches(receipt,{...cash(),providerInvoiceRef:"in_foreign"})).toBe(false);});
 it("refuses present-account substitution or a foreign platform namespace",()=>{expect(cashObservationSourceMatches(receipt,{...cash(),providerAccountId:"acct_current"})).toBe(false);expect(cashObservationSourceMatches(receipt,{...cash(),providerPlatformAccountId:"acct_other"})).toBe(false);});
 it("requires the actual original subscription, PI and known charge, not an amount match",()=>{expect(cashObservationSourceMatches(receipt,{...cash(),providerSubscriptionRef:"sub_other"})).toBe(false);expect(cashObservationSourceMatches(receipt,{...cash(),providerPaymentIntentRef:"pi_other"})).toBe(false);expect(cashObservationSourceMatches(receipt,{...cash(),providerChargeRef:"ch_other"})).toBe(false);});
 it("does not clip changed actual cash or invent an FX conversion",()=>{expect(cashObservationSourceMatches(receipt,{...cash(),amountMinor:1500})).toBe(false);expect(cashObservationSourceMatches(receipt,{...cash(),currency:"USD"})).toBe(false);});
 it("allows a genuine debt-observing GET where customer/merchant route flags are false",()=>{expect(cashObservationSourceMatches(receipt,{...cash(),customerChargeVerified:false,merchantRouteVerified:false})).toBe(true);});
 it("does not invent an unknown original charge before the actual PI GET",()=>{const unknownCharge={...cash()};delete unknownCharge.providerChargeRef;expect(cashObservationSourceMatches({...receipt,providerChargeRef:null},unknownCharge)).toBe(true);});
});
