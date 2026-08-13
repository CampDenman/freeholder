// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: AGPL-3.0-only
// Types for the importable dependency-audit policy evaluator (MASTER.md C1.20).
export interface DependencyAuditResult {
  ok: boolean;
  advisories: number;
  errors: string[];
  warnings: string[];
}

export function evaluateDependencyAudit(
  report: unknown,
  ledger: unknown,
  now?: Date,
): DependencyAuditResult;
