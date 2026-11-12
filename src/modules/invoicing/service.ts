// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// One registry export for the convergent money module (C5.02-C5.05).

import invoiceServices from "./invoice-service";
import marketPolicyServices from "./market-policy";
import merchantAllocationServices from "./merchant-allocations";
import merchantCollectionServices from "./merchant-collection";
import merchantPaymentObservationServices from "./merchant-payment-observations";
import merchantTaxServices from "./merchant-tax";
import merchantInvoiceScopeServices from "./merchant-invoice-scope";
import merchantPaymentReviewServices from "./merchant-payment-review";
import merchantPaymentRecoveryServices from "./merchant-payment-recovery";
import merchantPaymentRequestServices from "./merchant-payment-request";
import merchantPaymentDebtServices from "./merchant-payment-debt";
import merchantSubscriptionApplicationServices from "./merchant-subscription-application";
import originalSubscriptionCashServices from "@/modules/subscriptions/provider-charge-receipts";
import originalSubscriptionScopeServices from "@/modules/subscriptions/provider-webhook-scope";
import merchantTaxQuiescenceServices from "@/modules/subscriptions/merchant-tax-quiescence";
import merchantFeeServices from "./merchant-fee-service";
import {siteMerchantTaxServices} from "./merchant-tax-profiles";
import merchantSettlementServices from "./merchant-settlement";
import advancedMoneyServices from "./advanced-money-service";
import paymentProviderServices from "./payment-provider-service";
import posServices from "./pos-service";
import taxServices from "./tax-service";
import customerServices from "./customer-service";

export { quoteTax } from "./tax-service";

import briefingContributors from "@/modules/invoicing/briefing";

import recurringServices from "./recurring-service";
import demoServices from "./demo";
// Claims this module's room in the customer portal (C8.11). Imported for
// its side effect: core owns the registry so it never imports a module,
// and something has to make the claim at load time.
import "./portal";
// Revenue by place (§4.7, C9.08).
import "./reporting";
// The funnel stages this module answers for (§4.7, C9.07).
import "./funnel";

export default [
  ...marketPolicyServices,
  ...merchantAllocationServices,
  ...merchantCollectionServices,
  ...merchantPaymentObservationServices,
  ...merchantFeeServices,
  ...merchantPaymentReviewServices,
  ...merchantPaymentRecoveryServices,
  ...merchantPaymentRequestServices,
  ...merchantPaymentDebtServices,
  ...merchantSubscriptionApplicationServices,
  ...merchantInvoiceScopeServices,
  ...merchantTaxServices,
  ...originalSubscriptionCashServices,
  ...originalSubscriptionScopeServices,
  ...merchantTaxQuiescenceServices,
  ...siteMerchantTaxServices,
  ...merchantSettlementServices,
  ...demoServices,
  ...recurringServices,
  ...briefingContributors,
  ...taxServices,
  ...invoiceServices,
  ...advancedMoneyServices,
  ...paymentProviderServices,
  ...posServices,
  ...customerServices,
];
