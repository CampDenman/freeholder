// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Server-rendered, JS-optional analytics choice (MASTER.md C1.18).
import type { Translate } from "@/core/i18n";
import {
  analyticsCollectionAllowed,
  type AnalyticsConsentPolicy,
} from "@/modules/analytics/settings";
import type { AnalyticsConsentState } from "@/modules/analytics/visitor";

function ChoiceForm({
  decision,
  returnTo,
  label,
  primary = false,
}: {
  decision: "grant" | "deny";
  returnTo: string;
  label: string;
  primary?: boolean;
}) {
  return (
    <form action="/api/analytics/consent" method="post">
      <input type="hidden" name="decision" value={decision} />
      <input type="hidden" name="returnTo" value={returnTo} />
      <button
        type="submit"
        className={primary
          ? "rounded-md bg-accent px-3 py-2 text-sm font-semibold text-on-accent"
          : "rounded-md border border-rule px-3 py-2 text-sm font-semibold text-ink"}
      >
        {label}
      </button>
    </form>
  );
}

export function AnalyticsConsentControl({
  policy,
  state,
  retentionDays,
  returnTo,
  t,
}: {
  policy: AnalyticsConsentPolicy;
  state: AnalyticsConsentState | null;
  retentionDays: number;
  returnTo: string;
  t: Translate;
}) {
  if (policy === "disabled") return null;
  const needsChoice = policy === "opt_in" && state !== "granted" && state !== "denied";
  if (needsChoice) {
    return (
      <aside
        aria-label={t("analytics.consent.title")}
        className="fixed inset-x-4 bottom-4 z-50 mx-auto grid max-w-xl gap-3 rounded-lg border border-rule bg-surface p-4 shadow-lg"
      >
        <div>
          <h2 className="font-semibold text-ink">{t("analytics.consent.title")}</h2>
          <p className="mt-1 text-sm text-ink-muted">
            {t("analytics.consent.explanation", { days: retentionDays })}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <ChoiceForm decision="grant" returnTo={returnTo} label={t("analytics.consent.allow")} primary />
          <ChoiceForm decision="deny" returnTo={returnTo} label={t("analytics.consent.decline")} />
        </div>
      </aside>
    );
  }

  const enabled = analyticsCollectionAllowed(policy, state);
  return (
    <details className="fixed end-4 bottom-4 z-40 max-w-sm rounded-md border border-rule bg-surface px-3 py-2 text-sm shadow-sm">
      <summary className="cursor-pointer text-ink-muted">
        {t("analytics.consent.choices")}
      </summary>
      <div className="mt-3 grid gap-3">
        <p className="text-xs text-ink-muted">
          {t("analytics.consent.explanation", { days: retentionDays })}
        </p>
        <ChoiceForm
          decision={enabled ? "deny" : "grant"}
          returnTo={returnTo}
          label={t(enabled ? "analytics.consent.turnOff" : "analytics.consent.turnOn")}
          primary={!enabled}
        />
      </div>
    </details>
  );
}
