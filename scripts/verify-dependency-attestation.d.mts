// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0

export interface VerifyDependencyAuditAttestationOptions {
  root?: string;
  now?: Date;
  maximumAgeHours?: number;
}

export function verifyDependencyAuditAttestation(
  document: unknown,
  options?: VerifyDependencyAuditAttestationOptions,
): Promise<void>;
