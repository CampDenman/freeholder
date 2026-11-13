// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C1.08/C12.38: durable external erasure joins the module's resident runtime.
import {finishBuyerMoneyErasure} from "./buyer-money-erasure";
import {erasePaymentProviderCustomer} from "./provider-erasure";
import {reconcileOriginalMerchantFeeJob} from "./merchant-fee-service";
import {quiesceMerchantSchedules} from "@/modules/subscriptions/merchant-tax-quiescence";
import {reconcileMerchantScheduleErasure} from "@/modules/subscriptions/provider-schedule-erasure";
export default [finishBuyerMoneyErasure,erasePaymentProviderCustomer,reconcileOriginalMerchantFeeJob,quiesceMerchantSchedules,reconcileMerchantScheduleErasure];
