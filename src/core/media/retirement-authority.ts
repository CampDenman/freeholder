// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C1.12/C11.08: containment for legacy admissions without durable caller proof.
import { ServiceError } from "@/core/service";

/** This schema has no immutable originating runtime/finish/session evidence.
 * Accepted/verified states include early ACKs and human assertions; neither
 * can prove a paused caller stopped. No current process, timeout, HEAD404 or
 * current provider policy may backfill those missing original facts.
 *
 * The full protocol must replace this gate using its actual original caller
 * records and independently validated exact-runtime stop receipts. Keeping
 * legacy erasure pending is intentional until that protocol is available.
 */
export function hasDurableOriginalMediaCallerProof(): boolean { return false; }

export function requireDurableMediaRetirementProof(): void {
  if (!hasDurableOriginalMediaCallerProof()) throw new ServiceError("conflict", "Physical retirement remains pending: this original admission has no durable caller-finish or exact-runtime stop proof. Keep its original receipts and private bytes for recovery; a missing current file or written confirmation cannot establish erasure.");
}
