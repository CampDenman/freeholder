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
}): Promise<{ tables: number; rows: number; assets: number; objects: number }>;
