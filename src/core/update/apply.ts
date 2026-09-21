// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C10.06/C11.10: fail closed until a host executor can prove backup, signed
// candidate identity, migrations, candidate health and recovery.
import { ServiceError, type Actor } from "@/core/service";
import type { PreflightReport } from "./preflight";

export interface UpdateTarget {
  pull: (digest: string) => Promise<void>;
  cutover: () => Promise<void>;
  rollbackCutover: () => Promise<void>;
}

const UNAVAILABLE = "Automatic updates are unavailable: this runtime has no verified host executor or recoverable database backup. Use the operator update procedure with a tested backup and pinned image digest.";
async function unavailable(): Promise<never> {
  throw new ServiceError("conflict", UNAVAILABLE);
}
export const localUpdateTarget: UpdateTarget = {
  pull: unavailable,
  cutover: unavailable,
  rollbackCutover: unavailable,
};

/** Retained as a rejecting API so older callers cannot record fake backups. */
export async function takeSnapshot(_version: string): Promise<never> {
  return unavailable();
}
export async function applyUpdate(_input: {
  toVersion?: string;
  digest?: string;
  trigger?: "schedule" | "admin" | "cli" | "agent";
  drainMs?: number;
  graceMs?: number;
  target?: UpdateTarget;
  failAt?: "migrate" | "smoke" | "cutover";
  actor: Actor;
}): Promise<{
  id: string;
  status: string;
  snapshotId: string | null;
  noteId: string | null;
  preflight: PreflightReport;
}> {
  return unavailable();
}
export class RollbackRefused extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RollbackRefused";
  }
}
export async function rollbackUpdate(_input: {
  target?: UpdateTarget;
  actor: Actor;
  breakingSince?: readonly string[];
}): Promise<{ id: string; status: string; fromVersion: string; toVersion: string }> {
  throw new RollbackRefused(UNAVAILABLE);
}
