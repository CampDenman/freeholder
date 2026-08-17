// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0

import { AdapterRegistry } from "../registry";
import { createManualPointOfSale } from "./manual";
import { createNoPointOfSale } from "./none";
import { createStripePointOfSale } from "./stripe";
import type { PointOfSaleAdapter } from "./types";

export * from "./types";
export { createNoPointOfSale } from "./none";
export { createManualPointOfSale } from "./manual";
export { createStripePointOfSale } from "./stripe";
export const pointOfSaleAdapters = new AdapterRegistry<PointOfSaleAdapter>(
  "point_of_sale",
  [createNoPointOfSale(), createManualPointOfSale(), createStripePointOfSale()],
);

export function pointOfSaleAdapter(id: string): PointOfSaleAdapter {
  return pointOfSaleAdapters.get(id);
}
