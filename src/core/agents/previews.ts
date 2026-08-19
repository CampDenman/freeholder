// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Previews for managed agent writes (C4.03, MASTER.md §40).
import { redact } from "@/core/service";

export const WRITE_KINDS = [
  "blocks",
  "message",
  "money",
  "destructive",
  "write",
] as const;

export type WriteKind = (typeof WRITE_KINDS)[number];

const DESTRUCTIVE = /\.(delete|purge|erase|void|destroy)\b/;
const MONEY = /invoic|payment|refund|creditNote|giftCard|amountCents/i;
const MESSAGE = /(^mail\.|message|sendMail|newsletters\.|sms\.)/i;
const BLOCKS = /^cms\.(updatePage|updateSection|createPage)$/;

export function classifyManagedWrite(serviceName: string, input: unknown): WriteKind {
  if (DESTRUCTIVE.test(serviceName)) return "destructive";
  if (BLOCKS.test(serviceName)) return "blocks";
  if (MESSAGE.test(serviceName)) return "message";
  if (MONEY.test(serviceName)) return "money";
  if (input && typeof input === "object" && "amountCents" in input) return "money";
  return "write";
}

/** Irreversible work is never autonomous, whatever the agent's ceiling. */
export function alwaysRequiresApproval(kind: WriteKind): boolean {
  return kind === "destructive";
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
      amountCents: safe.amountCents ?? safe.amount_cents ?? null,
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
