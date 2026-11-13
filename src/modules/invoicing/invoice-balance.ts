// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C9.33/C12.38: actual cash and applied original credit settle one invoice separately.
import { ServiceError } from "@/core/service";
type InvoiceBalance = { totalMinor: number; paidMinor: number; creditedMinor?: number };
export function invoiceOutstanding(invoice: InvoiceBalance): number {
  const credit = invoice.creditedMinor ?? 0;
  if (![invoice.totalMinor, invoice.paidMinor, credit].every(value => Number.isSafeInteger(value) && value >= 0)) throw new ServiceError("conflict", "Restore the actual invoice cash and original applied-credit balance.");
  const due = BigInt(invoice.totalMinor) - BigInt(invoice.paidMinor) - BigInt(credit);
  if (due < 0n) throw new ServiceError("conflict", "The invoice cash and applied original credit exceed its actual amount.");
  return Number(due);
}
export function invoiceSettled(invoice: InvoiceBalance): boolean { return invoiceOutstanding(invoice) === 0; }
