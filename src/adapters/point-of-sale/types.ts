// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// In-person tender boundary. Raw card data never enters Freeholder.

import type { AdapterStatus, RawProviderRequest } from "../types";

export interface PointOfSaleCapabilities {
  countertop: boolean;
  tapToPay: boolean;
  cashRecording: boolean;
  refunds: boolean;
}

export interface PointOfSalePaymentRequest {
  invoiceId: string;
  locationId: string;
  currency: string;
  amountMinor: number;
  idempotencyKey: string;
  readerRef?: string;
}

export interface PointOfSalePayment {
  providerRef: string;
  status: "requires_reader" | "processing" | "succeeded" | "failed";
  readerActionToken?: string;
}

export interface PointOfSaleProviderEvent {
  id: string;
  providerRef: string;
  kind: "payment_succeeded" | "payment_failed" | "refund_succeeded" | "refund_failed";
  occurredAt: string;
}

export interface PointOfSaleAdapter {
  readonly id: string;
  readonly status: AdapterStatus;
  capabilities(): PointOfSaleCapabilities;
  collect(request: PointOfSalePaymentRequest): Promise<PointOfSalePayment>;
  refund(request: { providerRef: string; currency: string; amountMinor: number; idempotencyKey: string }): Promise<{ providerRef: string; status: "pending" | "succeeded" | "failed" }>;
  verifyWebhook(request: RawProviderRequest): Promise<readonly PointOfSaleProviderEvent[]>;
}
