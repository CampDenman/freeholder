// Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0
// C1.08/C12.38: compose the actual selected financial families under one bound.
import { ServiceError } from "@/core/service";

/** Each array contains actual exported rows. Nested family containers (such
 * as originalCash) are traversed, but row bodies and their private JSON are
 * never recursively counted or copied. Invoice bundles supply their arrays
 * explicitly, including the one actual invoice row. */
export function assertFinancialExportBound(...families: Readonly<Record<string, unknown>>[]): void {
  let count = 0;
  const visit = (family: Readonly<Record<string, unknown>>, depth: number) => {
    if (depth > 2) throw new ServiceError("conflict", "Restore the complete bounded original financial export.");
    for (const rows of Object.values(family)) {
      if (Array.isArray(rows)) count += rows.length;
      else if (rows !== null && typeof rows === "object" && Object.getPrototypeOf(rows) === Object.prototype) visit(rows as Record<string, unknown>, depth + 1);
      else throw new ServiceError("conflict", "Restore the complete bounded original financial export.");
      if (count > 5000) throw new ServiceError("conflict", "Restore the complete bounded original financial export before issuing the subject archive.");
    }
  };
  for (const family of families) visit(family, 0);
}
