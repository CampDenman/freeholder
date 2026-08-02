// Copyright (C) 2026 Camp Denman Society
// SPDX-License-Identifier: AGPL-3.0-only
// The absolute address this instance is served from.
//
// §5 requires a "canonical absolute URL on every page", and absolute means
// something must know the scheme and host. `APP_URL` is the configured answer
// (§17) and is the only trustworthy one: a canonical built from the request's
// Host header is how a site ends up telling a crawler that its canonical home
// is on somebody else's domain.
import { env } from "@/core/env";

const LOCAL = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;

let warned = false;

/**
 * `APP_URL`, checked against reality.
 *
 * It carries a localhost default so `next build` succeeds without a
 * configured environment — which means an owner who never sets it would
 * publish a sitemap full of `http://localhost:3000` links and a canonical tag
 * pointing at their own laptop. That is the kind of misconfiguration nobody
 * discovers until a search engine has already believed it, so it is said out
 * loud the first time a real request exposes it.
 *
 * The request never *becomes* the origin — that would be the Host-header
 * vulnerability this exists to avoid. It is only evidence that the
 * configuration is wrong.
 */
export function siteOrigin(): string {
  return env().APP_URL.replace(/\/+$/, "");
}

/**
 * The same origin, plus a check against where the request actually arrived.
 *
 * Callers that have a request pass it; callers that do not — a server
 * component assembling a canonical — call `siteOrigin()`. The request is only
 * ever evidence about the configuration, never the source of the answer.
 */
export function originFor(request: Request): string {
  const configured = siteOrigin();
  const actual = new URL(request.url).origin;

  if (!warned && LOCAL.test(configured) && !LOCAL.test(actual)) {
    warned = true;
    console.warn(
      `[seo] APP_URL is "${configured}" but this instance is being reached at ` +
        `"${actual}". Canonical URLs, the sitemap and llms.txt will all name ` +
        `localhost. Set APP_URL to the address visitors use.`,
    );
  }

  return configured;
}
