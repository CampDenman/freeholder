// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// A consented lead conversion for the measurement-provider category (C3.32).
//
// The public form action asks for this after `forms.submit` has committed and
// runs what it gets back after the response is on its way: the visitor never
// waits for it, and nothing about them — address, browser, click IDs — is
// stored to send it later. Best effort by design: a conversion is
// attribution, not the enquiry, which is already stored and notified.
import { measurement, measurementAllowed, measurementConfig } from "@/adapters/measurement";
import { env } from "@/core/env";
import type { RequestMetadata } from "@/core/service";
import { acceptedSubmissionIdentity } from "@/modules/forms/conversion";
import { currentAnalyticsSettings } from "./read";
import { parseAnalyticsConsentState } from "./visitor";

/**
 * The deferred conversion for one submission, or null when the category is
 * off, the owner's policy collects nothing, or this visitor did not
 * explicitly allow measurement.
 */
export async function leadConversionTask(input: {
  submissionId: string;
  consentCookie: string | undefined;
  readCookie: (name: string) => string | undefined;
  request: RequestMetadata;
  path: string;
}): Promise<(() => Promise<void>) | null> {
  if (!measurementConfig(env())) return null;
  const { consentPolicy } = await currentAnalyticsSettings();
  if (!measurementAllowed(measurementConfig(env()), consentPolicy, parseAnalyticsConsentState(input.consentCookie))) {
    return null;
  }
  const adapter = measurement();
  if (!adapter) return null;
  const clickIds = adapter.clickIdCookie ? adapter.clickIds(input.readCookie(adapter.clickIdCookie)) : {};
  const sourceUrl = new URL(input.path, env().APP_URL).href;
  const ip = input.request.trustedIp ?? input.request.ip;
  const userAgent = input.request.userAgent;
  return async () => {
    try {
      // Quarantined submissions are nobody's lead.
      const identity = await acceptedSubmissionIdentity(input.submissionId);
      if (!identity) return;
      await adapter.recordConversion({
        submissionId: input.submissionId,
        ...identity,
        ...(ip ? { ip } : {}),
        ...(userAgent ? { userAgent } : {}),
        sourceUrl,
        clickIds,
      });
    } catch {
      // Attribution is best effort; the enquiry itself is already safe.
    }
  };
}
