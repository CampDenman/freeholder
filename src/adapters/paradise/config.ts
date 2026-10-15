// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Paradise Modern as an optional provider (C3.30–C3.33).
//
// One site credential, several capabilities: mail, measurement, form
// screening and lead capture, and a model gateway. Each is switched on by its
// own setting and every one is off until it is, so a Freeholder without these
// variables never makes a request to Paradise Modern and loses nothing.
//
// Everything here is server-side. The site key authenticates server-to-server
// calls only; the browser only ever sees the site's own `pm.<domain>` edge
// host and its public site id, which is what that edge was built to serve.
import { env } from "@/core/env";

export const PARADISE_DEFAULT_URL = "https://paradisemodern.com";
/** Balanced PM Brain lane. PM chooses the upstream model; we never name one. */
export const PM_BRAIN_DEFAULT_MODEL = "pm-brain";

export interface ParadiseSite {
  apiKey: string | undefined;
  /** API origin with no trailing slash and no `/v1` suffix. */
  baseUrl: string;
  siteId: string | undefined;
  /** The site's first-party PM edge origin, e.g. `https://pm.example.com`. */
  edgeOrigin: string | undefined;
}

/**
 * Normalize `PARADISEMODERN_URL`.
 *
 * Builders and the voice/video plugin have historically written it both with
 * and without `/v1`; the routes this file serves live on both sides of that
 * prefix, so the origin is what we keep.
 */
export function paradiseBaseUrl(raw: string | undefined = env().PARADISEMODERN_URL): string {
  return (raw?.trim() || PARADISE_DEFAULT_URL).replace(/\/+$/, "").replace(/\/v1$/i, "");
}

export function paradiseSite(): ParadiseSite {
  const current = env();
  return {
    apiKey: current.PARADISEMODERN_API_KEY,
    baseUrl: paradiseBaseUrl(current.PARADISEMODERN_URL),
    siteId: current.PARADISEMODERN_SITE_ID,
    edgeOrigin: current.PARADISEMODERN_EDGE_URL
      ? new URL(current.PARADISEMODERN_EDGE_URL).origin
      : undefined,
  };
}

/**
 * Headers every PM Brain gateway call carries.
 *
 * PM meters each model call against a billing project and answers 400
 * `unknown_project` without one, so the project travels with every request
 * that has one configured. The fallback policy is optional on purpose: unset
 * means PM's normal availability-first routing, which is the right default
 * for a public site's assistant; a pinned policy turns an outage into an
 * error rather than a different model.
 */
export function pmBrainGatewayHeaders(
  apiKey: string,
  options: { project?: string | null; fallbackPolicy?: string | null } = {},
): Record<string, string> {
  const current = env();
  const project = options.project ?? current.PARADISEMODERN_BILLING_PROJECT;
  const fallbackPolicy = options.fallbackPolicy ?? current.PARADISEMODERN_FALLBACK_POLICY;
  return {
    "content-type": "application/json",
    "x-api-key": apiKey,
    ...(project ? { "x-pm-project": project } : {}),
    ...(fallbackPolicy ? { "x-pm-fallback-policy": fallbackPolicy } : {}),
  };
}

/** What each capability still needs, for doctor and admin. Never a value. */
export function paradiseMissing(capability: "mail" | "analytics" | "forms" | "brain"): string[] {
  const current = env();
  const required: Array<[string, unknown]> = [["PARADISEMODERN_API_KEY", current.PARADISEMODERN_API_KEY]];
  if (capability === "analytics") {
    required.push(
      ["PARADISEMODERN_SITE_ID", current.PARADISEMODERN_SITE_ID],
      ["PARADISEMODERN_EDGE_URL", current.PARADISEMODERN_EDGE_URL],
    );
  }
  if (capability === "brain") {
    required.push(["PARADISEMODERN_BILLING_PROJECT", current.PARADISEMODERN_BILLING_PROJECT]);
  }
  return required.filter(([, value]) => !value).map(([name]) => name);
}
