// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Previews for managed agent writes (C4.03, MASTER.md §40).
import { redact, WRITE_CLASSES, type WriteClass } from "@/core/service";

export const WRITE_KINDS = WRITE_CLASSES;

export type WriteKind = WriteClass;

export interface WriteClassification {
  kind: WriteKind;
  /**
   * False when the service definition never declared a `writeClass`. The
   * gate fails closed on such writes: without a declaration there is no
   * proof the action is reversible, so it queues for approval whatever the
   * agent's autonomy.
   */
  declared: boolean;
}

export function classifyManagedWrite(def: {
  name: string;
  writeClass?: WriteClass;
}): WriteClassification {
  if (def.writeClass) return { kind: def.writeClass, declared: true };
  return { kind: "write", declared: false };
}

/** Irreversible work is never autonomous, whatever the agent's ceiling. */
export function alwaysRequiresApproval(classification: WriteClassification): boolean {
  return classification.kind === "destructive" || !classification.declared;
}

export function previewSummary(kind: WriteKind, serviceName: string): string {
  if (kind === "blocks") return `Change page or section blocks via ${serviceName}.`;
  if (kind === "message") return `Send a message via ${serviceName}.`;
  if (kind === "money") return `Move money via ${serviceName}.`;
  if (kind === "destructive") return `Irreversible action via ${serviceName}.`;
  return `Write via ${serviceName}.`;
}

export function buildWritePreview(
  kind: WriteKind,
  serviceName: string,
  input: unknown,
  extras: { beforeBlocks?: unknown } = {},
): Record<string, unknown> {
  const safe = (redact(input) ?? {}) as Record<string, unknown>;
  if (kind === "blocks") {
    const after = safe.blocks ?? null;
    return {
      kind,
      serviceName,
      targetId: safe.id ?? null,
      before: extras.beforeBlocks ?? null,
      after,
    };
  }
  if (kind === "message") {
    return {
      kind,
      serviceName,
      to: safe.to ?? safe.email ?? null,
      subject: safe.subject ?? null,
      body: safe.text ?? safe.body ?? safe.html ?? null,
    };
  }
  if (kind === "money") {
    return {
      kind,
      serviceName,
      amountMinor: safe.amountMinor ?? safe.amountCents ?? safe.amount_cents ?? null,
      currency: safe.currency ?? null,
      action: serviceName.split(".").slice(1).join("."),
    };
  }
  if (kind === "destructive") {
    return {
      kind,
      serviceName,
      subjectId: safe.id ?? null,
      action: serviceName.split(".").slice(1).join("."),
    };
  }
  return { kind, serviceName, input: safe };
}
