// Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { z } from "zod";

const read = (path: string) => readFileSync(path, "utf8");
const sha = (value: string) => createHash("sha256").update(value).digest("hex");
const replacement = z.object({ before: z.string(), after: z.string(), count: z.number().int().positive() }).strict();
const successor = z.object({ name: z.string(), source: z.string(), beforeBodySha256: z.string(), afterBodySha256: z.string(), replacements: z.array(replacement) }).strict();
const manifest = z.object({
  copyright: z.string(), checklist: z.array(z.string()), status: z.string(),
  protocol: z.literal("merchant_fee_xid_epoch87.v1"),
  migration: z.object({ path: z.string(), bytes: z.number().int().positive(), sha256: z.string(), index: z.literal(87), tag: z.literal("0087_merchant_fee_xid_epoch"), when: z.literal(1793310000067) }).strict(),
  predecessors: z.object({ "0085": z.string(), "0086": z.string() }).strict(),
  successors: z.array(successor),
}).strict().parse(JSON.parse(read("deploy/merchant-fee-xid-epoch87.manifest.json")));

function statements(path: string, name: string): string[] {
  const pattern = new RegExp(`CREATE (?:OR REPLACE )?FUNCTION ${name}\\(`);
  return read(path).split("--> statement-breakpoint\n").flatMap(part => {
    const match = pattern.exec(part);
    return match?.index === undefined ? [] : [part.slice(match.index).trimEnd()];
  });
}
function onlySuccessor(name: string): string {
  const found = statements(manifest.migration.path, name);
  expect(found).toHaveLength(1);
  return found[0]!;
}
function body(statement: string): string {
  const match = /AS \$\$([\s\S]*?)\$\$;/.exec(statement);
  if (!match?.[1]) throw new Error("The complete function body is required.");
  return match[1];
}

describe("merchant fee transaction-ID epoch source continuation", () => {
  it("keeps both frozen predecessors byte-identical and pins the complete new migration", () => {
    expect(sha(read("db/migrations/0085_controlled_collection_application.sql"))).toBe(manifest.predecessors["0085"]);
    expect(sha(read("deploy/sql/0085_controlled_collection_application.unapplied.sql"))).toBe(manifest.predecessors["0085"]);
    expect(sha(read("db/migrations/0086_controlled_safe_response.sql"))).toBe(manifest.predecessors["0086"]);
    const actual = read(manifest.migration.path);
    expect(Buffer.byteLength(actual)).toBe(manifest.migration.bytes);
    expect(sha(actual)).toBe(manifest.migration.sha256);
    const journal = z.object({ entries: z.array(z.object({ idx: z.number(), tag: z.string(), when: z.number() })) }).parse(JSON.parse(read("db/migrations/meta/_journal.json")));
    expect(journal.entries.find(row => row.idx === manifest.migration.index)).toMatchObject({ idx: manifest.migration.index, tag: manifest.migration.tag, when: manifest.migration.when });
  });

  it("keeps the four mandated successors in order, then the required safe-readiness continuation", () => {
    const expected = ["freeholder_merchant_fee_birth_guard", "freeholder_merchant_fee_invocations_ready", "freeholder_atomic_auxiliary_fee_ready", "freeholder_credit_atomic_fee_ready", "freeholder_controlled_safe_response_ready"];
    expect(manifest.successors.map(row => row.name)).toEqual(expected);
    expect(read(manifest.migration.path).split("--> statement-breakpoint\n").flatMap(part => {
      const match = /CREATE (?:OR REPLACE )?FUNCTION (\w+)\(/.exec(part);
      return match?.[1] ? [match[1]] : [];
    })).toEqual(expected);
  });

  it.each(manifest.successors)("reverses every declared edit in $name to its exact selected source statement", row => {
    const sources = statements(row.source, row.name);
    expect(sources.length).toBeGreaterThan(0);
    const original = sources.at(-1)!;
    let restored = onlySuccessor(row.name);
    expect(sha(body(restored))).toBe(row.afterBodySha256);
    for (const edit of [...row.replacements].reverse()) {
      expect(restored.split(edit.after)).toHaveLength(edit.count + 1);
      restored = restored.replace(edit.after, () => edit.before);
    }
    expect(restored).toBe(original);
    expect(sha(body(restored))).toBe(row.beforeBodySha256);
  });

  it("uses numeric modulo epochs for both birth comparisons instead of raw txid text", () => {
    const birth = onlySuccessor("freeholder_merchant_fee_birth_guard");
    expect(birth.match(/born_(?:fee|post)\.xmin::text::numeric=mod\(txid_current\(\)::numeric,4294967296\)/g)).toEqual([
      "born_fee.xmin::text::numeric=mod(txid_current()::numeric,4294967296)",
      "born_post.xmin::text::numeric=mod(txid_current()::numeric,4294967296)",
    ]);
    expect(birth).not.toContain("born_fee.xmin::text=txid_current()::text");
    expect(birth).not.toContain("born_post.xmin::text=txid_current()::text");
    const epoch = (xid: bigint) => xid % 4294967296n;
    for (const [xid, xmin] of [[0n, 0n], [1n, 1n], [4294967295n, 4294967295n], [4294967296n, 0n], [4294967297n, 1n], [9223372036854775807n, 4294967295n]] as const) {
      expect(epoch(xid)).toBe(xmin);
      expect(epoch(xid + 4294967296n)).toBe(xmin);
    }
    expect(4294967296n.toString()).not.toBe(epoch(4294967296n).toString());
  });

  it("pins the safe-S0 proration and receipt-bank bodies in final credit readiness", () => {
    const credit = onlySuccessor("freeholder_credit_atomic_fee_ready");
    expect(credit).toContain("5aaddf28a223fa95a2c5bc6dc592764b3689427e8481034b9369b72eb4689213");
    expect(credit).toContain("c3602be822c07bbb6c3fda64ef3f112b8f9e3d94f7203a3f5a25eb4335ad7995");
    expect(credit).toContain("f5d5a2ae2152f22bba02dcf74bac1d8228fd4568dbb0c1b105b8f85ca7283df2");
    expect(credit).toContain("bfd70129e27dfd69fb009dd2b13961564c5a7667c453d4aa0c3ab6e35a871fc7");
  });
});
