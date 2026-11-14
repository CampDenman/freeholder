// Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0
// PREPARED/UNRUN. Exact source/body provenance, not installed/native proof.
import {createHash} from "node:crypto";
import {readFileSync} from "node:fs";
import {describe,expect,it} from "vitest";
import {z} from "zod";
import manifest from "../../deploy/controlled-atomic-refund160.manifest.json";
const read=(path:string)=>readFileSync(new URL(`../../${path}`,import.meta.url),"utf8");
const sha=(value:string)=>createHash("sha256").update(value).digest("hex");
const preservation=z.array(z.union([z.object({name:z.string(),unchanged:z.literal(true),beforeBodySha256:z.string()}),z.object({name:z.string(),successor:z.string(),beforeBodySha256:z.string(),afterBodySha256:z.string(),changes:z.array(z.object({before:z.string(),after:z.string(),beforeStart:z.number().int(),afterStart:z.number().int()}))})])).parse(manifest.fullBodyPreservation);
const statement=(text:string,name:string)=>{
 const actual=text.match(new RegExp(`CREATE(?: OR REPLACE)? FUNCTION ${name}\\([^]*?AS \\$\\$([^]*?)\\$\\$;`));
 if(!actual?.[0]||actual[1]===undefined)throw Error(`The actual complete source function ${name} must be present.`);return{full:actual[0],body:actual[1]};
};
describe("actual atomic fee source provenance",()=>{
 it.each(manifest.ownedTails)("pins the complete owned unapplied suffix $path",source=>{const actual=read(source.path);expect(Buffer.byteLength(actual)).toBe(source.bytes);expect(sha(actual)).toBe(source.sha256);});
 it.each(manifest.functions)("pins the full declared function $signature",source=>{const actual=statement(read(source.source),source.name);expect(sha(actual.full)).toBe(source.statementSha256);expect(sha(actual.body)).toBe(source.bodySha256);});
 it.each(preservation)("retains every prior full body and only its explicit bounded deltas: $name",source=>{
  const prior=manifest.priorFunctions.find(row=>row.name===source.name);if(!prior)throw Error("Keep the exact signed original source statement.");
  expect(sha(statement(prior.statement,source.name).body)).toBe(source.beforeBodySha256);
  expect(read("db/migrations/0080_merchant_per_party_collection.sql")+read("db/migrations/0085_controlled_collection_application.sql")).toContain(prior.statement);
  if("unchanged" in source&&source.unchanged){expect(manifest.functions.some(row=>row.name===source.name)).toBe(false);return;}
  if(!("successor" in source)||!("changes" in source)||!("afterBodySha256" in source))throw Error("Declare every source-backed successor delta.");
  const[owned]=manifest.ownedTailOrder;if(!owned)throw Error("Keep the exact first owned suffix.");
  const actual=statement(read(owned),source.successor).body;expect(sha(actual)).toBe(source.afterBodySha256);
  let restored=actual;
  for(const change of [...source.changes].sort((a,b)=>b.afterStart-a.afterStart)){
   expect(restored.slice(change.afterStart,change.afterStart+change.after.length)).toBe(change.after);
   restored=restored.slice(0,change.afterStart)+change.before+restored.slice(change.afterStart+change.after.length);
  }
  expect(restored).toBe(statement(prior.statement,source.name).body);
 });
});
