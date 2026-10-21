// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C10.26: platform-independent formatting of integer currency minor units.
export function formatMoney(minor: number, currency: string, locale: string): string {
  const formatter = new Intl.NumberFormat(locale, { style: "currency", currency });
  const exponent = formatter.resolvedOptions().maximumFractionDigits ?? 2;
  const digits = String(Math.abs(minor)).padStart(exponent + 1, "0");
  const decimal = exponent ? `${digits.slice(0, -exponent)}.${digits.slice(-exponent)}` : digits;
  return formatter.format(`${minor < 0 ? "-" : ""}${decimal}` as Intl.StringNumericLiteral);
}
