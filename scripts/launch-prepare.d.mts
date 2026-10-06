// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
export interface LaunchReport {
  target: string;
  configurationReady: boolean;
  missing: string[];
  privateEnvironmentFile: string;
  privateClaimLinkFile: string;
  setupUrl: string;
  mcpUrl: string;
  next: string[];
  note: string;
}
export function prepareLaunch(options?: { directory?: string; target?: string; url?: string; environment?: Record<string, string | undefined> }): Promise<LaunchReport>;
