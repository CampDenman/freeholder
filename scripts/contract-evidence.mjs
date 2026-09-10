// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C11.15: a successful runner exit alone does not prove each file ran.
import { resolve } from "node:path";

function fileIdentity(file) {
  const absolute = resolve(file);
  // Vitest may canonicalize C:\\Users while the shell starts in C:\\users.
  // Windows path spelling must not erase otherwise valid execution evidence.
  return process.platform === "win32" ? absolute.toLowerCase() : absolute;
}

export function missingContractEvidence(files, report) {
  return files.filter((file) => {
    const result = report.testResults?.find((entry) => fileIdentity(entry.name) === fileIdentity(file));
    return !result?.assertionResults?.some((test) => test.status === "passed");
  });
}
