// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: AGPL-3.0-only
// The small, transient part of a request that authentication may retain.
// Header parsing lives here so callers cannot submit their own session IP or
// user agent in JSON. Deployment proxies remain responsible for replacing the
// forwarding headers they expose to the application.
import { isIP } from "node:net";
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
  return { ip, userAgent: userAgent || undefined };
}

export function requestMetadata(request: Request): RequestMetadata {
  return requestMetadataFromHeaders(request.headers);
}
