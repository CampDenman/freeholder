// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
export function missingContractEvidence(files: string[], report: {
  testResults?: Array<{
    name: string;
    assertionResults?: Array<{ status: string }>;
  }>;
}): string[];
