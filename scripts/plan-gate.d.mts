// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0

export interface PlanItem {
  id: string;
  checked: boolean;
}

export interface PlanIssue {
  code: string;
  path: string;
  message: string;
}

export function checklistItems(master: string): PlanItem[];

/** Every F-code an evidence block names, expanding `F01–F03` style ranges. */
export function proofsNamed(body: string): Set<string>;

/**
 * @param today ISO date used to judge whether the control block is current.
 * @param paths Every tracked path, for resolving cited evidence. Defaults to
 *   the keys of `files`, which is text-only and therefore misses `.sh`/`.sql`.
 */
export function validatePlan(
  files: Map<string, string>,
  today?: string,
  paths?: Set<string> | null,
): PlanIssue[];
export function readWorkspaceFiles(): Map<string, string>;
export function readTrackedPaths(): Set<string>;
