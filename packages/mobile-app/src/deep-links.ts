// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Deep links: URL → screen (MASTER.md §35, C10.13).
//
// Three things send a customer into the app at a particular place, and they
// must all land the same way:
//
//   - a **push notification** (C10.14) — "your gallery is ready", "invoice due"
//   - a **universal link** — the customer tapped a freeholder URL in mail or a
//     message, and the app is installed
//   - a **pasted address** — someone typed or shared a link
//
// The rule that makes this safe: a link resolves to a screen and its argument,
// and *nothing else*. It never carries a session, never carries a decision, and
// never encodes what the screen should do. A link that could authenticate is a
// link that authenticates whoever finds the phone; a link that could act is a
// link an attacker can send. So the resolver's whole output is a screen id and
// one opaque parameter, and the platform re-checks entitlement on the call the
// screen then makes.
//
// The paths mirror the website's own, deliberately. A customer's photographer
// sends the same URL to everyone; whether it opens in a browser or the app is
// the device's business, not the sender's.
import { SCREENS, type ScreenId } from "./screens.js";

/** The custom scheme, for pushes that must reach this app specifically. */
export const APP_SCHEME = "freeholder";

export interface Destination {
  screen: ScreenId;
  /** The screen's single argument, verbatim. Never interpreted here. */
  param?: string;
  /** True when the link came from outside and the instance must be confirmed. */
  instanceUrl?: string;
}

export type Resolution =
  | { ok: true; destination: Destination }
  | { ok: false; reason: "unknown-path" | "not-a-link" | "wrong-instance"; message: string };

interface Route {
  /** Path segments; `:param` captures one. */
  pattern: readonly string[];
  screen: ScreenId;
}

/**
 * Website paths this app knows how to open.
 *
 * Additive only. A path that is not here opens in the browser rather than
 * guessing — an app that swallows a link it does not understand and shows its
 * home screen has lost the customer's place, which is worse than handing the
 * link back to the browser that would have rendered it.
 */
const ROUTES: readonly Route[] = [
  { pattern: [], screen: "home" },
  { pattern: ["shop"], screen: "catalog" },
  { pattern: ["services"], screen: "catalog" },
  { pattern: ["services", ":param"], screen: "service" },
  { pattern: ["shop", ":param"], screen: "product" },
  { pattern: ["portal", "appointments"], screen: "bookings" },
  { pattern: ["portal", "appointments", ":param"], screen: "booking" },
  { pattern: ["portal", "invoices"], screen: "invoices" },
  { pattern: ["portal", "invoices", ":param"], screen: "invoice" },
  { pattern: ["portal", "galleries"], screen: "galleries" },
  { pattern: ["g", ":param"], screen: "gallery" },
  { pattern: ["portal", "messages"], screen: "messages" },
  { pattern: ["newsletters"], screen: "newsletters" },
  { pattern: ["portal"], screen: "account" },
];

function segments(pathname: string): string[] {
  return pathname.split("/").filter(Boolean).map((part) => safeDecode(part));
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    // A malformed escape is not worth refusing the whole link over; the raw
    // segment is still a usable opaque token for the platform to reject.
    return value;
  }
}

/**
 * Strip a locale prefix, because §4.9 path-prefixes every non-default locale.
 *
 * `/fr/portal/invoices/abc` and `/portal/invoices/abc` are the same
 * destination; the app renders in the instance's locale either way.
 */
function withoutLocale(parts: string[], locales: readonly string[]): string[] {
  const first = parts[0];
  return first && locales.includes(first) ? parts.slice(1) : parts;
}

function appSchemeDestination(url: URL): Destination | null {
  const screen = safeDecode(url.host) as ScreenId;
  if (!(screen in SCREENS)) return null;
  const param = segments(url.pathname)[0];
  const contract = SCREENS[screen];
  if (contract.param && !param) return null;
  return param === undefined ? { screen } : { screen, param };
}

function match(parts: string[]): Destination | null {
  for (const route of ROUTES) {
    if (route.pattern.length !== parts.length) continue;
    let param: string | undefined;
    let ok = true;
    for (const [index, segment] of route.pattern.entries()) {
      const actual = parts[index]!;
      if (segment === ":param") {
        // An empty capture is not a destination — `/g//` is not a gallery.
        if (!actual) {
          ok = false;
          break;
        }
        param = actual;
      } else if (segment !== actual) {
        ok = false;
        break;
      }
    }
    if (!ok) continue;
    // A screen that needs an argument and did not get one is a mismatch, not
    // a half-open screen.
    if (SCREENS[route.screen].param && !param) continue;
    return param === undefined ? { screen: route.screen } : { screen: route.screen, param };
  }
  return null;
}

/**
 * Resolve a link to a destination.
 *
 * `instanceUrl` is the instance the app is currently signed in to. A link for
 * a *different* business is refused rather than opened: the app is white-label
 * and single-instance at a time, and silently switching which business a
 * customer is looking at is how somebody pays the wrong invoice.
 */
export function resolveDeepLink(
  raw: string,
  options: { instanceUrl?: string; locales?: readonly string[] } = {},
): Resolution {
  const trimmed = raw.trim();
  if (!trimmed) {
    return { ok: false, reason: "not-a-link", message: "That is not a link." };
  }

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return { ok: false, reason: "not-a-link", message: "That is not a link." };
  }

  const isAppScheme = url.protocol === `${APP_SCHEME}:`;
  if (!isAppScheme && url.protocol !== "https:" && url.protocol !== "http:") {
    return { ok: false, reason: "not-a-link", message: "That is not a link this app can open." };
  }

  // Browser returns name their issuing instance without carrying credentials.
  // A custom scheme is not proof that the link came from a trusted sender.
  const issuingInstance = isAppScheme ? url.searchParams.get("instance") : null;
  if (issuingInstance) {
    let issuer: URL;
    try { issuer = new URL(issuingInstance); } catch {
      return { ok: false, reason: "not-a-link", message: "That return link has no valid business address." };
    }
    if (!["https:", "http:"].includes(issuer.protocol) || issuer.username || issuer.password) {
      return { ok: false, reason: "not-a-link", message: "That return link has no valid business address." };
    }
    if (options.instanceUrl && issuer.origin !== new URL(options.instanceUrl).origin) {
      return { ok: false, reason: "wrong-instance", message: `That link is for ${issuer.host}, not the connected business.` };
    }
  }
  if (!isAppScheme && options.instanceUrl) {
    const expected = new URL(options.instanceUrl).host;
    if (url.origin !== new URL(options.instanceUrl).origin) {
      return {
        ok: false,
        reason: "wrong-instance",
        message: `That link is for ${url.host}, and you are signed in to ${expected}.`,
      };
    }
  }

  // Two different address spaces, resolved differently rather than pretended
  // to be one. `freeholder://gallery/abc` names a *screen* — it is minted by
  // `pushLink` and only this app writes it. An https link names a *website
  // path*, which the business hands out and which must keep working in a
  // browser. Routing the first through the second's table is how a push stops
  // opening after somebody renames a public URL.
  const destination = isAppScheme
    ? appSchemeDestination(url)
    : match(withoutLocale(segments(url.pathname), options.locales ?? []));
  if (!destination) {
    return {
      ok: false,
      reason: "unknown-path",
      message: "This app cannot open that link. Opening it in your browser instead.",
    };
  }
  return {
    ok: true,
    destination: options.instanceUrl
      ? { ...destination, instanceUrl: options.instanceUrl }
      : issuingInstance ? { ...destination, instanceUrl: new URL(issuingInstance).origin } : destination,
  };
}

/** The link a push notification should carry for a screen. */
export function pushLink(screen: ScreenId, param?: string): string {
  const contract = SCREENS[screen];
  if (contract.param && !param) {
    throw new Error(`${screen} needs a ${contract.param} to be linkable.`);
  }
  return param
    ? `${APP_SCHEME}://${screen}/${encodeURIComponent(param)}`
    : `${APP_SCHEME}://${screen}`;
}

/**
 * Whether opening this destination will require signing in first.
 *
 * Answered before navigating so the app can show its sign-in screen with the
 * destination held, rather than bouncing a customer to the home tab and losing
 * what they tapped.
 */
export function needsSignIn(destination: Destination): boolean {
  return SCREENS[destination.screen].audience === "signed-in";
}
