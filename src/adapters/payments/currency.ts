// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// ISO-4217 exponent handling at provider text boundaries. Core stays in minor units.

import { AdapterError } from "../types";

const ZERO_DECIMAL = new Set([
  "BIF", "CLP", "DJF", "GNF", "ISK", "JPY", "KMF", "KRW", "PYG",
  "RWF", "UGX", "VND", "VUV", "XAF", "XOF", "XPF",
]);
const THREE_DECIMAL = new Set([
  "BHD", "IQD", "JOD", "KWD", "LYD", "OMR", "TND",
]);
const FOUR_DECIMAL = new Set(["CLF", "UYW"]);

export function currencyExponent(currency: string): number {
  const code = currency.toUpperCase();
  if (!/^[A-Z]{3}$/.test(code)) {
    throw new AdapterError("payments", "currency", "invalid_request", "Currency must be a three-letter ISO code.");
  }
  if (ZERO_DECIMAL.has(code)) return 0;
  if (THREE_DECIMAL.has(code)) return 3;
  if (FOUR_DECIMAL.has(code)) return 4;
  return 2;
}

export function minorToDecimal(amountMinor: number, currency: string): string {
  if (!Number.isSafeInteger(amountMinor) || amountMinor < 0) {
    throw new AdapterError("payments", "currency", "invalid_request", "Payment amount must be a safe non-negative integer.");
  }
  const exponent = currencyExponent(currency);
  if (exponent === 0) return String(amountMinor);
  const digits = String(amountMinor).padStart(exponent + 1, "0");
  return `${digits.slice(0, -exponent)}.${digits.slice(-exponent)}`;
}

export function decimalToMinor(value: string, currency: string): number {
  const exponent = currencyExponent(currency);
  const match = /^(0|[1-9]\d*)(?:\.(\d+))?$/.exec(value);
  if (!match || (match[2]?.length ?? 0) > exponent) {
    throw new AdapterError("payments", "currency", "invalid_request", "Provider returned an invalid currency amount.");
  }
  const whole = match[1]!;
  const fraction = (match[2] ?? "").padEnd(exponent, "0");
  const amount = Number(`${whole}${fraction}`);
  if (!Number.isSafeInteger(amount)) {
    throw new AdapterError("payments", "currency", "invalid_request", "Provider returned an unsafe currency amount.");
  }
  return amount;
}
