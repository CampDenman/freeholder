// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Paradise Modern as a measurement adapter (C3.32): `MEASUREMENT_PROVIDER=
// paradise` with `PARADISEMODERN_SITE_ID` and `PARADISEMODERN_EDGE_URL`.
//
// Two browser scripts from the site's own edge host, and one server-side
// `lead` conversion per accepted enquiry from a visitor who allowed it. Every
// gate lives in `./config` and the callers; this file is only the wire.
import { paradiseRequest } from "@/adapters/paradise/http";
import type { MeasurementConfig } from "./config";
import type { LeadConversion } from "./types";

/** The provider's click-ID cookie, written by its script on the site's domain. */
export const PARADISE_CLICK_ID_COOKIE = "_pm_cids";

const CLICK_ID_KEYS = new Set([
  "fbclid", "gclid", "gbraid", "wbraid", "ttclid", "sclid", "rdt_cid",
  "li_fat_id", "epik", "twclid", "msclkid", "_fbc", "_fbp",
]);

/** The two scripts the provider's edge serves for this site. */
export function paradiseScriptSources(config: MeasurementConfig): string[] {
  const site = encodeURIComponent(config.siteId);
  return [`${config.edgeOrigin}/sdk/track.js?site=${site}`, `${config.edgeOrigin}/capi.js?site=${site}`];
}

/**
 * Click IDs the provider's script stored on this site's domain.
 *
 * Only recognised keys with short printable values: the cookie is written by
 * a script but read here as untrusted input.
 */
export function paradiseClickIds(raw: string | undefined): Record<string, string> {
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
        CLICK_ID_KEYS.has(entry[0]) && typeof entry[1] === "string" && /^[\x21-\x7e]{1,500}$/.test(entry[1]),
    ),
  );
}

/**
 * One `lead` conversion, `POST /api/capi/{site}/event`. The event id is the
 * submission's, so the provider deduplicates a repeat.
 */
export async function recordParadiseConversion(config: MeasurementConfig, event: LeadConversion): Promise<void> {
  await paradiseRequest(`/api/capi/${encodeURIComponent(config.siteId)}/event`, {
    timeoutMs: 10_000,
    body: {
      eventId: `freeholder-form:${event.submissionId}`,
      eventName: "lead",
      eventTime: new Date().toISOString(),
      user: {
        ...(event.email ? { email: event.email } : {}),
        ...(event.phone && event.phone.length >= 3 ? { phone: event.phone } : {}),
        ...(event.ip ? { ip: event.ip } : {}),
        ...(event.userAgent ? { userAgent: event.userAgent } : {}),
        externalId: event.submissionId,
      },
      context: {
        ...(event.sourceUrl ? { sourceUrl: event.sourceUrl } : {}),
        ...(Object.keys(event.clickIds).length > 0 ? { clickIds: event.clickIds } : {}),
      },
    },
  });
}
