// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Types for the importable DCO sign-off evaluator (MASTER.md C1.20, §4.8).
export interface DcoCommit {
  sha: string;
  parents: string[];
  authorName: string;
  authorEmail: string;
  committerName: string;
  committerEmail: string;
  subject: string;
  message: string;
}

export interface DcoRemediation {
  sha: string;
  name: string;
  email: string;
}

export interface DcoFailure {
  sha: string;
  reason: string;
  subject: string;
}

export function evaluateSignOffs(
  commits: DcoCommit[],
  options?: { remediations?: DcoRemediation[]; allowRemediation?: boolean },
): DcoFailure[];

export function readCommits(range: string): DcoCommit[];
