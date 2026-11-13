// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// One registry export for the convergent money module (C5.02-C5.05).

import prorationPaymentReadServices from "@/modules/subscriptions/proration-card-read-runtime";
import prorationPaymentReadRecoveryServices from "@/modules/subscriptions/proration-card-read-recovery";
import legacyBankReadServices from "./legacy-bank-read-service";
import creditDispositionServices from "./credit-disposition";
import creditApplicationServices from "./credit-application-service";
import commercialAttestationServices from "./commercial-attestations";
import agreementFeeServices from "./agreement-fee-service";
import principalAuthorityServices from "./principal-authority";
import invoiceServices from "./invoice-service";
import buyerMoneyErasureServices from "./buyer-money-erasure";
import originalRefundRepairServices from "./merchant-refund-privacy-repair";
export { onOriginalMerchantRefundEvidence } from "./merchant-refund-privacy-repair";
import merchantRefundBasisServices from "./merchant-refund-basis";
import originalRefundPhaseServices0 from "./merchant-refund-request";
import originalRefundPhaseServices1 from "./merchant-refund-dispatch";
import originalRefundPhaseServices2 from "./merchant-refund-observations";
import originalRefundPhaseServices3 from "./merchant-refund-execution";
import originalRefundPhaseServices4 from "./merchant-cash-return-service";
import originalRefundPhaseServices5 from "./merchant-subscription-disposition";
import originalRefundCurrentServices from "./merchant-refund-current-service";
import originalRefundProviderServices from "./merchant-refund-provider-events";
import bankReplacementServices from "./merchant-bank-replacement-service";
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
import originalSubscriptionCashServices from "@/modules/subscriptions/provider-charge-services";
import originalSubscriptionScopeServices from "@/modules/subscriptions/provider-webhook-scope";
import merchantTaxQuiescenceServices from "@/modules/subscriptions/merchant-tax-quiescence-services";
import merchantFeeServices from "./merchant-fee-service";
import {siteMerchantTaxServices} from "./merchant-tax-profiles";
import {siteMerchantTaxThresholds} from "./merchant-tax-thresholds";
import {siteMerchantTaxExemptionServices} from "./merchant-tax-exemptions";
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
  ...prorationPaymentReadServices,
  ...prorationPaymentReadRecoveryServices,
  ...commercialAttestationServices,
  ...principalAuthorityServices,
  ...agreementFeeServices,
  ...creditDispositionServices,
  ...creditApplicationServices,
  ...legacyBankReadServices,
  ...buyerMoneyErasureServices,
  ...originalRefundRepairServices,
  ...merchantRefundBasisServices,
  ...originalRefundPhaseServices0,
  ...originalRefundPhaseServices1,
  ...originalRefundPhaseServices2,
  ...originalRefundPhaseServices3,
  ...originalRefundPhaseServices4,
  ...originalRefundPhaseServices5,
  ...originalRefundCurrentServices,
  ...originalRefundProviderServices,
  ...bankReplacementServices,
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
  siteMerchantTaxThresholds,
  ...siteMerchantTaxExemptionServices,
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
