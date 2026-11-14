// Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0
// PREPARED/UNRUN: finite source proofs only, no model/DB import or SQL execution.
import {createHash} from "node:crypto";
import {readFileSync} from "node:fs";
import {describe,expect,it} from "vitest";
import manifest from "../../deploy/controlled-atomic-refund-bank-fence84.manifest.json";
const sha=(value:string|Buffer)=>createHash("sha256").update(value).digest("hex");
const source=(path:string)=>readFileSync(new URL(`../../${path}`,import.meta.url),"utf8");
function statement(sql:string,name:string){const starts=[...sql.matchAll(new RegExp(`CREATE(?: OR REPLACE)? FUNCTION ${name}\\(`,"g"))],start=starts.at(-1)?.index;if(start===undefined)throw Error(`Keep exact ${name}`);const dollar=sql.indexOf("$$",start),end=sql.indexOf("$$;",dollar+2);if(dollar<0||end<0)throw Error("Keep complete real SQL bodies.");return sql.slice(start,end+3);}
function body(sql:string){const begin=sql.indexOf("$$")+2;return sql.slice(begin,sql.indexOf("$$;",begin));}
describe("exact atomic refund bank late-evidence continuation",()=>{
 it("preserves the whole root fd-composed normal85 prefix",()=>{const raw=readFileSync(new URL(`../../${manifest.originalPrefix.file}`,import.meta.url));expect(raw.length).toBeGreaterThanOrEqual(manifest.originalPrefix.bytes);expect(sha(raw.subarray(0,manifest.originalPrefix.bytes))).toBe(manifest.originalPrefix.sha256);});
 it("preserves the complete frozen fd owned tail",()=>{expect(sha(source(manifest.fdOwnedTail.file))).toBe(manifest.fdOwnedTail.sha256);});
 for(const row of manifest.successors)it(`restores the exact full predecessor ${row.name}`,()=>{let actual=statement(source(manifest.ownedTail),row.name);expect(sha(body(actual))).toBe(row.afterBodySha256);for(const delta of [...row.replacements].reverse()){expect(actual.split(delta.after).length-1).toBe(delta.count);actual=actual.replace(delta.after,()=>delta.before);}expect(actual).toBe(row.beforeStatement);expect(sha(body(actual))).toBe(row.beforeBodySha256);});
 it("repairs only the manifest's missing inserted-block final newline",()=>{const row=manifest.metadataCorrection,actual=source(row.file);expect(sha(actual)).toBe(row.afterSha256);expect(actual.split(row.afterEncoded).length-1).toBe(1);expect(sha(actual.replace(row.afterEncoded,()=>row.beforeEncoded))).toBe(row.beforeSha256);});
 it("adds no SQL signature/model/column/kind/service",()=>{expect(manifest.newSignatures).toEqual([]);expect(manifest.newModels).toEqual([]);expect(manifest.newColumns).toEqual([]);expect(manifest.newKinds).toEqual([]);expect(manifest.newServices).toEqual([]);expect([...source(manifest.ownedTail).matchAll(/CREATE OR REPLACE FUNCTION ([a-z_]+)\(/g)].map(row=>row[1])).toEqual(["freeholder_controlled_atomic_refund_bank_state","freeholder_atomic_auxiliary_fee_ready"]);});
});
