// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Types for the a11y smoke test (MASTER.md §15.7). See schema-compat-gate.d.mts
// for why the gates stay .mjs and their types live beside them.

export interface A11yViolation {
  /** axe rule id, e.g. "image-alt". */
  id: string;
  impact: "minor" | "moderate" | "serious" | "critical" | null;
  help: string;
  /** Truncated markup for each offending node. */
  nodes: string[];
}

export interface A11yResult {
  violations: A11yViolation[];
  /**
   * Rules that ran and could not reach a verdict without a browser. Not
   * passes — reported so nobody reads silence as coverage.
   */
  undecided: string[];
}

export function auditHtml(html: string, url: string): Promise<A11yResult>;
