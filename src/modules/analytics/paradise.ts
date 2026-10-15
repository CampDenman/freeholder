// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Paradise Modern measurement and conversion events (C3.31).
//
// Freeholder's own analytics stays exactly what `deploy/analytics-governance.md`
// says it is: first-party, on the instance, no IP addresses, no click IDs, no
// third-party identifiers. This file is the optional exception an owner turns
// on deliberately, and it is gated harder than first-party analytics because
// it does more: PM's browser SDK measures the visit, and PM fans a conversion
// out to the advertising platforms the site has connected.
//
// So it never runs on implied consent. The browser scripts load, the CSP
// opens the edge origin, and a server-side lead conversion is sent only when
// all of these hold:
//
// - `PARADISEMODERN_ANALYTICS=on` with a site key, site id and edge origin;
// - the owner's collection policy is not "disabled";
// - this visitor explicitly chose "allow" (`fh_ac=granted`). The privacy-first
//   opt-out default's implicit state is not enough, so an owner who wants PM
//   measurement for everyone chooses the explicit opt-in policy, whose banner
//   says so.
//
// Nothing here is persisted: the visitor's address, user agent and click IDs
// go from this request to PM and nowhere else in Freeholder.
import { env } from "@/core/env";
import { paradiseRequest } from "@/adapters/paradise/http";
import type { AnalyticsConsentPolicy } from "./settings";
import type { AnalyticsConsentState } from "./visitor";

/** PM's capi.js first-party click-ID cookie, on the site's own domain. */
export const PARADISE_CLICK_ID_COOKIE = "_pm_cids";

const CLICK_ID_KEYS = new Set([
  "fbclid", "gclid", "gbraid", "wbraid", "ttclid", "sclid", "rdt_cid",
  "li_fat_id", "epik", "twclid", "msclkid", "_fbc", "_fbp",
]);

export interface ParadiseMeasurement {
  siteId: string;
  edgeOrigin: string;
}

/** The configured measurement, or null when any part of it is missing. */
export function paradiseMeasurement(): ParadiseMeasurement | null {
  const current = env();
  if (current.PARADISEMODERN_ANALYTICS !== "on") return null;
  if (!current.PARADISEMODERN_API_KEY || !current.PARADISEMODERN_SITE_ID || !current.PARADISEMODERN_EDGE_URL) {
    return null;
  }
  return {
    siteId: current.PARADISEMODERN_SITE_ID,
    edgeOrigin: new URL(current.PARADISEMODERN_EDGE_URL).origin,
  };
}

/** Explicit visitor permission under a policy that collects at all. */
export function paradiseMeasurementAllowed(
  policy: AnalyticsConsentPolicy,
  state: AnalyticsConsentState | null,
): boolean {
  return paradiseMeasurement() !== null && policy !== "disabled" && state === "granted";
}

/** The two scripts PM's edge serves for this site. */
export function paradiseScriptSources(measurement: ParadiseMeasurement): string[] {
  const site = encodeURIComponent(measurement.siteId);
  return [
    `${measurement.edgeOrigin}/sdk/track.js?site=${site}`,
    `${measurement.edgeOrigin}/capi.js?site=${site}`,
  ];
}

/**
 * Click IDs PM's capi.js stored on this site's domain.
 *
 * Only recognised keys with short printable values: the cookie is written by
 * a script but read here as untrusted input.
 */
export function clickIdsFromCookie(raw: string | undefined): Record<string, string> {
  if (!raw || raw.length > 4096) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(decodeURIComponent(raw));
  } catch {
    return {};
  }
  const ids = parsed && typeof parsed === "object" ? (parsed as { ids?: unknown }).ids : undefined;
  if (!ids || typeof ids !== "object") return {};
  return Object.fromEntries(
    Object.entries(ids as Record<string, unknown>).filter(
      (entry): entry is [string, string] =>
        CLICK_ID_KEYS.has(entry[0]) &&
        typeof entry[1] === "string" &&
        /^[\x21-\x7e]{1,500}$/.test(entry[1]),
    ),
  );
}

/**
 * One `lead` conversion for an accepted form submission.
 *
 * Best effort by design: the caller runs it after the response has been sent
 * and swallows failure. A conversion is attribution, not the enquiry — the
 * submission is already stored, notified and (when enabled) forwarded. The
 * event id is the submission's, so PM deduplicates a repeat.
 */
export async function sendLeadConversion(input: {
  submissionId: string;
  email?: string;
  phone?: string;
  ip?: string;
  userAgent?: string;
  sourceUrl?: string;
  clickIds: Record<string, string>;
}): Promise<void> {
  const measurement = paradiseMeasurement();
  if (!measurement) return;
  await paradiseRequest(`/api/capi/${encodeURIComponent(measurement.siteId)}/event`, {
    timeoutMs: 10_000,
    body: {
      eventId: `freeholder-form:${input.submissionId}`,
      eventName: "lead",
      eventTime: new Date().toISOString(),
      user: {
        ...(input.email ? { email: input.email } : {}),
        ...(input.phone && input.phone.length >= 3 ? { phone: input.phone } : {}),
        ...(input.ip ? { ip: input.ip } : {}),
        ...(input.userAgent ? { userAgent: input.userAgent } : {}),
        externalId: input.submissionId,
      },
      context: {
        ...(input.sourceUrl ? { sourceUrl: input.sourceUrl } : {}),
        ...(Object.keys(input.clickIds).length > 0 ? { clickIds: input.clickIds } : {}),
      },
    },
  });
}
