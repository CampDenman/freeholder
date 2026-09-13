// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Types for the mobile store-readiness gate (MASTER.md §35, C10.16).

export const REQUIRED_STORE_ASSETS: string[];

export interface DiscoveryParse {
  ok: boolean;
  reason?: "unparsable" | "app-too-old";
  message?: string;
  instance?: { name: string; contractVersion: number; tagline: string | null };
}

export interface GateReview {
  ok: boolean;
  errors: string[];
  notes: string[];
  demo?: unknown;
  parsed?: DiscoveryParse | null;
  requested?: string[];
}

export function parseDiscoveryContract(payload: unknown, appContract: number): DiscoveryParse;
export function demoBusinessFromSeed(source: string): {
  name: string;
  tagline: string | null;
  country: string;
  defaultLocale: string;
  enabledLocales: string[];
  baseCurrency: string;
  timezone: string;
} | null;
export function demoDiscoveryFromSources(files: {
  discovery?: string;
  appDiscovery?: string;
  seed?: string;
  platformVersion?: string;
}): { ok: true; appContract: number; document: Record<string, unknown> } | { ok: false; errors: string[] };
export function reviewStoreAssets(
  appDir: string,
  readFile?: typeof import("node:fs").readFileSync,
  exists?: typeof import("node:fs").existsSync,
): { ok: boolean; errors: string[] };
export function requestedPermissions(input: {
  appConfig: unknown;
  appPackage: unknown;
  sourceText?: string;
}): Set<string>;
export function reviewPrivacyManifest(input: {
  appConfig: unknown;
  appPackage: unknown;
  sourceText?: string;
}): { ok: boolean; errors: string[]; requested: string[] };
export function reviewMobileStore(options: {
  appDir: string;
  files?: {
    discovery?: string;
    appDiscovery?: string;
    seed?: string;
    platformVersion?: string;
    sourceText?: string;
  };
  contractPayload?: unknown;
  appContract?: number;
  appConfig?: unknown;
  appPackage?: unknown;
  sourceText?: string;
  readFile?: typeof import("node:fs").readFileSync;
  exists?: typeof import("node:fs").existsSync;
}): GateReview;
export function runMobileStoreGate(argv?: string[], cwd?: string): GateReview;
export function main(argv?: string[], out?: { log: (msg: string) => void; error: (msg: string) => void }, cwd?: string): Promise<number>;
