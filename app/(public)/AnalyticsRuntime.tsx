// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
"use client";
// Browser policy reconciliation and Core Web Vitals collection (C1.18).
import { useEffect, useState } from "react";
import { useReportWebVitals } from "next/web-vitals";
import {
  analyticsCollectionAllowed,
  analyticsConsentNeedsSync,
  type AnalyticsConsentPolicy,
} from "@/modules/analytics/settings";
import {
  analyticsIdentifiersAllowed,
  type AnalyticsConsentState,
} from "@/modules/analytics/visitor";

type WebVitalMetric = {
  id: string;
  name: string;
  value: number;
  delta: number;
  rating: string;
  navigationType: string;
};

function WebVitalsReporter() {
  useReportWebVitals((metric: WebVitalMetric) => {
    void fetch("/api/analytics/vitals", {
      method: "POST",
      credentials: "same-origin",
      keepalive: true,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        id: metric.id,
        metric: metric.name,
        value: metric.value,
        delta: metric.delta,
        rating: metric.rating,
        navigationType: metric.navigationType,
      }),
    });
  });
  return null;
}

export function AnalyticsRuntime({
  policy,
  state,
  hasIdentity,
}: {
  policy: AnalyticsConsentPolicy;
  state: AnalyticsConsentState | null;
  hasIdentity: boolean;
}) {
  const [enabled, setEnabled] = useState(
    hasIdentity &&
      analyticsCollectionAllowed(policy, state) &&
      analyticsIdentifiersAllowed(state),
  );

  useEffect(() => {
    // Durable choices are refreshed through the policy-aware endpoint. The
    // edge can slide a 30-minute session, but only this endpoint knows the
    // owner's configured retention boundary for the visitor cookie.
    if (
      !analyticsConsentNeedsSync(policy, state) &&
      !analyticsIdentifiersAllowed(state)
    ) return;
    let live = true;
    void fetch("/api/analytics/consent", {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ decision: "sync" }),
    })
      .then((response) => response.ok ? response.json() : null)
      .then((result: { enabled?: boolean } | null) => {
        if (live) setEnabled(result?.enabled === true);
      })
      .catch(() => undefined);
    return () => { live = false; };
  }, [policy, state]);

  return enabled ? <WebVitalsReporter /> : null;
}
