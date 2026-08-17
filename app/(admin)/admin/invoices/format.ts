// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Integer-safe display helpers for the invoice and tax admin workspace.

import { minorToDecimal } from "@/adapters/payments/currency";

export function money(amountMinor: number, currency: string): string {
  return `${currency} ${minorToDecimal(amountMinor, currency)}`;
}

export function quantityFromMicros(micros: number): string {
  const whole = Math.trunc(micros / 1_000_000);
  const fraction = String(Math.abs(micros % 1_000_000)).padStart(6, "0").replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : String(whole);
}

export function formatPpm(ppm: number): string {
  const whole = Math.trunc(ppm / 10_000);
  const fraction = String(Math.abs(ppm % 10_000)).padStart(4, "0").replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}%` : `${whole}%`;
}

export const INVOICE_STATUSES = [
  "draft",
  "sent",
  "viewed",
  "partially_paid",
  "paid",
  "overdue",
  "void",
  "refunded",
] as const;

export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

export function invoiceTone(
  status: string,
): "success" | "warning" | "danger" | "neutral" {
  if (status === "paid") return "success";
  if (status === "overdue" || status === "void") return "danger";
  if (status === "draft" || status === "partially_paid") return "warning";
  return "neutral";
}
