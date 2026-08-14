// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// One registry export for the convergent money module (C5.02-C5.05).

import invoiceServices from "./invoice-service";
import taxServices from "./tax-service";

export { quoteTax } from "./tax-service";

export default [...taxServices, ...invoiceServices];
