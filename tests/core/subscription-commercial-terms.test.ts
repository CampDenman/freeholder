// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
import { expect, it } from "vitest";
import { initialMerchantInvoiceAmounts, type SubscriptionCommercialSnapshot } from "@/modules/subscriptions/merchant-terms-contract";

const offer:SubscriptionCommercialSnapshot={version:1,name:"Original membership",description:null,
  productVariantId:"00000000-0000-4000-8000-000000000081",taxCategoryCode:"standard",requiresShipping:false,
  currency:"CAD",periodAmountMinor:2000,setupFeeMinor:500,interval:"month",intervalCount:1,trialDays:14,
  trialRequiresCard:false,cancelBehaviour:"period_end",proration:"none",billingMode:"platform"};

it("retains the accepted 500 setup fee for the 2500 first paid invoice after a no-card trial",()=>{
  const phase=initialMerchantInvoiceAmounts(offer,{deferFirstPayment:true,hasSavedMethod:false});
  expect(phase.trialing).toBe(true);
  expect(phase.periodAmountMinor+phase.setupFeeMinor).toBe(0);
  expect(offer.periodAmountMinor+phase.firstPaidSetupFeeMinor).toBe(2500);
});

it("requires the original 500 setup component before a card-required trial and never repeats it",()=>{
  const phase=initialMerchantInvoiceAmounts({...offer,trialRequiresCard:true},{deferFirstPayment:true,hasSavedMethod:false});
  expect(phase.awaitingCard).toBe(true);expect(phase.trialing).toBe(false);
  expect(phase.periodAmountMinor+phase.setupFeeMinor).toBe(500);
  expect(offer.periodAmountMinor+phase.firstPaidSetupFeeMinor).toBe(2000);
});

it("keeps the setup obligation exactly once across all supported trial admission phases",()=>{
  for(const trialRequiresCard of [false,true])for(const hasSavedMethod of [false,true]){
    const phase=initialMerchantInvoiceAmounts({...offer,trialRequiresCard},{deferFirstPayment:true,hasSavedMethod});
    expect(phase.setupFeeMinor+phase.firstPaidSetupFeeMinor).toBe(500);
    expect(phase.periodAmountMinor).toBe(0);
  }
});

it("quotes the complete initial 2500 when no trial was accepted, independent of a missing saved method",()=>{
  const phase=initialMerchantInvoiceAmounts({...offer,trialDays:0},{deferFirstPayment:true,hasSavedMethod:false});
  expect(phase.awaitingCard).toBe(false);expect(phase.trialing).toBe(false);
  expect(phase.periodAmountMinor+phase.setupFeeMinor).toBe(2500);
  expect(phase.firstPaidSetupFeeMinor).toBe(0);
});
