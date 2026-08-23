// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// One registry export for the convergent money module (C5.02-C5.05).

import invoiceServices from "./invoice-service";
import advancedMoneyServices from "./advanced-money-service";
import paymentProviderServices from "./payment-provider-service";
import posServices from "./pos-service";
import taxServices from "./tax-service";

export { quoteTax } from "./tax-service";

import briefingContributors from "@/modules/invoicing/briefing";

import recurringServices from "./recurring-service";

export default [
  ...recurringServices,
  ...briefingContributors,
  ...taxServices,
  ...invoiceServices,
  ...advancedMoneyServices,
  ...paymentProviderServices,
  ...posServices,
];
