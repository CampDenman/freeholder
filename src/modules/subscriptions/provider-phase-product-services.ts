// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C11.10/C12.38: registration composition stays outside ordinary product readers.
import phaseProductServices from "./provider-phase-products";
import { quoteMerchantProviderHorizon } from "./provider-phase-quote";
import productRecoveryServices from "./provider-phase-product-recovery";

export default [...phaseProductServices, quoteMerchantProviderHorizon, ...productRecoveryServices];
