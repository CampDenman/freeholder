// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Instance discovery — the app's first screen (MASTER.md §35.1, C10.12).
//
// §35.1: "The app is white-label but not single-tenant-compiled: it asks for
// the business's address, fetches `/.well-known/freeholder` for the name,
// branding and contract version, and refuses an instance whose contract is
// newer than the binary understands — with the store link to update, not a
// broken screen. A customer whose photographer moved domains types the new
// one; nobody reinstalls."
//
// Everything here is pure or takes an injected `fetch`, because the interesting
// behaviour is what it does with a *wrong* address, and none of that should
// need a simulator to test.

/** The contract major this binary was built against. */
export const APP_CONTRACT_VERSION = 1;

export interface Instance {
  url: string;
  contractVersion: number;
  platformVersion: string;
  name: string;
  tagline: string | null;
  locales: { default: string; enabled: string[] };
  currency: string;
  timezone: string;
  country: string;
  branding: {
    logoUrl: string | null;
    colors: Record<string, string>;
    fontSans: string | null;
  };
  api: { base: string; openapi: string; mcp: string };
  storeUrls: { ios: string | null; android: string | null };
}

export type DiscoveryResult =
  | { ok: true; instance: Instance }
  | {
      ok: false;
      reason: "invalid-address" | "insecure" | "unreachable" | "not-freeholder" | "setup-incomplete" | "app-too-old";
      message: string;
      /** Present when the fix is "update the app". */
      storeUrls?: { ios: string | null; android: string | null };
    };

/**
 * Turn whatever a customer typed into an origin worth trying.
 *
 * People type `example.com`, `www.example.com/`, `https://example.com/portal`
 * and `Example.com `. All four mean the same business. Refusing any of them
 * would be technically defensible and would lose the customer at the first
 * screen, so the app normalizes instead — and then insists on https, because
 * everything after this carries a session token.
 */
export function normalizeAddress(raw: string): { url: string } | { error: DiscoveryResult } {
  const trimmed = raw.trim();
  if (!trimmed) {
    return {
      error: { ok: false, reason: "invalid-address", message: "Enter your business's web address." },
    };
  }
  let parsed: URL;
  try {
    parsed = new URL(/^[a-z]+:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
  } catch {
    return {
      error: {
        ok: false,
        reason: "invalid-address",
        message: `"${trimmed}" is not a web address.`,
      },
    };
  }
  if (parsed.protocol === "http:" && !isLoopback(parsed.hostname)) {
    // Not pedantry: the next request carries a session token, and a phone is
    // usually on somebody else's wifi.
    return {
      error: {
        ok: false,
        reason: "insecure",
        message: "That address is not secure (https). Ask the business for their secure address.",
      },
    };
  }
  if (!parsed.hostname.includes(".") && !isLoopback(parsed.hostname)) {
    return {
      error: {
        ok: false,
        reason: "invalid-address",
        message: `"${trimmed}" is not a web address.`,
      },
    };
  }
  return { url: `${parsed.protocol}//${parsed.host}` };
}

function isLoopback(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
}

type FetchLike = (url: string, init?: { signal?: AbortSignal }) => Promise<{
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
}>;

/**
 * Ask an address whether it is a Freeholder instance this binary can talk to.
 *
 * The three "no" answers are deliberately different sentences. "Not a
 * Freeholder site" is a typo the customer can fix. "Setup is not finished" is
 * the owner's problem and the customer should be told to wait, not to retype.
 * "This app is too old" is nobody's fault and has exactly one fix, which is
 * why it carries the store links rather than a retry button.
 */
export async function discover(
  address: string,
  fetchImpl: FetchLike,
  appContract = APP_CONTRACT_VERSION,
): Promise<DiscoveryResult> {
  const normalized = normalizeAddress(address);
  if ("error" in normalized) return normalized.error;

  let payload: unknown;
  let status: number;
  try {
    const response = await fetchImpl(`${normalized.url}/.well-known/freeholder`);
    status = response.status;
    payload = await response.json();
  } catch {
    return {
      ok: false,
      reason: "unreachable",
      message: "Could not reach that address. Check your connection, or the spelling.",
    };
  }

  const document = payload as Partial<Instance> & {
    freeholder?: boolean;
    setupComplete?: boolean;
  };
  if (document?.freeholder !== true) {
    return {
      ok: false,
      reason: "not-freeholder",
      message: "That address does not look like a Freeholder site.",
    };
  }
  if (status === 503 || document.setupComplete === false) {
    return {
      ok: false,
      reason: "setup-incomplete",
      message: "This site is not finished being set up yet. Try again later.",
    };
  }
  if (typeof document.contractVersion !== "number") {
    return {
      ok: false,
      reason: "not-freeholder",
      message: "That address does not look like a Freeholder site.",
    };
  }
  if (document.contractVersion > appContract) {
    return {
      ok: false,
      reason: "app-too-old",
      message: `${document.name ?? "This site"} needs a newer version of this app.`,
      storeUrls: document.storeUrls ?? { ios: null, android: null },
    };
  }

  return {
    ok: true,
    instance: {
      url: normalized.url,
      contractVersion: document.contractVersion,
      platformVersion: document.platformVersion ?? "unknown",
      name: document.name ?? normalized.url,
      tagline: document.tagline ?? null,
      locales: document.locales ?? { default: "en", enabled: ["en"] },
      currency: document.currency ?? "USD",
      timezone: document.timezone ?? "UTC",
      country: document.country ?? "US",
      branding: document.branding ?? { logoUrl: null, colors: {}, fontSans: null },
      api: document.api ?? {
        base: `${normalized.url}/api/v1`,
        openapi: `${normalized.url}/api/openapi.json`,
        mcp: `${normalized.url}/api/mcp`,
      },
      storeUrls: document.storeUrls ?? { ios: null, android: null },
    },
  };
}
