// Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0
// C1.08/C3.47/C11.14: immutable membership and media receipts use distinct digests.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { objectKeyDigest } from "@/core/media/write-ledger";

const migration = readFileSync("db/migrations/0081_import_crawl_sources.sql", "utf8");
const capturedKey = "'imports/'||original.run_id::text||'/'||original.upload_id::text||'/'||lpad(original.chunk_index::text,5,'0')||'.part'";
const vectors = [
  { part: "00000", ledger: "cf2384fb5adb576d5bd4bf1573b8a09701efbbb1373f4475634cd44c396d3d53", membership: "8dbad6764389944e285c4e18e10c5af21b3327e73f1d2ca918dc0335b6738a30" },
  { part: "00024", ledger: "34ad9bce3fc0abbccc696d4fd1ff343748c8521e60ec27bb3147af239319fa01", membership: "0e37c0c7443e0542130f25450011a18c377401b8f2e6d57ea74ff1d32bfcb381" },
];
const digest = (bytes: Uint8Array | string) => createHash("sha256").update(bytes).digest("hex");

describe("uploaded original media-ledger digest binding (C1.08/C3.47/C11.14)", () => {
  it.each(vectors)("matches the fixed original chunk $part vector without adopting its plain membership digest", ({ part, ledger, membership }) => {
    const key = `imports/00000000-0000-4000-8000-000000000001/00000000-0000-4000-8000-000000000002/${part}.part`;
    expect(objectKeyDigest(key)).toBe(ledger);
    expect(digest(key)).toBe(membership);
    expect(ledger).not.toBe(membership);
    expect(digest(`freeholder:media-object-key:v1${key}`)).not.toBe(ledger);
  });

  it("binds all four physical joins to the media ledger's exact UTF-8 domain and NUL bytes", () => {
    const expressions = [...migration.matchAll(/convert_to\('([^']+)','UTF8'\)\|\|decode\('([a-f0-9]+)','hex'\)\|\|convert_to\(/g)];
    expect(expressions).toHaveLength(4);
    for (const [, prefix, separator] of expressions) {
      expect(prefix).toBe("freeholder:media-object-key:v1");
      expect(separator).toBe("00");
      for (const { part, ledger } of vectors) {
        const key = `imports/00000000-0000-4000-8000-000000000001/00000000-0000-4000-8000-000000000002/${part}.part`;
        expect(digest(Buffer.concat([Buffer.from(prefix!, "utf8"), Buffer.from(separator!, "hex"), Buffer.from(key, "utf8")]))).toBe(ledger);
      }
    }
    expect(migration).not.toMatch(/chr\(0\)/i);
  });

  it("uses only exact immutable captured chunks or the exact validated original task key for receipt lookups", () => {
    const encoded = (key: string) => `encode(sha256(convert_to('freeholder:media-object-key:v1','UTF8')||decode('00','hex')||convert_to(${key},'UTF8')),'hex')`;
    for (const alias of ["original_put", "deletion", "physical"]) {
      expect(migration).toContain(`${alias}.key_digest=${encoded(capturedKey)}`);
      expect(migration).not.toContain(`${alias}.key_digest=original.key_digest`);
    }
    expect(migration).toContain(`physical.key_digest=${encoded("requested.key")}`);
    expect(migration).toContain("original.key_digest=encode(sha256(convert_to(requested.key,'UTF8')),'hex')");
    expect(migration).toContain(`CONSTRAINT import_source_erasure_objects_key_binding CHECK(key_digest=encode(sha256(convert_to(${capturedKey.replaceAll("original.", "")},'UTF8')),'hex'))`);
  });

  it("retains accepted original PUT/DELETE, namespace, hold and live-operation refusal requirements", () => {
    const projection = migration.slice(migration.indexOf("CREATE FUNCTION freeholder_source_graph_projection_retired("), migration.indexOf("CREATE FUNCTION freeholder_refuse_erased_source_graph_admission("));
    expect(projection).toContain("original_put.operation_kind='put' AND original_put.state='accepted' AND original_put.deleted_at IS NOT NULL");
    expect(projection).toContain("deletion.storage_namespace=original_put.storage_namespace AND deletion.operation_kind='delete' AND deletion.state='accepted'");
    expect(projection).toContain("NOT freeholder_source_upload_held(member.run_id,member.upload_id)");
    expect(projection).toContain("physical.state IN ('unverified','started','unknown') OR physical.operation_kind='put' AND physical.deleted_at IS NULL");
    expect(projection).toContain("graph.generation=member.graph_generation AND graph.source_revision=member.source_revision");
  });
});
