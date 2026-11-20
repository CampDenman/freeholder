// Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { restoreRowHashLedgerSource } from "../helpers/row-hash-ledger-forward";

const record = z.object({
  artifacts: z.array(z.object({ path: z.string(), sha256: z.string() }).strict()),
  testContinuations: z.array(z.object({ path: z.string(), beforeSha256: z.string() }).passthrough()),
}).passthrough().parse(JSON.parse(readFileSync("deploy/atomic-credit-evidence-reuse90.source.json", "utf8")));
const read = (path: string) => readFileSync(path, "utf8");
const sha = (source: string) => createHash("sha256").update(source).digest("hex");

describe("current atomic-credit evidence reuse", () => {
  it.each(record.artifacts)("pins and reverses the exact current artifact: $path", artifact => {
    const current = read(artifact.path);
    expect(sha(current)).toBe(artifact.sha256);
    const continuation = record.testContinuations.find(row => row.path === artifact.path);
    expect(continuation).toBeDefined();
    expect(sha(restoreRowHashLedgerSource(artifact.path, current, continuation!.beforeSha256))).toBe(continuation!.beforeSha256);
  });
  it("retains the fee reader's own current after-checks", () => {
    const partition = read("src/modules/invoicing/atomic-credit-fee-partition.ts");
    expect(partition).toContain("const beforeEntries=await currentEntries()");
    expect(partition).toContain("merchantTaxDigest(await currentEntries())!==currentParentRevision");
  });
});
