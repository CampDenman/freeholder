// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0

import { unavailable } from "../types";
import type { PointOfSaleAdapter } from "./types";

export function createNoPointOfSale(): PointOfSaleAdapter {
  const message = "In-person payment is not configured.";
  const failure = () => Promise.reject(unavailable("point_of_sale", "none", message));
  return {
    id: "none",
    status: { family: "point_of_sale", id: "none", available: false, message },
    capabilities: () => ({ countertop: false, tapToPay: false, cashRecording: false, refunds: false }),
    collect: failure,
    refund: failure,
    verifyWebhook: failure,
  };
}
