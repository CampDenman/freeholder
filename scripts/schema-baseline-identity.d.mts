// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0

export const FIXTURE: string;
export const BASELINE_FOLDER: string;
export const CHAIN_MARKER: string;

export function formatCatalogRow(row: {
  kind: string;
  a: string;
  b: string;
  c: string;
}): string;
export function normalizeCatalogLine(line: string): string;
export function catalogSet(text: string): Set<string>;
export function diffCatalogs(
  chainText: string,
  baselineText: string,
): { onlyChain: string[]; onlyBaseline: string[]; ok: boolean };
export function resolveChainRef(env?: NodeJS.ProcessEnv): string | null;

export function proveBaselineIdentity(options?: {
  url?: string;
  repoRoot?: string;
  env?: NodeJS.ProcessEnv;
  writeFixture?: boolean;
}): Promise<{
  ok: boolean;
  failures: string[];
  chainRef: string | null;
  skippedChainReason: string | null;
  vsFixture: { onlyChain: string[]; onlyBaseline: string[]; ok: boolean } | null;
  vsChain: { onlyChain: string[]; onlyBaseline: string[]; ok: boolean } | null;
  baselineLines: number;
}>;
