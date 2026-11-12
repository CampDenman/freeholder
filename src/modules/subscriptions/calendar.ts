// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C9.13/C12.38: one calendar for accepted quotations and actual period invoices.
export function periodEnd(from: Date, interval: "day" | "week" | "month" | "year", count: number): Date {
  const end = new Date(from.getTime());
  if (interval === "day") end.setUTCDate(end.getUTCDate() + count);
  else if (interval === "week") end.setUTCDate(end.getUTCDate() + 7 * count);
  else if (interval === "year") end.setUTCFullYear(end.getUTCFullYear() + count);
  else {
    const day = end.getUTCDate();
    end.setUTCDate(1);
    end.setUTCMonth(end.getUTCMonth() + count);
    const lastOfMonth = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() + 1, 0)).getUTCDate();
    end.setUTCDate(Math.min(day, lastOfMonth));
  }
  return end;
}
