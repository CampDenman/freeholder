// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C10.24: contract labels are literal catalog messages, never displayed keys.
import { appMessages } from "./messages.generated.js";

export function appText(locale: string, key: string): string {
  const language = locale.toLowerCase().split("-")[0];
  const catalogs: Record<string, Readonly<Record<string, string>>> = appMessages;
  const catalog = catalogs[language ?? "en"] ?? catalogs.en!;
  return catalog[key] ?? catalogs.en![key] ?? catalog["app.unavailable"]!;
}
