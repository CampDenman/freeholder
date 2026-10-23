// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// The measurement-provider category (C3.32, MASTER.md §12).
//
// Freeholder's own analytics stays exactly what `deploy/analytics-governance.md`
// says: first-party, on the instance, no IP addresses, no click IDs, no
// third-party identifiers. A measurement provider is the optional exception
// an owner turns on deliberately — a third party's browser script and a
// server-side conversion for the advertising that brought a visitor — so it
// is a neutral category (`MEASUREMENT_PROVIDER`, default `none`) with
// swappable adapters, and it is gated harder than first-party analytics:
//
// - a provider is chosen and fully configured, and this is not the public
//   playground (which contacts no outside provider);
// - the owner's collection policy is not "disabled";
// - this visitor explicitly chose "allow" (`fh_ac=granted`). The privacy-first
//   opt-out default's implicit state never qualifies.
//
// Pure functions of the environment, so the Edge proxy can open the CSP for
// exactly the visitors the layout renders the scripts for.

export const MEASUREMENT_PROVIDERS = ["none", "paradise"] as const;
export type MeasurementProviderId = (typeof MEASUREMENT_PROVIDERS)[number];

export interface MeasurementConfig {
  provider: Exclude<MeasurementProviderId, "none">;
  /** Named to visitors in the consent choice and the privacy notice. */
  displayName: string;
  siteId: string;
  /** The provider's browser host for this site; the only origin the CSP adds. */
  edgeOrigin: string;
}

export interface MeasurementEnvironment {
  MEASUREMENT_PROVIDER?: MeasurementProviderId;
  PARADISEMODERN_API_KEY?: string;
  PARADISEMODERN_SITE_ID?: string;
  PARADISEMODERN_EDGE_URL?: string;
  FREEHOLDER_PLAYGROUND?: string;
}

/** The configured provider, or null when none is chosen or any part is missing. */
export function measurementConfig(environment: MeasurementEnvironment): MeasurementConfig | null {
  if (environment.FREEHOLDER_PLAYGROUND === "1") return null;
  if (environment.MEASUREMENT_PROVIDER !== "paradise") return null;
  const { PARADISEMODERN_API_KEY: key, PARADISEMODERN_SITE_ID: siteId, PARADISEMODERN_EDGE_URL: edge } = environment;
  if (!key || !siteId || !edge) return null;
  return { provider: "paradise", displayName: "Paradise Modern", siteId, edgeOrigin: new URL(edge).origin };
}

/** Explicit visitor permission under a policy that collects at all. */
export function measurementAllowed(
  config: MeasurementConfig | null,
  policy: string,
  state: string | null | undefined,
): config is MeasurementConfig {
  return config !== null && policy !== "disabled" && state === "granted";
}

/**
 * The origins the CSP adds for this request: the provider's edge, only for a
 * visitor whose explicit choice is "allow". The layout applies the owner's
 * collection policy before rendering any script; this only lets them reach
 * their own host. Admin pages never receive it (see `contentSecurityPolicy`).
 */
export function measurementCspOrigins(
  environment: MeasurementEnvironment,
  state: string | null | undefined,
): string[] {
  const config = measurementConfig(environment);
  return config && state === "granted" ? [config.edgeOrigin] : [];
}
