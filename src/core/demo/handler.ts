// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Guard for manifest-declared fixture services. Those services remain in the
// ordinary registry, but they may act only for an active orchestrated run and
// only on the exact provenance the orchestrator already recorded.
import { and, asc, eq } from "drizzle-orm";
import type { DemoHandlerInput, DemoRecordReference } from "@/core/onboarding/contract";
import { ServiceError, type Tx } from "@/core/service";
import { demoRecords, demoScenarioRuns } from "./schema";

function sameRecords(
  left: readonly DemoRecordReference[],
  right: readonly DemoRecordReference[],
): boolean {
  if (left.length !== right.length) return false;
  return left.every((record, index) => {
    const other = right[index];
    return (
      other?.fixtureKey === record.fixtureKey &&
      other.subjectType === record.subjectType &&
      other.subjectId === record.subjectId &&
      other.label === record.label
    );
  });
}

export async function requireDemoHandlerRun(
  tx: Tx,
  input: DemoHandlerInput,
  contribution: { key: string; version: number },
  phase: "load" | "purge" | "verify",
): Promise<void> {
  const [run] = await tx
    .select({ id: demoScenarioRuns.id })
    .from(demoScenarioRuns)
    .where(
      and(
        eq(demoScenarioRuns.id, input.runId),
        eq(demoScenarioRuns.scenarioKey, input.scenarioKey),
        eq(demoScenarioRuns.scenarioVersion, input.scenarioVersion),
        eq(demoScenarioRuns.generation, input.generation),
        eq(demoScenarioRuns.locale, input.locale),
        eq(demoScenarioRuns.status, "active"),
      ),
    )
    .limit(1);
  if (!run) {
    throw new ServiceError(
      "conflict",
      "Demo fixture handlers require an active matching orchestrated run.",
    );
  }

  const stored = await tx
    .select({
      fixtureKey: demoRecords.fixtureKey,
      subjectType: demoRecords.subjectType,
      subjectId: demoRecords.subjectId,
      label: demoRecords.label,
    })
    .from(demoRecords)
    .where(
      and(
        eq(demoRecords.runId, input.runId),
        eq(demoRecords.generation, input.generation),
        eq(demoRecords.contributionKey, contribution.key),
        eq(demoRecords.contributionVersion, contribution.version),
      ),
    )
    .orderBy(asc(demoRecords.fixtureKey));
  const supplied = [...input.records].sort((left, right) =>
    left.fixtureKey.localeCompare(right.fixtureKey),
  );
  if (phase === "load") {
    if (stored.length || supplied.length) {
      throw new ServiceError(
        "conflict",
        `Demo fixture ${contribution.key} already has provenance for this generation.`,
      );
    }
    return;
  }
  if (!sameRecords(stored, supplied)) {
    throw new ServiceError(
      "conflict",
      `Demo fixture ${contribution.key} received records that do not match stored provenance.`,
    );
  }
}
