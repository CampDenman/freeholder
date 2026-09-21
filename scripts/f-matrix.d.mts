// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0

export interface MatrixRow {
  id: string;
  title: string;
  cells: Map<string, string>;
}

export interface MatrixIssue {
  code: string;
  path: string;
  message: string;
}

/** The matrix document's path, relative to the repository root. */
export const MATRIX_DOC: string;
/** §43.2's twelve criteria, F01 through F12 in order. */
export const CRITERIA: string[];

/** Parse the matrix document into rows of criterion cells. */
export function parseMatrix(text: string): {
  rows: MatrixRow[];
  problems: MatrixIssue[];
};

/**
 * The row set, computed from plan-gate's parser: every live C-item in
 * document order, then the §43.18 deferral set, then one row per package and
 * first-party plugin directory.
 */
export function expectedRowIds(options: {
  masterText: string;
  packages: string[];
  plugins: string[];
}): string[];

/**
 * Validate a workspace represented as text plus path sets. `paths` is every
 * file that may be cited; `testFiles` is the suite glob, so a cited test file
 * must be one vitest actually runs.
 */
export function validateMatrix(options: {
  matrixText: string;
  masterText: string;
  paths: Set<string>;
  testFiles: Set<string>;
  packages: string[];
  plugins: string[];
}): MatrixIssue[];

/** Every test file the suite can run, relative to the repository root. */
export function readTestFiles(root?: string): Set<string>;
