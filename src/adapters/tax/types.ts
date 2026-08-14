// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// External tax-calculation seam; the built-in engine implements the same shape.

import type { AdapterStatus } from "../types";

export interface TaxAddress {
  country: string;
  region?: string;
  postalCode?: string;
  city?: string;
}

export interface TaxQuoteItem {
  id: string;
  /** Six-decimal fixed-point quantity. 1 unit = 1_000_000 micros. */
  quantityMicros: number;
  unitAmountMinor: number;
  discountMinor: number;
  category: string;
  requiresShipping: boolean;
}

export interface TaxQuoteRequest {
  currency: string;
  pricesIncludeTax: boolean;
  origin: TaxAddress;
  destination: TaxAddress;
  customer?: { contactId?: string; taxIds?: readonly string[]; exempt?: boolean };
  items: readonly TaxQuoteItem[];
  shippingMinor: number;
  occurredAt: string;
}

export interface QuotedTaxLine {
  itemId?: string;
  jurisdiction: string;
  name: string;
  /** Integer parts per million: 99_750 = 9.975%. */
  ratePartsPerMillion: number;
  taxableMinor: number;
  taxMinor: number;
  inclusive: boolean;
  compound: boolean;
  priority: number;
}

export interface TaxQuote {
  provider: string;
  currency: string;
  lines: readonly QuotedTaxLine[];
  totalTaxMinor: number;
  explanation: readonly string[];
}

export interface TaxAdapter {
  readonly id: string;
  readonly status: AdapterStatus;
  quote(request: TaxQuoteRequest): Promise<TaxQuote>;
}
