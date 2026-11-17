// Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0
import { ServiceError, type Tx } from "@/core/service";
import { controlledJournalPgCertificate, controlledProviderJournal } from "./controlled-provider-proof";

export type ControlledJournalComposition = Map<string, Promise<Awaited<ReturnType<typeof controlledProviderJournal>>>>;
export function createControlledJournalComposition(): ControlledJournalComposition { return new Map(); }
export function readComposedControlledProviderJournal(tx: Tx, resourceId: string, composition?: ControlledJournalComposition) {
 if (!composition) return controlledProviderJournal(tx, resourceId);
 const existing = composition.get(resourceId); if (existing) return existing;
 const current = controlledProviderJournal(tx, resourceId); composition.set(resourceId, current); return current;
}
export async function finishControlledJournalComposition(tx: Tx, composition: ControlledJournalComposition) {
 for (const [resourceId, pending] of composition) {
  const before = await pending, after = await controlledProviderJournal(tx, resourceId);
  if (controlledJournalPgCertificate(after) !== controlledJournalPgCertificate(before)) throw new ServiceError("conflict", "The controlled journal changed during its composed financial evaluation.");
 }
}
