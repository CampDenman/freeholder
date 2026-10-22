// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Currency, time-zone and language pickers. An owner should choose
// "Canadian Dollar" or "America/Vancouver" from a list, not type an ISO or
// IANA code from memory and learn about a typo from a validation error.
//
// Native selects on purpose (see `Select`): type-to-find works with the
// keyboard, phones show their own picker, and nothing needs JavaScript. The
// option lists are computed on the server and passed down as data, so a
// client form never builds them from its own (different) ICU data and
// mismatches the server render.
import type { SelectHTMLAttributes } from "react";
import {
  ALL_CURRENCIES,
  ALL_TIMEZONES,
  currencyName,
  withCurrent,
} from "@/core/settings/defaults";
import { Select } from "@/ui/primitives";

export interface PickerOption {
  value: string;
  label: string;
}

/** "CAD — Canadian Dollar", in the reader's language. */
export function currencyOptions(displayLocale: string, current?: string): PickerOption[] {
  return withCurrent(ALL_CURRENCIES, current?.toUpperCase()).map((code) => ({
    value: code,
    label: `${code} — ${currencyName(code, displayLocale)}`,
  }));
}

/** IANA zones, shown with spaces ("America/Los Angeles") but stored as-is. */
export function timezoneOptions(current?: string): PickerOption[] {
  return withCurrent(ALL_TIMEZONES, current).map((zone) => ({
    value: zone,
    label: zone.replaceAll("_", " "),
  }));
}

/**
 * Languages people commonly ask to be written to in. A curated list rather
 * than every BCP-47 tag — nobody scrolls past four hundred dialects to find
 * French — and the stored value is always offered even when it is not on it.
 */
export const COMMON_LOCALES = [
  "en", "en-CA", "en-GB", "en-US", "en-AU",
  "fr", "fr-CA", "fr-FR",
  "es", "es-MX", "es-ES",
  "ar", "de", "it", "nl", "pl", "pt", "pt-BR", "ru", "tr", "uk",
  "hi", "pa", "ur", "fa", "he", "zh", "zh-TW", "ja", "ko", "vi", "tl", "th", "id",
] as const;

function languageLabel(code: string, displayLocale: string): string {
  try {
    const name = new Intl.DisplayNames([displayLocale], { type: "language" }).of(code);
    return name ? name.charAt(0).toUpperCase() + name.slice(1) : code;
  } catch {
    return code;
  }
}

export function localeOptions(
  displayLocale: string,
  current?: string,
  extra: readonly string[] = [],
): PickerOption[] {
  const codes = [...new Set([...extra, ...COMMON_LOCALES])];
  return withCurrent(codes, current || undefined).map((code) => ({
    value: code,
    label: languageLabel(code, displayLocale),
  }));
}

/**
 * A native select over precomputed options. `emptyLabel` adds a first,
 * blank choice for optional fields ("Not set").
 */
export function OptionSelect({
  options,
  emptyLabel,
  ...rest
}: SelectHTMLAttributes<HTMLSelectElement> & {
  options: readonly PickerOption[];
  emptyLabel?: string;
}) {
  return (
    <Select {...rest}>
      {emptyLabel !== undefined ? <option value="">{emptyLabel}</option> : null}
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </Select>
  );
}
