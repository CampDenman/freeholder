// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Importer plugin contract (C3.21). Core owns jobs, preview, commit, rollback.
export type ImporterSourceKind =
  | "wordpress-rest"
  | "wordpress-wxr"
  | "sitemap"
  | "rss"
  | "atom"
  | "html"
  | "archive";

export type ImporterLimits = {
  maxPages: number;
  maxBytes: number;
  maxDepth: number;
  requestsPerSecond: number;
};

export const DEFAULT_IMPORTER_LIMITS: ImporterLimits = {
  maxPages: 500,
  maxBytes: 20 * 1024 * 1024,
  maxDepth: 4,
  requestsPerSecond: 2,
};

export type ImporterAuth =
  | { kind: "none" }
  | { kind: "basic"; username: string; password: string }
  | { kind: "bearer"; token: string };

export type ImporterDiscovery = {
  origin: string;
  pages: { url: string; title?: string; kind?: "page" | "post" }[];
  blocked: string[];
  checkpoint?: { cursor?: string; page?: number };
};

export type ImporterMapping = {
  url: string;
  slug: string;
  title: string;
  kind: "page" | "post";
  locale?: string;
  canonical?: string;
};

export type ImporterProvenance = {
  source: ImporterSourceKind;
  origin: string;
  fetchedAt: string;
  url: string;
};

export type ImporterDefinition = {
  name: string;
  source: ImporterSourceKind;
  permissions: string[];
  discover: (input: {
    origin: string;
    auth?: ImporterAuth;
    limits: ImporterLimits;
    checkpoint?: Record<string, unknown>;
  }) => ImporterDiscovery | Promise<ImporterDiscovery>;
};

export function isPrivateOrigin(hostname: string): boolean {
  const host = hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".local") || host === "127.0.0.1" || host === "[::1]" || host === "::1") {
    return true;
  }
  if (host === "0.0.0.0" || host === "169.254.169.254") return true;
  if (host.endsWith(".internal") || host.endsWith(".localhost")) return true;
  if (host.startsWith("10.") || host.startsWith("192.168.") || host.startsWith("169.254.")) {
    return true;
  }
  return /^172\.(1[6-9]|2\d|3[0-1])\./.test(host);
}

export function assertPublicHttpUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("That is not a URL.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Imports only fetch http or https.");
  }
  if (url.username || url.password) {
    throw new Error("Imports refuse URLs that carry credentials.");
  }
  if (isPrivateOrigin(url.hostname)) {
    throw new Error("That address is not a public origin.");
  }
  return url;
}

export function enforceImporterLimits(
  used: { pages: number; bytes: number; depth: number },
  limits: ImporterLimits = DEFAULT_IMPORTER_LIMITS,
): void {
  if (used.pages > limits.maxPages) {
    throw new Error(`This import exceeded the page limit of ${limits.maxPages}.`);
  }
  if (used.bytes > limits.maxBytes) {
    throw new Error(`This import exceeded the byte limit of ${limits.maxBytes}.`);
  }
  if (used.depth > limits.maxDepth) {
    throw new Error(`This import exceeded the depth limit of ${limits.maxDepth}.`);
  }
}

/** RFC 9309 matching for the product token sent by the first-party crawler. */
export function robotsDisallow(robotsTxt: string, path: string, product = "Freeholder-Importer"): boolean {
  type Rule = { path: string; allow: boolean };
  const groups: Array<{ agents: string[]; rules: Rule[] }> = [];
  let group: typeof groups[number] | undefined;
  let hasRules = false;
  for (const raw of robotsTxt.split(/\r?\n/)) {
    const line = raw.split("#", 1)[0]!.trim();
    const colon = line.indexOf(":");
    if (colon < 0) continue;
    const field = line.slice(0, colon).trim().toLowerCase();
    const value = line.slice(colon + 1).trim();
    if (field === "user-agent") {
      if (!group || hasRules) { group = { agents: [], rules: [] }; groups.push(group); hasRules = false; }
      group.agents.push(value.toLowerCase());
    } else if (group && (field === "allow" || field === "disallow")) {
      hasRules = true;
      if (value.startsWith("/")) group.rules.push({ path: value, allow: field === "allow" });
    }
  }
  const exact = groups.filter(item => item.agents.includes(product.toLowerCase()));
  const chosen = exact.length ? exact : groups.filter(item => item.agents.includes("*"));
  const normalize = (value: string): string => {
    let out = "";
    for (let index = 0; index < value.length; index += 1) {
      const char = value[index]!;
      if (char === "%" && /^[0-9a-f]{2}$/i.test(value.slice(index + 1, index + 3))) {
        const hex = value.slice(index + 1, index + 3).toUpperCase();
        const decoded = String.fromCharCode(parseInt(hex, 16));
        out += /^[A-Za-z0-9._~-]$/.test(decoded) ? decoded : `%${hex}`;
        index += 2;
      } else if (char.charCodeAt(0) > 127) {
        const point = value.codePointAt(index)!;
        out += [...new TextEncoder().encode(String.fromCodePoint(point))].map(byte => `%${byte.toString(16).toUpperCase().padStart(2, "0")}`).join("");
        if (point > 0xffff) index += 1;
      } else out += char;
    }
    return out;
  };
  const target = normalize(path);
  const matches = (pattern: string): boolean => {
    const exactEnd = pattern.endsWith("$");
    const body = exactEnd ? pattern.slice(0, -1) : pattern;
    // Literal segments, without a generated regexp or polynomial regexp backtracking.
    let cursor = 0;
    const segments = body.split("*");
    if (!target.startsWith(segments[0]!)) return false;
    cursor = segments[0]!.length;
    for (let index = 1; index < segments.length; index += 1) {
      const segment = segments[index]!;
      if (index === segments.length - 1 && exactEnd) return target.endsWith(segment) && target.length - segment.length >= cursor;
      const found = target.indexOf(segment, cursor);
      if (found < 0) return false;
      cursor = found + segment.length;
    }
    return !exactEnd || cursor === target.length;
  };
  let best = -1;
  let allowed = true;
  for (const rule of chosen.flatMap(item => item.rules)) {
    const pattern = normalize(rule.path);
    if (!matches(pattern)) continue;
    const weight = pattern.replace(/\*/g, "").replace(/\$$/, "").length;
    if (weight > best || (weight === best && rule.allow)) { best = weight; allowed = rule.allow; }
  }
  return !allowed;
}
