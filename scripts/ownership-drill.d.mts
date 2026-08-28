// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
export function guardedDrillUrl(value?: string): {
  url: URL;
  database: string;
};
export function runOwnershipDrill(options: {
  sourceDatabaseUrl?: string;
  configPath?: string;
  environment?: NodeJS.ProcessEnv;
  pairs?: string[][];
}): Promise<{
  pairs: number;
  tables: number;
  rows: number;
  assets: number;
  objects: number;
}>;
export const TIER1_TARGETS: string[];
export function tier1Pairs(): string[][];
