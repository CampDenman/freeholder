// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Consent for somebody else's ad tag (MASTER.md §4.16, C9.20).
//
// Separate from analytics consent: C1.19 is explicit that creative code is a
// different risk, and `fh_tc=granted` is the only value that opens the CSP.
// Shown only inside a slot whose winning creative would have been third-party,
// so a page with no such creative never asks.
import type { Translate } from "@/core/i18n";

export function ThirdPartyConsent({
  returnTo,
  t,
}: {
  returnTo: string;
  t: Translate;
}) {
  return (
    <div className="grid h-full w-full place-items-center gap-2 p-3 text-center">
      <p className="text-xs text-ink-muted">{t("ads.consent.explanation")}</p>
      <div className="flex flex-wrap justify-center gap-2">
        <form action="/api/ads/third-party-consent" method="post">
          <input type="hidden" name="decision" value="grant" />
          <input type="hidden" name="returnTo" value={returnTo} />
          <button
            type="submit"
            className="rounded-md bg-accent px-3 py-1.5 text-xs font-semibold text-on-accent"
          >
            {t("ads.consent.allow")}
          </button>
        </form>
        <form action="/api/ads/third-party-consent" method="post">
          <input type="hidden" name="decision" value="deny" />
          <input type="hidden" name="returnTo" value={returnTo} />
          <button
            type="submit"
            className="rounded-md border border-rule px-3 py-1.5 text-xs font-semibold text-ink"
          >
            {t("ads.consent.decline")}
          </button>
        </form>
      </div>
    </div>
  );
}
