// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C3.47: one canonical raw-source capture across enabled source formats.
import { ServiceError, type ServiceContext, type Tx } from "@/core/service";

export type ImportOriginalMember = { sourceId: string; generation: string };
export type ImportOriginalCaptureContext = { requestId: string; exceptionId: string; isNew: boolean; service: ServiceContext };
type Collector = (tx: Tx, context: ImportOriginalCaptureContext) => Promise<ImportOriginalMember[]>;
const collectors = new Map<string, Collector>();

/** A format opts in only when its actual runtime/privacy registration occurs.
 * The parent retains its real context and seals exactly once, after every
 * original generation has been gathered in the same identity-locked TX.
 */
export function registerImportOriginalCollector(name: string, collect: Collector): void {
  if (!name || collectors.has(name)) throw new Error("An original-source collector requires its own unique name.");
  collectors.set(name, collect);
}

export async function collectAdditionalImportOriginals(tx: Tx, context: ImportOriginalCaptureContext): Promise<ImportOriginalMember[]> {
  if (!context.isNew || context.service.tx !== tx) throw new ServiceError("internal", "Original source capture requires the actual first hold transaction.");
  const members: ImportOriginalMember[] = [];
  for (const name of [...collectors.keys()].sort()) {
    members.push(...await collectors.get(name)!(tx, context));
    if (members.length > 10_000) throw new ServiceError("conflict", "These original source generations need bounded owner review.");
  }
  return members;
}
