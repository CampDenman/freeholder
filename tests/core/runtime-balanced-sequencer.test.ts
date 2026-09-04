// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import {
  balanceTestFiles,
  estimateTestFileDurationMs,
  type WeightedTestFile,
  default as RuntimeBalancedSequencer,
} from "../../scripts/runtime-balanced-sequencer";
import vitestConfig from "../../vitest.config";

function findTestFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return findTestFiles(path);
    return entry.isFile() && entry.name.endsWith(".test.ts") ? [path] : [];
  });
}

function repositoryTestWork(): Array<WeightedTestFile> {
  const root = process.cwd();
  return [join(root, "src"), join(root, "tests")]
    .flatMap(findTestFiles)
    .map((path) => {
      const id = relative(root, path).replaceAll("\\", "/");
      return {
        id,
        value: id,
        weight: estimateTestFileDurationMs(id, readFileSync(path, "utf8")),
      };
    });
}

describe("runtime-balanced CI test sharding", () => {
  it("is the sequencer wired into the repository test configuration", () => {
    expect(vitestConfig).toBeTypeOf("object");
    if (typeof vitestConfig !== "object" || vitestConfig === null) return;
    expect(vitestConfig.test?.sequence?.sequencer).toBe(RuntimeBalancedSequencer);
  });

  it("partitions every repository test exactly once with bounded predicted skew", () => {
    const files = repositoryTestWork();
    const shards = balanceTestFiles(files, 4);
    const assigned = shards.flatMap((shard) => shard.files.map((file) => file.id));
    const weights = shards.map((shard) => shard.weight);

    expect(assigned).toHaveLength(files.length);
    expect(new Set(assigned).size).toBe(files.length);
    expect(assigned.toSorted()).toEqual(files.map((file) => file.id).toSorted());
    expect(Math.max(...weights) / Math.min(...weights)).toBeLessThan(1.03);
  });

  it("is deterministic and puts the longest remaining file on the lightest shard", () => {
    const files: Array<WeightedTestFile> = [
      { id: "d", value: "d", weight: 4 },
      { id: "a", value: "a", weight: 8 },
      { id: "c", value: "c", weight: 5 },
      { id: "b", value: "b", weight: 7 },
    ];

    const first = balanceTestFiles(files, 2);
    const second = balanceTestFiles(files.toReversed(), 2);

    expect(first).toEqual(second);
    expect(first.map((shard) => shard.weight)).toEqual([12, 12]);
    expect(first[0]?.files.map((file) => file.id)).toEqual(["a", "d"]);
    expect(first[1]?.files.map((file) => file.id)).toEqual(["b", "c"]);
  });

  it("rejects invalid topology or weights and estimates new DB files conservatively", () => {
    expect(() => balanceTestFiles([], 0)).toThrow(RangeError);
    expect(() =>
      balanceTestFiles([{ id: "bad", value: "bad", weight: Number.NaN }], 1),
    ).toThrow(RangeError);

    const pure = estimateTestFileDurationMs("tests/new.test.ts", "it('x', () => {});");
    const database = estimateTestFileDurationMs(
      "tests/new.test.ts",
      'import { ready } from "@/core/runtime"; it("x", () => ready());',
    );
    expect(database).toBeGreaterThan(pure);
  });
});
