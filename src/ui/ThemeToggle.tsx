// Copyright (C) 2026 Camp Denman Society
// SPDX-License-Identifier: AGPL-3.0-only
// The light/dark control. Three plain submit buttons in a form — clicking one
// posts its own name and value, so this works with JavaScript switched off and
// needs no client component at all.
//
// The action is a prop rather than an import: this file stays free of
// framework imports (§10), and the routing layer supplies whatever "handle a
// form post" means for it.
import { Desktop, Moon, Sun } from "@phosphor-icons/react/dist/ssr";
import {
  THEME_LABELS,
  THEME_PREFERENCES,
  type ThemePreference,
} from "@/core/design/theme";
import { cx } from "@/ui/primitives";

// Derived from a real icon rather than the package's `Icon` type, which its
// server entry point does not re-export.
type IconComponent = typeof Sun;

const ICONS: Record<ThemePreference, IconComponent> = {
  system: Desktop,
  light: Sun,
  dark: Moon,
};

export function ThemeToggle({
  current,
  action,
  returnTo,
}: {
  current: ThemePreference;
  action: (formData: FormData) => void | Promise<void>;
  /** Where to come back to, so choosing a theme never moves you. */
  returnTo: string;
}) {
  return (
    <form action={action}>
      <input type="hidden" name="returnTo" value={returnTo} />
      <fieldset className="m-0 border-0 p-0">
        <legend className="sr-only">Colour theme</legend>
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
                title={THEME_LABELS[preference]}
                className={cx(
                  "border-e border-rule px-2.5 py-1.5 last:border-e-0",
                  active
                    ? "bg-accent text-on-accent"
                    : "bg-transparent text-ink-muted",
                )}
              >
                <Icon size={15} weight={active ? "fill" : "regular"} />
                <span className="sr-only">{THEME_LABELS[preference]}</span>
              </button>
            );
          })}
        </div>
      </fieldset>
    </form>
  );
}
