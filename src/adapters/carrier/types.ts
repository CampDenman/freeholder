// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Live-rate, label, and tracking provider boundary (MASTER.md §4.11, C5.01).

import type { AdapterStatus, RawProviderRequest } from "../types";

export interface Parcel {
  weightGrams: number;
  lengthMillimetres: number;
  widthMillimetres: number;
  heightMillimetres: number;
}

export interface CarrierAddress {
  name: string;
  street1: string;
  street2?: string;
  city: string;
  region?: string;
  postalCode: string;
  country: string;
  phone?: string;
  email?: string;
}

export interface CarrierRate {
  provider: string;
  service: string;
  label: string;
  currency: string;
  amountMinor: number;
  estimatedDays?: { min: number; max: number };
  quoteRef: string;
  expiresAt?: string;
}

export interface ShippingLabel {
  providerRef: string;
  trackingNumber: string;
  trackingUrl?: string;
  labelUrl: string;
  format: "pdf" | "png" | "zpl";
}

export interface CarrierProviderEvent {
  id: string;
  providerRef: string;
  trackingNumber: string;
  status: "pre_transit" | "in_transit" | "delivered" | "exception" | "returned";
  occurredAt: string;
}

export interface CarrierAdapter {
  readonly id: string;
  readonly status: AdapterStatus;
  quote(input: { from: CarrierAddress; to: CarrierAddress; parcels: readonly Parcel[]; currency: string }): Promise<readonly CarrierRate[]>;
  buyLabel(input: { rate: CarrierRate; from: CarrierAddress; to: CarrierAddress; parcels: readonly Parcel[]; idempotencyKey: string }): Promise<ShippingLabel>;
  voidLabel(input: { providerRef: string; idempotencyKey: string }): Promise<void>;
  verifyWebhook(request: RawProviderRequest): Promise<readonly CarrierProviderEvent[]>;
}
