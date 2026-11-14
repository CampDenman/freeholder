// Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0
// PREPARED/UNRUN. Exact source/body reversals, no database or model import.
import {createHash} from "node:crypto";
import {readFileSync} from "node:fs";
import {describe,expect,it} from "vitest";
import manifest from "../../deploy/controlled-atomic-refund-current-bank84.manifest.json";
const sha=(text:string|Buffer)=>createHash("sha256").update(text).digest("hex");
const source=(path:string)=>readFileSync(new URL(`../../${path}`,import.meta.url),"utf8");
function statement(sql:string,name:string){const declarations=[...sql.matchAll(new RegExp(`CREATE(?: OR REPLACE)? FUNCTION ${name}\\(`,"g"))],match=declarations.at(-1);if(match?.index===undefined)throw Error(`Missing exact declaration ${name}`);const start=match.index,body=sql.indexOf("$$",start),end=sql.indexOf("$$;",body+2);if(body<0||end<0)throw Error("Keep complete real function bodies.");return sql.slice(start,end+3);}
function body(sql:string){const start=sql.indexOf("$$")+2;return sql.slice(start,sql.indexOf("$$;",start));}
describe("controlled atomic refund bank exact source continuation",()=>{
 it("preserves the WHOLE prior unpublished migration prefix",()=>{const bytes=readFileSync(new URL(`../../${manifest.originalPrefix.file}`,import.meta.url));expect(bytes.length).toBeGreaterThanOrEqual(manifest.originalPrefix.bytes);expect(sha(bytes.subarray(0,manifest.originalPrefix.bytes))).toBe(manifest.originalPrefix.sha256);});
 for(const successor of manifest.successors)it(`restores the entire exact predecessor ${successor.name}`,()=>{const actual=statement(source(manifest.ownedTail),successor.name);expect(sha(body(actual))).toBe(successor.afterBodySha256);let reversed=actual;for(const replacement of [...successor.replacements].reverse()){expect(reversed.split(replacement.after).length-1).toBe(replacement.count);reversed=reversed.replace(replacement.after,()=>replacement.before);}expect(reversed).toBe(successor.beforeStatement);expect(sha(body(reversed))).toBe(successor.beforeBodySha256);});
 it("pins the one complete new bank function and exact return-column inventory",()=>{expect(manifest.newFunctions).toHaveLength(1);const fn=manifest.newFunctions[0];if(!fn)throw Error("Keep the new function inventory.");const actual=statement(source(manifest.ownedTail),"freeholder_controlled_atomic_refund_bank_state");expect(sha(body(actual))).toBe(fn.bodySha256);expect(actual).toContain(`RETURNS TABLE(${fn.returnColumns.join(",")})`);expect(manifest.newModels).toEqual([]);expect(manifest.newColumns).toEqual([]);expect(manifest.newKinds).toEqual([]);expect(manifest.newServices).toEqual([]);expect(manifest.newTriggers).toEqual([]);expect(manifest.newIndexes).toEqual([]);});
 it("restores the exact entire ordinary target source including old default digest expression",()=>{const reversal=manifest.targetSourceReversal;let actual=source(reversal.file);for(const replacement of [...reversal.replacements].reverse()){expect(actual.split(replacement.after).length-1).toBe(replacement.count);actual=actual.replace(replacement.after,()=>replacement.before);}expect(sha(actual)).toBe(reversal.beforeSha256);});
 for(const[path,digest]of Object.entries(manifest.protectedSourceFiles))it(`preserves original ${path}`,()=>{expect(sha(source(path))).toBe(digest);});
 it("keeps the actual original whole money native timeout and all assertions",()=>{expect(source("tests/modules/controlled-atomic-refund-residual84.test.ts")).toContain("{timeout:180000}");});
});
