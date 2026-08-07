// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: AGPL-3.0-only
// The theme control's strings, translated once per render.
//
// `src/core/design/theme.ts` owns the *set* of preferences — that is structure
// and belongs with the mechanism. Their names are copy, and copy belongs in a
// catalog (§4.9), so the two are joined here in the routing layer where a
// locale exists to translate against.
import type { Translate } from "@/core/i18n";
import type { ThemePreference } from "@/core/design/theme";

export interface ThemeLabels {
  legend: string;
  names: Record<ThemePreference, string>;
}

export function themeLabels(t: Translate): ThemeLabels {
  return {
    legend: t("theme.legend"),
    names: {
      system: t("theme.system"),
      light: t("theme.light"),
      dark: t("theme.dark"),
    },
  };
}
