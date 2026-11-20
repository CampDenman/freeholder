// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Types for the importable customer-app audit allowance policy (MASTER.md C1.20).
export interface MobileAuditAllowance {
  package: string;
  reviewedAt: string;
  expiresAt: string;
  reason: string;
}

export interface MobileAuditAdvisory {
  package?: string;
  severity?: string;
  title?: string;
}

export interface MobileAuditResult {
  errors: string[];
  found: Map<string, MobileAuditAdvisory>;
}

export function evaluateMobileAudit(
  report: unknown,
  allowed?: Map<string, MobileAuditAllowance>,
  now?: Date,
): MobileAuditResult;
