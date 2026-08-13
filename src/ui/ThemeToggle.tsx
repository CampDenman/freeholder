// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// The light/dark control. Three plain submit buttons in a form — clicking one
// posts its own name and value, so this works with JavaScript switched off and
// needs no client component at all.
//
// The action is a prop rather than an import: this file stays free of
// framework imports (§10), and the routing layer supplies whatever "handle a
// form post" means for it.
import { Desktop, Moon, Sun } from "@phosphor-icons/react/dist/ssr";
import { THEME_PREFERENCES, type ThemePreference } from "@/core/design/theme";
import { cx } from "@/ui/primitives";

// Derived from a real icon rather than the package's `Icon` type, which its
// server entry point does not re-export.
type IconComponent = typeof Sun;

const ICONS: Record<ThemePreference, IconComponent> = {
  system: Desktop,
  light: Sun,
  dark: Moon,
};

export interface ThemeToggleLabels {
  legend: string;
  names: Record<ThemePreference, string>;
}

export function ThemeToggle({
  current,
  action,
  returnTo,
  labels,
}: {
  current: ThemePreference;
  action: (formData: FormData) => void | Promise<void>;
  /** Where to come back to, so choosing a theme never moves you. */
  returnTo: string;
  /**
   * Translated by the caller. This file has no locale to translate against —
   * src/ knows nothing about requests (§10) — so the routing layer, which does,
   * hands the words down. See app/themeLabels.ts.
   */
  labels: ThemeToggleLabels;
}) {
  return (
    <form action={action}>
      <input type="hidden" name="returnTo" value={returnTo} />
      <fieldset className="m-0 border-0 p-0">
        <legend className="sr-only">{labels.legend}</legend>
        <div className="inline-flex overflow-hidden rounded-md border border-rule">
          {THEME_PREFERENCES.map((preference) => {
            const Icon = ICONS[preference];
            const active = preference === current;
            return (
              <button
                key={preference}
                type="submit"
                name="theme"
                value={preference}
                aria-pressed={active}
                title={labels.names[preference]}
                className={cx(
                  "border-e border-rule px-2.5 py-1.5 last:border-e-0",
                  active
                    ? "bg-accent text-on-accent"
                    : "bg-transparent text-ink-muted",
                )}
              >
                <Icon size={15} weight={active ? "fill" : "regular"} />
                <span className="sr-only">{labels.names[preference]}</span>
              </button>
            );
          })}
        </div>
      </fieldset>
    </form>
  );
}
