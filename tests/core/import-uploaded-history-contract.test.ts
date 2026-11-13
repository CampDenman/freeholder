// Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0
// C1.08/C3.47: recovery can copy a retained task, never infer its initial scope.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { originalUploadedTaskEvidence } from "@/core/import/source-erasure-contract";

const requestId = "00000000-0000-4000-8000-000000000001";
const originalJobId = "00000000-0000-4000-8000-000000000002";
const keys = ["imports/00000000-0000-4000-8000-000000000003/00000000-0000-4000-8000-000000000004/00000.part"];
describe("retained uploaded erasure history evidence (C1.08/C3.47)", () => {
  it("retains the exact original task keys and both original identities", () => {
    expect(originalUploadedTaskEvidence({ requestId, originalJobId, keys }, originalJobId, requestId)).toEqual({ requestId, originalJobId, keys });
  });
  it("refuses a different durable task or request instead of retargeting its keys", () => {
    expect(originalUploadedTaskEvidence({ requestId, originalJobId, keys }, requestId, requestId)).toBeNull();
    expect(originalUploadedTaskEvidence({ requestId, originalJobId, keys }, originalJobId, originalJobId)).toBeNull();
  });
  it("refuses missing, empty, excessive and noncanonical original keys", () => {
    for (const invalid of [{ requestId, originalJobId }, { requestId, originalJobId, keys: [] }, { requestId, originalJobId, keys: Array.from({ length: 26 }, () => keys[0]) }, { requestId, originalJobId, keys: ["imports/current/guess.part"] }]) {
      expect(originalUploadedTaskEvidence(invalid, originalJobId, requestId)).toBeNull();
    }
  });
  it("keeps missing initial captures in shared idempotent recovery without querying a current graph or inserting a replacement scope", () => {
    const source = readFileSync("src/core/import/source-erasure-history.ts", "utf8");
    expect(source).toContain("originalUploadedTaskEvidence(original.data, original.id, request.id)");
    expect(source).toContain("erasureArtifactIsIntact(artifact)");
    expect(source).toContain("await ctx.call(reopenErasureJob");
    expect(source).toContain("jobData: { keys: task.keys }");
    expect(source).toContain("retry.job_id=job.id");
    expect(source).toContain("uploaded-initial-scope-v1:");
    expect(source).not.toMatch(/from\s+import_(?:runs|source_graphs|source_entries|source_media)\b/i);
    expect(source).not.toMatch(/insert\s+into\s+import_source_erasure|\.insert\(importSourceErasure/i);
  });
});
