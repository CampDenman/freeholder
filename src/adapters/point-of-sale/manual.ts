// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Cash and owner-attested in-person tender. No card data enters Freeholder.

import type { PointOfSaleAdapter } from "./types";

export function createManualPointOfSale(): PointOfSaleAdapter {
  return {
    id: "manual",
    status: {
      family: "point_of_sale",
      id: "manual",
      available: true,
      message: "Cash and owner-attested in-person payments can be recorded at a location.",
    },
    capabilities: () => ({
      countertop: false,
      tapToPay: false,
      cashRecording: true,
      refunds: true,
    }),
    async collect(request) {
      return {
        providerRef: `pos-cash:${request.idempotencyKey}`,
        status: "succeeded",
      };
    },
    async refund(request) {
      return { providerRef: `pos-cash-refund:${request.idempotencyKey}`, status: "succeeded" };
    },
    async verifyWebhook() {
      return [];
    },
  };
}
