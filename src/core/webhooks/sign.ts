// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: AGPL-3.0-only
// Signing a delivery, and deciding where one may be sent.
//
// These are together because they are the two halves of trusting an outbound
// request: the receiver has to be able to tell the message came from this
// instance, and this instance has to refuse to be pointed at itself.
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { env } from "@/core/env";
import { ServiceError } from "@/core/service";

export const SIGNATURE_HEADER = "freeholder-signature";
export const EVENT_HEADER = "freeholder-event";
export const DELIVERY_HEADER = "freeholder-delivery";

export function newSecret(): string {
  return `whsec_${randomBytes(32).toString("base64url")}`;
}

/**
 * `t=<unix seconds>,v1=<hex hmac>`.
 *
 * The timestamp is *inside* what gets signed, which is the point: a signature
 * over the body alone is replayable forever by anyone who ever saw one
 * request, and a receiver has no way to tell a retry from an attack. Signing
 * `${t}.${body}` lets them reject anything older than their own tolerance.
 *
 * The scheme is versioned (`v1=`) because changing an HMAC later without a
 * version is a flag day for every receiver at once.
 */
export function signPayload(
  secret: string,
  body: string,
  atSeconds: number,
): string {
  const mac = createHmac("sha256", secret)
    .update(`${atSeconds}.${body}`)
    .digest("hex");
  return `t=${atSeconds},v1=${mac}`;
}

/**
 * Verify a signature the way a receiver would.
 *
 * Exported and tested because a receiver's implementation is the thing that
 * decides whether any of this was worth doing, and documentation of a signing
 * scheme that nobody has run is documentation of an intention. This is the
 * reference the tests hold the signer to.
 */
export function verifySignature(
  secret: string,
  body: string,
  header: string,
  options: { toleranceSeconds?: number; nowSeconds?: number } = {},
): boolean {
  const tolerance = options.toleranceSeconds ?? 300;
  const now = options.nowSeconds ?? Math.floor(Date.now() / 1000);

  const parts = new Map(
    header.split(",").map((piece) => {
      const [key, ...rest] = piece.trim().split("=");
      return [key ?? "", rest.join("=")];
    }),
  );
  const timestamp = Number(parts.get("t"));
  const presented = parts.get("v1");
  if (!Number.isFinite(timestamp) || !presented) return false;
  if (Math.abs(now - timestamp) > tolerance) return false;

  const expected = createHmac("sha256", secret)
    .update(`${timestamp}.${body}`)
    .digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(presented);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Hosts a delivery may never be sent to.
 *
 * A webhook URL is an owner-supplied address that this server will fetch on a
 * schedule, with no human watching — which is the exact shape of a
 * server-side request forgery. The owner is trusted, but "trusted" is not the
 * same as "cannot make a mistake or be phished into pasting a URL", and the
 * consequences here are not ordinary: `169.254.169.254` is the cloud metadata
 * service on AWS, GCP and Azure alike, and on many hosts it hands out
 * credentials to anything that asks. Loopback and private ranges reach
 * whatever else shares this network — a database, an admin panel, another
 * tenant's box.
 *
 * So the refusal is by address shape rather than by allowlist, checked at
 * save time where the owner can read the reason.
 */
const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "metadata.google.internal",
  "metadata",
]);

/** Literal IPv4 in a private, loopback, link-local or reserved range. */
function isPrivateIpv4(host: string): boolean {
  const parts = host.split(".");
  if (parts.length !== 4) return false;
  const octets = parts.map((part) => Number(part));
  if (octets.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return false;
  const [a, b] = octets as [number, number, number, number];
  if (a === 10 || a === 127 || a === 0) return true;
  if (a === 169 && b === 254) return true; // link-local, incl. cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true; // carrier-grade NAT
  if (a >= 224) return true; // multicast and reserved
  return false;
}

function isPrivateIpv6(host: string): boolean {
  const address = host.replace(/^\[|\]$/g, "").toLowerCase();
  if (address === "::1" || address === "::") return true;
  // Unique-local (fc00::/7) and link-local (fe80::/10).
  return /^f[cd]/.test(address) || /^fe[89ab]/.test(address);
}

export interface UrlCheckOptions {
  /**
   * Development needs to be able to point a webhook at a local listener, and
   * refusing that would mean nobody can try the feature before deploying it.
   * Production never relaxes.
   */
  allowLocal?: boolean;
}

/**
 * Throw unless this URL is somewhere a delivery may go.
 *
 * Note what this does *not* claim: DNS can resolve a perfectly ordinary
 * hostname to a private address, and re-checking after resolution — then
 * pinning the connection to the address that was checked — is the only
 * complete defence. That is a fetch-layer concern and is recorded in the
 * backlog. This closes the case somebody reaches for first.
 */
export function assertDeliverableUrl(
  raw: string,
  options: UrlCheckOptions = {},
): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new ServiceError("validation", "That is not a valid web address.");
  }

  const allowLocal = options.allowLocal ?? env().NODE_ENV !== "production";

  if (url.protocol !== "https:" && !(allowLocal && url.protocol === "http:")) {
    throw new ServiceError(
      "validation",
      "A webhook address has to start with https:// — the events it carries are your business's data.",
    );
  }

  const host = url.hostname.toLowerCase();
  const blocked =
    BLOCKED_HOSTNAMES.has(host) ||
    host.endsWith(".localhost") ||
    isPrivateIpv4(host) ||
    isPrivateIpv6(host);

  if (blocked && !allowLocal) {
    throw new ServiceError(
      "validation",
      "That address is on this server's own network, and events cannot be sent there.",
    );
  }

  return url;
}

/** Does this subscription want this event? Same matching as API key scopes. */
export function matches(patterns: string[], eventName: string): boolean {
  const family = `${eventName.split(".")[0] ?? ""}.*`;
  return patterns.some(
    (pattern) =>
      pattern === "*" || pattern === eventName || pattern === family,
  );
}
