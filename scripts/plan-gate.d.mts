// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: AGPL-3.0-only

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
export function validatePlan(files: Map<string, string>): PlanIssue[];
export function readWorkspaceFiles(): Map<string, string>;
