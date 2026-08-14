// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0

import { AdapterRegistry } from "../registry";
import { createNoCarrier } from "./none";
import type { CarrierAdapter } from "./types";

export * from "./types";
export { createNoCarrier } from "./none";
export const carrierAdapters = new AdapterRegistry<CarrierAdapter>("carrier", [
  createNoCarrier(),
]);
