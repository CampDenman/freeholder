// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0

import { AdapterRegistry } from "../registry";
import { createNoTax } from "./none";
import type { TaxAdapter } from "./types";

export * from "./types";
export { createNoTax } from "./none";
export const taxAdapters = new AdapterRegistry<TaxAdapter>("tax", [createNoTax()]);
