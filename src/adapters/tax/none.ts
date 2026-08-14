// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0

import { unavailable } from "../types";
import type { TaxAdapter } from "./types";

export function createNoTax(): TaxAdapter {
  const message = "Tax calculation is not configured. Checkout cannot assume that tax is zero.";
  return {
    id: "none",
    status: { family: "tax", id: "none", available: false, message },
    quote() { return Promise.reject(unavailable("tax", "none", message)); },
  };
}
