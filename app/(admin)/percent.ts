// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Owners type percentages; services store parts per million so rounding is
// exact. The conversion lives here so no form asks a person for "100000"
// when they mean 10%.
import { ServiceError } from "@/core/service";

/** "12.5" → 125000. Up to four decimal places, 0–100%. */
export function percentToPpm(value: string): number {
  const match = /^(0|[1-9]\d*)(?:[.,](\d{1,4}))?$/.exec(value.trim().replace(/%$/, "").trim());
  if (!match) {
    throw new ServiceError("validation", "Enter a percentage such as 10 or 12.5.");
  }
  const ppm = Number(match[1]) * 10_000 + Number((match[2] ?? "").padEnd(4, "0"));
  if (ppm > 1_000_000) {
    throw new ServiceError("validation", "A discount cannot be more than 100%.");
  }
  return ppm;
}
