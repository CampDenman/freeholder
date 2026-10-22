// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Owners type percentages; services store parts per million so rounding is
// exact. The conversion lives here so no form asks a person for "100000"
// when they mean 10%.
import { ServiceError } from "@/core/service";
import type { Translate } from "@/core/i18n";

/** Arabic-Indic (٠–٩) and Eastern Arabic-Indic (۰–۹) digits, and the Arabic decimal separator. */
function asciiDigits(value: string): string {
  return value
    .replace(/[٠-٩]/g, (digit) => String(digit.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (digit) => String(digit.charCodeAt(0) - 0x06f0))
    .replace(/٫/g, ".")
    .replace(/[٪%]/g, "");
}

/** "12.5" → 125000. Up to four decimal places, 0–100%. */
export function percentToPpm(value: string, t: Translate): number {
  const match = /^(0|[1-9]\d*)(?:[.,](\d{1,4}))?$/.exec(asciiDigits(value).trim());
  if (!match) {
    throw new ServiceError("validation", t("admin.percent.invalid"));
  }
  const ppm = Number(match[1]) * 10_000 + Number((match[2] ?? "").padEnd(4, "0"));
  if (ppm > 1_000_000) {
    throw new ServiceError("validation", t("admin.percent.tooHigh"));
  }
  return ppm;
}

/** 125000 → "12.5", for a percent field's default value. */
export function ppmToPercent(ppm: number): string {
  return String(ppm / 10_000);
}
