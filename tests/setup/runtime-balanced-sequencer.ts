// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Vitest's default sharder hashes paths and divides by file count. That is
// reproducible, but it treats a millisecond contract test and a multi-minute
// database/media integration file as equal work. CI therefore uses a stable
// longest-processing-time partition based on measured outliers plus a source
// estimate for every other (including newly added) test file.
import { readFileSync } from "node:fs";
import { relative } from "node:path";
import { BaseSequencer, type TestSpecification } from "vitest/node";

const FILE_STARTUP_MS = 1_500;

// Durations are rounded-up observations from the Linux CI run that exposed the
// old path-hash imbalance. Keep only material outliers here: ordinary and new
// files are estimated below, so this is not an exhaustive or brittle manifest.
// Refresh an entry when a deliberate test redesign materially changes its cost.
const MEASURED_DURATION_MS: Readonly<Record<string, number>> = Object.freeze({
  "tests/core/availability.test.ts": 76_000,
  "tests/core/booking-audiences.test.ts": 58_000,
  "tests/core/booking-concurrency.test.ts": 60_000,
  "tests/core/contact-duplicate-review.test.ts": 35_000,
  "tests/core/contribute.test.ts": 83_000,
  "tests/core/invoicing.test.ts": 49_000,
  "tests/core/mail-service.test.ts": 52_000,
  "tests/core/media-capture.test.ts": 62_000,
  "tests/core/media.test.ts": 123_000,
  "tests/core/notifications.test.ts": 74_000,
  "tests/core/recurring-invoices.test.ts": 71_000,
  "tests/core/seed-demo.test.ts": 52_000,
  "tests/core/signup-contact-import.test.ts": 80_000,
  "tests/core/spine.test.ts": 167_000,
  "tests/core/agents-budgets.test.ts": 66_000,
  "tests/core/agents-inbound.test.ts": 33_000,
  "tests/modules/referrals-commission.test.ts": 31_000,
});

export interface WeightedTestFile<T = string> {
  id: string;
  value: T;
  weight: number;
}

export interface TestShard<T = string> {
  files: Array<WeightedTestFile<T>>;
  weight: number;
}

function slash(path: string): string {
  return path.replaceAll("\\", "/");
}

export function estimateTestFileDurationMs(id: string, source: string): number {
  const normalizedId = slash(id);
  const measured = MEASURED_DURATION_MS[normalizedId];
  if (measured !== undefined) return measured + FILE_STARTUP_MS;

  const declarations = source.match(
    /\b(?:it|test)(?:\.(?:concurrent|each|skip|todo))?\s*\(/g,
  )?.length ?? 1;
  const databaseBacked =
    /["']@\/core\/(?:db|runtime)["']/.test(source) ||
    /\b(?:truncateAll|resetDatabase|ready)\s*\(/.test(source);

  // Database-backed cases are dominated by setup, cleanup and round trips;
  // pure contracts are dominated by module transformation. Source bytes are a
  // small secondary signal for parametrized tests the declaration count misses.
  const assertionWorkMs = declarations * (databaseBacked ? 1_100 : 35);
  const transformWorkMs = Math.ceil(Buffer.byteLength(source, "utf8") / 48);
  return FILE_STARTUP_MS + assertionWorkMs + transformWorkMs;
}

export function balanceTestFiles<T>(
  files: ReadonlyArray<WeightedTestFile<T>>,
  shardCount: number,
): Array<TestShard<T>> {
  if (!Number.isSafeInteger(shardCount) || shardCount < 1) {
    throw new RangeError("shardCount must be a positive safe integer");
  }
  if (files.some((file) => !Number.isFinite(file.weight) || file.weight <= 0)) {
    throw new RangeError("every test-file weight must be finite and positive");
  }

  const shards = Array.from({ length: shardCount }, (): TestShard<T> => ({
    files: [],
    weight: 0,
  }));
  const ordered = [...files].sort(
    (left, right) => right.weight - left.weight || left.id.localeCompare(right.id),
  );

  for (const file of ordered) {
    const target = shards.reduce((best, candidate) => {
      if (candidate.weight !== best.weight) {
        return candidate.weight < best.weight ? candidate : best;
      }
      if (candidate.files.length !== best.files.length) {
        return candidate.files.length < best.files.length ? candidate : best;
      }
      return best;
    });
    target.files.push(file);
    target.weight += file.weight;
  }

  return shards;
}

export default class RuntimeBalancedSequencer extends BaseSequencer {
  private readonly descriptions = new Map<
    string,
    WeightedTestFile<TestSpecification>
  >();

  private describe(specification: TestSpecification): WeightedTestFile<TestSpecification> {
    const cached = this.descriptions.get(specification.taskId);
    if (cached) return cached;
    const id = slash(relative(this.ctx.config.root, specification.moduleId));
    const source = readFileSync(specification.moduleId, "utf8");
    const description = {
      id,
      value: specification,
      weight: estimateTestFileDurationMs(id, source),
    };
    this.descriptions.set(specification.taskId, description);
    return description;
  }

  override async shard(files: TestSpecification[]): Promise<TestSpecification[]> {
    const shard = this.ctx.config.shard;
    if (!shard) return files;
    const plan = balanceTestFiles(files.map((file) => this.describe(file)), shard.count);
    return plan[shard.index - 1]?.files.map((file) => file.value) ?? [];
  }

  override async sort(files: TestSpecification[]): Promise<TestSpecification[]> {
    return files
      .map((file) => this.describe(file))
      .sort((left, right) => right.weight - left.weight || left.id.localeCompare(right.id))
      .map((file) => file.value);
  }
}
