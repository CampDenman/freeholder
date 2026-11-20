// Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0
// PREPARED/UNRUN source preservation; actual PG creation is separately REQUIRED.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe,expect,it } from "vitest";
import { z } from "zod";
const read=(path:string)=>readFileSync(new URL(`../../${path}`,import.meta.url),"utf8"),hash=(text:string)=>createHash("sha256").update(text).digest("hex");
const manifest=z.object({status:z.literal("SOURCE_ONLY_PREPARED_UNRUN"),materialization:z.string(),sources:z.record(z.string(),z.string()),replacementSha256:z.string(),functions:z.array(z.object({name:z.string(),signature:z.string(),source:z.string(),beforeStatementSha256:z.string(),replacement:z.string(),afterStatementSha256:z.string(),caseOperands:z.array(z.object({before:z.string(),after:z.string()}))}))}).parse(JSON.parse(read("deploy/controlled-cash-application-case84.manifest.json")));
function statement(text:string,prefix:string,name:string){const start=text.indexOf(`${prefix}${name}(`);if(start<0)throw Error("Missing original complete function statement");const end=text.indexOf("END $$;",start);if(end<0)throw Error("Missing actual function terminator");return text.slice(start,end+7);}
describe("exact scalar CASE source-only replacement manifest",()=>{
 it("retains every frozen source byte and requires replacement before original CREATE validation",()=>{for(const[path,sha]of Object.entries(manifest.sources))expect(hash(read(path))).toBe(sha);expect(manifest.materialization).toContain("ORIGINAL creation positions");expect(manifest.materialization).toContain("Do not execute invalid original definitions first");expect(manifest.functions).toHaveLength(7);});
 it.each(manifest.functions)("preserves complete original $signature except its recorded scalar operand parentheses",entry=>{const original=statement(read(entry.source),"CREATE FUNCTION ",entry.name),replacement=statement(read(entry.replacement),"CREATE OR REPLACE FUNCTION ",entry.name);expect(hash(original)).toBe(entry.beforeStatementSha256);expect(hash(replacement)).toBe(entry.afterStatementSha256);let normalized=replacement.replace("CREATE OR REPLACE FUNCTION ","CREATE FUNCTION ");for(const operand of entry.caseOperands){expect(operand.after).toBe(`(${operand.before})`);expect(replacement).toContain(operand.after);normalized=normalized.replaceAll(operand.after,operand.before);}expect(normalized).toBe(original);});
 it("changes no tables/triggers or checks by masking function-body validation",()=>{const sql=read("deploy/controlled-cash-application-case84.fragment.sql");expect(hash(sql)).toBe(manifest.replacementSha256);expect(sql).not.toMatch(/CREATE\s+(?:TABLE|TRIGGER)|check_function_bodies|DISABLE\s+TRIGGER|SET\s+CONSTRAINTS/i);});
});
