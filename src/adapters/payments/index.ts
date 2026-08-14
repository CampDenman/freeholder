// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0

import { AdapterRegistry } from "../registry";
import { createNoPayments } from "./none";
import type { PaymentAdapter } from "./types";

export * from "./types";
export { createNoPayments } from "./none";
export const paymentAdapters = new AdapterRegistry<PaymentAdapter>("payments", [
  createNoPayments(),
]);
