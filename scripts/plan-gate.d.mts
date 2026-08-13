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
export function validatePlan(files: Map<string, string>): PlanIssue[];
export function readWorkspaceFiles(): Map<string, string>;
