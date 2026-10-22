// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// The small, transient part of a request that authentication may retain.
// Header parsing lives here so callers cannot submit their own session IP or
// user agent in JSON. Deployment proxies remain responsible for replacing the
// forwarding headers they expose to the application.
import { isIP } from "node:net";
import { env } from "@/core/env";
import type { RequestMetadata } from "@/core/service";

const IP_HEADERS = [
  "cf-connecting-ip",
  "fly-client-ip",
  "x-real-ip",
  "x-forwarded-for",
] as const;

function cleanIp(value: string): string | undefined {
  let candidate = value.split(",", 1)[0]?.trim().replace(/^"|"$/g, "");
  if (!candidate) return undefined;
  if (candidate.startsWith("[") && candidate.includes("]")) {
    candidate = candidate.slice(1, candidate.indexOf("]"));
  } else if (/^\d{1,3}(?:\.\d{1,3}){3}:\d+$/.test(candidate)) {
    candidate = candidate.slice(0, candidate.lastIndexOf(":"));
  }
  return isIP(candidate) ? candidate.toLowerCase() : undefined;
}

/**
 * The address the deployment vouches for, or nothing.
 *
 * An overwritten header is read whole. `X-Forwarded-For` behind an appending
 * edge is read from the right: the visitor controls everything to the left of
 * what the proxies added, so the entry `hops` from the end is the first one a
 * proxy wrote. Too few entries, or a malformed one at that position, is no
 * answer rather than a guess at a neighbour.
 */
function trustedClientIp(
  headers: Headers,
  name: string | undefined,
  hops: number,
): string | undefined {
  if (!name) return undefined;
  const value = headers.get(name);
  if (!value) return undefined;
  if (name !== "x-forwarded-for") return cleanIp(value);
  // `Headers.get` joins repeated header lines with ", ", which keeps their
  // order, so a second line a visitor adds still lands to the left.
  const entries = value.split(",");
  if (entries.length < hops) return undefined;
  const entry = entries[entries.length - hops]!.trim();
  return entry ? cleanIp(entry) : undefined;
}

export function requestMetadataFromHeaders(headers: Headers): RequestMetadata {
  let ip: string | undefined;
  for (const name of IP_HEADERS) {
    ip = cleanIp(headers.get(name) ?? "");
    if (ip) break;
  }
  const userAgent = headers
    .get("user-agent")
    ?.replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 512);
  const config = env();
  const trustedIp = trustedClientIp(
    headers,
    config.TRUSTED_CLIENT_IP_HEADER,
    config.TRUSTED_PROXY_HOPS,
  );
  return { ip, userAgent: userAgent || undefined, ...(trustedIp ? { trustedIp } : {}) };
}

export function requestMetadata(request: Request): RequestMetadata {
  return requestMetadataFromHeaders(request.headers);
}
