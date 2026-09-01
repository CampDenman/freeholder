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
// Claims this module's room in the customer portal (C8.11). Imported for
// its side effect: core owns the registry so it never imports a module,
// and something has to make the claim at load time.
import "./portal";
// Revenue by place (§4.7, C9.08).
import "./reporting";
// The funnel stages this module answers for (§4.7, C9.07).
import "./funnel";

export default [
  ...recurringServices,
  ...briefingContributors,
  ...taxServices,
  ...invoiceServices,
  ...advancedMoneyServices,
  ...paymentProviderServices,
  ...posServices,
];
