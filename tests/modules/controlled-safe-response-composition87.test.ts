// Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { restoreRowHashLedgerSource } from "../helpers/row-hash-ledger-forward";

const read = (path: string) => readFileSync(path, "utf8");
const sha = (value: string) => createHash("sha256").update(value).digest("hex");
const edit = z.object({ before: z.string(), after: z.string() }).strict();
const composed = z.object({ path: z.string(), beforeSha256: z.string(), afterSha256: z.string(), edits: z.array(edit) }).strict();
const manifest = z.object({
  copyright: z.string(), protocol: z.literal("controlled_safe_response85_composition87.v1"), checklist: z.array(z.string()), status: z.string(),
  sourceSuccessor: z.object({ path: z.string(), beforeSha256: z.string(), afterSha256: z.string(), before: z.string(), after: z.string() }).strict(),
  preservedNewer: z.array(z.object({ path: z.string(), sha256: z.string() }).strict()),
  composed: z.array(composed),
}).strict().parse(JSON.parse(read("deploy/controlled-safe-response85-composition87.manifest.json")));
const frozen = z.object({
  existing: z.array(z.object({ path: z.string(), afterSha256: z.string() })),
  newFiles: z.array(z.object({ path: z.string(), sha256: z.string(), bytes: z.number() })),
}).parse(JSON.parse(read("deploy/controlled-safe-response85-source.manifest.json")));
const integration = z.object({ copyright: z.string(), protocol: z.string(), status: z.string(), files: z.array(z.object({ path: z.string(), beforeSha256: z.string(), afterSha256: z.string(), edits: z.array(edit) }).strict()) }).strict().parse(JSON.parse(read("deploy/controlled-safe-response-current-integration87.source.json")));
const contentReuse = z.object({ files: z.array(composed) }).passthrough().parse(JSON.parse(read("deploy/controlled-journal-content-reuse84-current.source.json")));
const oldProtocol = z.object({ successor: composed, masterSuccessor: z.object({ path: z.literal("MASTER.md"), beforeSha256: z.string(), afterSha256: z.string(), exactAppend: z.string() }).strict() }).passthrough().parse(JSON.parse(read("deploy/controlled-cash-origin-old-protocol88.source.json")));
const publicBoundary = z.object({ files: z.array(composed) }).passthrough().parse(JSON.parse(read("deploy/controlled-safe-public-boundary88.source.json")));
const integratedPaths = new Set(integration.files.map(row => row.path));
const publicBoundaryPaths = new Set(publicBoundary.files.map(row => row.path));

describe("controlled safe-response newer-leaf composition", () => {
  it("uses literal byte replacement in the reported frozen-source successor", () => {
    const row = manifest.sourceSuccessor;
    const actual = read(row.path);
    expect(sha(actual)).toBe(row.afterSha256);
    expect(actual.split(row.after)).toHaveLength(2);
    const restored = actual.replace(row.after, () => row.before);
    expect(sha(restored)).toBe(row.beforeSha256);
  });

  it.each(manifest.composed.filter(row => !integratedPaths.has(row.path) && !publicBoundaryPaths.has(row.path)))("reverses only declared S0 edits to the exact preserved predecessor: $path", row => {
    let restored = restoreRowHashLedgerSource(row.path, read(row.path));
    expect(sha(restored)).toBe(row.afterSha256);
    for (const delta of [...row.edits].reverse()) {
      expect(restored.split(delta.after)).toHaveLength(2);
      restored = restored.replace(delta.after, () => delta.before);
    }
    expect(sha(restored)).toBe(row.beforeSha256);
  });

  it.each(integration.files)("reverses only current-integration edits to the exact current predecessor: $path", row => {
    let restored = restoreRowHashLedgerSource(row.path, read(row.path));
    const boundary = publicBoundary.files.find(file => file.path === row.path);
    if (boundary) {
      expect(sha(restored)).toBe(boundary.afterSha256);
      for (const delta of [...boundary.edits].reverse()) {
        expect(restored.split(delta.after)).toHaveLength(2);
        restored = restored.replace(delta.after, () => delta.before);
      }
      expect(sha(restored)).toBe(boundary.beforeSha256);
    }
    const latest = contentReuse.files.find(file => file.path === row.path);
    if (latest) {
      expect(sha(restored)).toBe(latest.afterSha256);
      for (const delta of [...latest.edits].reverse()) {
        expect(restored.split(delta.after)).toHaveLength(2);
        restored = restored.replace(delta.after, () => delta.before);
      }
      expect(sha(restored)).toBe(latest.beforeSha256);
    }
    if (row.path === oldProtocol.successor.path) {
      const exact = oldProtocol.successor;
      expect(sha(restored)).toBe(exact.afterSha256);
      for (const delta of [...exact.edits].reverse()) {
        expect(restored.split(delta.after)).toHaveLength(2);
        restored = restored.replace(delta.after, () => delta.before);
      }
      expect(sha(restored)).toBe(exact.beforeSha256);
    }
    if (row.path === oldProtocol.masterSuccessor.path) {
      const exact = oldProtocol.masterSuccessor;
      expect(sha(restored)).toBe(exact.afterSha256);
      expect(restored.split(exact.exactAppend)).toHaveLength(2);
      restored = restored.replace(exact.exactAppend, "");
      expect(sha(restored)).toBe(exact.beforeSha256);
    }
    expect(sha(restored)).toBe(row.afterSha256);
    for (const delta of [...row.edits].reverse()) {
      expect(restored.split(delta.after)).toHaveLength(2);
      restored = restored.replace(delta.after, () => delta.before);
    }
    expect(sha(restored)).toBe(row.beforeSha256);
  });

  it.each(publicBoundary.files.filter(row => !integratedPaths.has(row.path)))("reverses only public-boundary edits to the exact predecessor: $path", row => {
    let restored = restoreRowHashLedgerSource(row.path, read(row.path));
    expect(sha(restored)).toBe(row.afterSha256);
    for (const delta of [...row.edits].reverse()) {
      expect(restored.split(delta.after)).toHaveLength(2);
      restored = restored.replace(delta.after, () => delta.before);
    }
    expect(sha(restored)).toBe(row.beforeSha256);
  });

  it("keeps every non-conflicting frozen runtime successor byte-identical", () => {
    const exceptions = new Set([...manifest.composed.map(row => row.path), ...integratedPaths, ...publicBoundaryPaths, "MASTER.md"]);
    for (const row of frozen.existing.filter(row => !exceptions.has(row.path))) expect(sha(read(row.path))).toBe(row.afterSha256);
  });

  it("keeps frozen new files exact except declared composition successors", () => {
    const exceptions = new Set([manifest.sourceSuccessor.path, ...manifest.composed.map(row => row.path), ...integratedPaths, ...publicBoundaryPaths]);
    for (const row of frozen.newFiles.filter(row => !exceptions.has(row.path))) {
      const actual = read(row.path);
      expect(Buffer.byteLength(actual)).toBe(row.bytes);
      expect(sha(actual)).toBe(row.sha256);
    }
  });

  it.each(manifest.preservedNewer.filter(row => !integratedPaths.has(row.path)))("does not overwrite the integrated-newer concern: $path", row => {
    expect(sha(read(row.path))).toBe(row.sha256);
  });

  it("finishes synchronous original-call validation before asynchronous verification views", () => {
    const proof = read("src/modules/subscriptions/controlled-provider-proof.ts");
    const validated = proof.indexOf("validatedCalls.set(call,");
    const views = proof.indexOf("Promise.all(verifications.map");
    expect(validated).toBeGreaterThan(-1);
    expect(views).toBeGreaterThan(validated);
    expect(proof).toContain("return resolveControlledVerificationView(tx,operation,call,finish,verification)");
    expect(proof).toContain("verification.actualResult.protocol!==CONTROLLED_HISTORICAL_FIN_PROTOCOL&&merchantTaxDigest(finish.actualResult.result)");
  });
});
