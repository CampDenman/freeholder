// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0

export const DATASET_SIZES: {
  small: { contacts: number; messages: number; orders: number; products: number; assets: number };
  medium: { contacts: number; messages: number; orders: number; products: number; assets: number };
  large: { contacts: number; messages: number; orders: number; products: number; assets: number };
};

export const SERVER_SURFACES: readonly string[];

export function parsePerformanceBudgets(master: string): Array<{
  surface: string;
  raw: string;
  limit: number;
  unit: "ms" | "score";
  percentile: number | null;
}>;

export function requiredSurfaces(options: {
  measureBrowser?: boolean;
  measureEditor?: boolean;
  measureJobs?: boolean;
  measureMigration?: boolean;
  measureBoot?: boolean;
}): Set<string>;

export function evaluateMeasurements(input: {
  dataset: "small" | "medium" | "large";
  requested?: string;
  capable?: boolean;
  incapableReason?: string;
  measureBrowser?: boolean;
  measureEditor?: boolean;
  measureJobs?: boolean;
  measureMigration?: boolean;
  measureBoot?: boolean;
  budgets?: Array<{ surface: string; limit: number; unit: string }>;
  measurements?: Array<{ surface: string; value: number }>;
  baseline?: Record<string, number>;
  bounded?: { paginated?: boolean };
}): { ok: boolean; failures: string[] };

export function datasetFromEnv(env?: NodeJS.ProcessEnv): "small" | "medium" | "large";
export function measurementFlags(env?: NodeJS.ProcessEnv): {
  measureBrowser: boolean;
  measureEditor: boolean;
  measureJobs: boolean;
  measureMigration: boolean;
  measureBoot: boolean;
};

export function runHeader(env?: NodeJS.ProcessEnv): string;
