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

export function robotsDisallow(robotsTxt: string, path: string): boolean {
  const lines = robotsTxt.split(/\r?\n/);
  let applies = false;
  const disallowed: string[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (/^user-agent:\s*\*/i.test(trimmed)) {
      applies = true;
      continue;
    }
    if (/^user-agent:/i.test(trimmed)) {
      applies = false;
      continue;
    }
    const match = applies ? /^disallow:\s*(.*)$/i.exec(trimmed) : null;
    if (match) {
      const rule = match[1]?.trim() ?? "";
      if (rule) disallowed.push(rule);
    }
  }
  return disallowed.some((rule) => path.startsWith(rule));
}
