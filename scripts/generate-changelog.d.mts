// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
export function collectChangesets(): Array<{
  filename: string;
  bumps: Array<{ package: string; kind: "major" | "minor" | "patch" }>;
  body: string;
}>;
export function renderChangelog(
  version: string,
  entries: Array<{
    filename: string;
    bumps: Array<{ package: string; kind: "major" | "minor" | "patch" }>;
    body: string;
  }>,
): string;
export function changelogTopVersion(source: string): string | null;
