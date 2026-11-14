// Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0
// PREPARED/UNRUN: exact old-body reversals and physical SQL lock contracts.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { z } from "zod";
const file = (path: string) => readFileSync(path, "utf8");
const sha = (source: string | Buffer) => createHash("sha256").update(source).digest("hex");
const manifest = z.object({
  prefix: z.object({ path: z.string(), bytes: z.number(), sha256: z.string() }),
  ownedTail: z.object({ path: z.string(), bytes: z.number(), sha256: z.string() }),
  newFunctions: z.array(z.object({ signature: z.string(), bodySha256: z.string() })),
  sourceReversals: z.array(z.object({ path: z.string(), beforeSha256: z.string(), afterSha256: z.string(), changes: z.array(z.object({ before: z.string(), after: z.string() })) })),
  successors: z.array(z.object({ signature: z.string(), beforeBodySha256: z.string(), afterBodySha256: z.string() })),
  readyAddedConjunction: z.string(), sourceAddedPredicate: z.string(),
}).parse(JSON.parse(file("deploy/controlled-paid-privacy85.manifest.json")));
const tail = file(manifest.ownedTail.path);
function definition(source: string, name: string) {
  const functions = [...source.matchAll(/CREATE(?: OR REPLACE)? FUNCTION (\w+)\([^\n]*?\$\$([\s\S]*?)\$\$;/g)];
  const found = functions.filter(match => match[1] === name).at(-1); if (!found?.[2]) throw Error(`Missing actual CREATE body ${name}`);
  return found[2];
}
describe("paid-access original-owner privacy source contract", () => {
  it("keeps the entire historical SQL85 prefix and pins all owned new function bodies", () => {
    const prefix = Buffer.from(file(manifest.prefix.path)); expect(prefix.length).toBeGreaterThanOrEqual(manifest.prefix.bytes);
    expect(sha(prefix.subarray(0, manifest.prefix.bytes))).toBe(manifest.prefix.sha256);
    expect(Buffer.byteLength(tail)).toBe(manifest.ownedTail.bytes); expect(sha(tail)).toBe(manifest.ownedTail.sha256);
    for (const entry of manifest.newFunctions) expect(sha(definition(tail, entry.signature.split("(")[0]!))).toBe(entry.bodySha256);
  });
  it("reverses each approved shared writer and paid handler to its entire original source without changing any old business branch", () => {
    for (const entry of manifest.sourceReversals) {
      let source = file(entry.path); expect(sha(source)).toBe(entry.afterSha256);
      for (const change of [...entry.changes].reverse()) { expect(source.split(change.after)).toHaveLength(2); source = source.replace(change.after, change.before); }
      expect(sha(source)).toBe(entry.beforeSha256);
    }
  });
  it("preserves the entire old independent effect SQL and every old ready pin by exact reversals", () => {
    const source = definition(tail, "freeholder_controlled_paid_period_source");
    expect(source.split(manifest.sourceAddedPredicate)).toHaveLength(2);
    expect(sha(source.replace(manifest.sourceAddedPredicate, ""))).toBe(manifest.successors[0]?.beforeBodySha256);
    let ready = definition(tail, "freeholder_controlled_paid_period_ready");
    expect(ready.split(manifest.readyAddedConjunction)).toHaveLength(2); ready = ready.replace(manifest.readyAddedConjunction, "");
    ready = ready.replace(manifest.successors[0]!.afterBodySha256, manifest.successors[0]!.beforeBodySha256);
    expect(sha(ready)).toBe(manifest.successors[1]?.beforeBodySha256);
  });
  it("requires the actual same database/backend/granted exclusive bigint identity key and never acquires a later lock or trusts a session marker", () => {
    const verifier = definition(tail, "freeholder_identity_privacy_exclusive");
    for (const condition of ["l.pid=pg_backend_pid()", "l.granted", "current_database()", "l.mode='ExclusiveLock'", "l.objsubid=1", "l.classid::bigint", "l.objid::bigint", "4294967295::bigint"]) expect(verifier).toContain(condition);
    expect(tail).not.toMatch(/current_setting|set_config|pg_(?:try_)?advisory_(?:xact_)?lock\(/);
    expect(definition(tail, "guard_controlled_privacy_request_identity")).toContain("OLD.contact_id IS DISTINCT FROM NEW.contact_id");
    for (const field of ["data_request_id", "scope", "expires_at"]) expect(definition(tail, "guard_controlled_privacy_hold_identity")).toContain(`OLD.${field} IS DISTINCT FROM NEW.${field}`);
  });
});
