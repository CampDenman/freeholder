// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0

import { AdapterRegistry } from "../registry";
import { createNoPointOfSale } from "./none";
import type { PointOfSaleAdapter } from "./types";

export * from "./types";
export { createNoPointOfSale } from "./none";
export const pointOfSaleAdapters = new AdapterRegistry<PointOfSaleAdapter>(
  "point_of_sale",
  [createNoPointOfSale()],
);
