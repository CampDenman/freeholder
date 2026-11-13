// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C11.10/C12.38: compose registration only at module roots. Ordinary cash and
// reader-recovery definitions never import this collector during initialization.
import providerChargeReceiptServices from "./provider-charge-receipts";
import originalMerchantInvoiceServices from "./merchant-terms-invoice";
import providerPhaseServices from "./provider-phase-quote";
import providerPeriodServices from "./provider-periods";

export default [
  ...providerChargeReceiptServices,
  ...originalMerchantInvoiceServices,
  ...providerPhaseServices,
  ...providerPeriodServices,
];
