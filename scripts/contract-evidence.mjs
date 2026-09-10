// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C11.15: a successful runner exit alone does not prove each file ran.
import { resolve } from "node:path";

export function missingContractEvidence(files, report) {
  return files.filter((file) => {
    const result = report.testResults?.find((entry) => resolve(entry.name) === resolve(file));
    return !result?.assertionResults?.some((test) => test.status === "passed");
  });
}
