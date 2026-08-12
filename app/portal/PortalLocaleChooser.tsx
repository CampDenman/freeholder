// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: AGPL-3.0-only
// One deliberately quiet chooser shared by anonymous and signed-in portal
// chrome. Before sign-in it changes the URL; after sign-in it changes the
// linked Contact fact, which is what makes templates and notifications follow.
import type { Translate } from "@/core/i18n";
import {
  languageName,
  localizeCustomerHref,
  type LocalePolicy,
} from "@/core/i18n/customer";
import { setPortalLocaleAction } from "./actions";

export function PortalLocaleChooser({
  locale,
  policy,
  path,
  signedIn,
  t,
}: {
  locale: string;
  policy: LocalePolicy;
  path: string;
  signedIn: boolean;
  t: Translate;
}) {
  if (policy.enabledLocales.length < 2) return null;
  return (
    <nav aria-label={t("portal.language.label")}>
      <ul className="flex list-none flex-wrap items-center gap-1 p-0">
        {policy.enabledLocales.map((candidate) => {
          const current = candidate.toLowerCase() === locale.toLowerCase();
          const className = current
            ? "rounded-full bg-accent-soft px-2.5 py-1 text-xs font-semibold text-accent"
            : "rounded-full px-2.5 py-1 text-xs text-ink-muted hover:bg-surface";
          return (
            <li key={candidate}>
              {signedIn ? (
                <form action={setPortalLocaleAction}>
                  <input type="hidden" name="locale" value={candidate} />
                  <input type="hidden" name="returnTo" value={path} />
                  <button
                    type="submit"
                    lang={candidate}
                    aria-current={current ? "true" : undefined}
                    disabled={current}
                    className={className}
                  >
                    {languageName(candidate)}
                  </button>
                </form>
              ) : (
                <a
                  href={localizeCustomerHref(path, candidate, policy)}
                  hrefLang={candidate}
                  lang={candidate}
                  aria-current={current ? "true" : undefined}
                  className={className}
                >
                  {languageName(candidate)}
                </a>
              )}
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
