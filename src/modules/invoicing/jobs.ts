// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C1.08/C12.38: durable external erasure joins the module's resident runtime.
import {erasePaymentProviderCustomer} from "./provider-erasure";
import {reconcileOriginalMerchantFeeJob} from "./merchant-fee-service";
export default [erasePaymentProviderCustomer,reconcileOriginalMerchantFeeJob];
