// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Types for the importable dependency-audit policy evaluator (MASTER.md C1.20).
export interface DependencyAuditResult {
  ok: boolean;
  advisories: number;
  errors: string[];
  warnings: string[];
}

export const DEPENDENCY_AUDIT_ATTESTATION_SCHEMA:
  "freeholder/dependency-audit-attestation/v1";

export function evaluateDependencyAudit(
  report: unknown,
  ledger: unknown,
  now?: Date,
): DependencyAuditResult;
