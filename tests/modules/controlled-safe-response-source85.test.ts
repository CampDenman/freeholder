// Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0
// C11.10/C1.08 PREPARED/UNRUN: exact source preservation, not SQL/native acceptance.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe,expect,it } from "vitest";
import { z } from "zod";
const source=(path:string)=>readFileSync(path,"utf8"),sha=(value:string)=>createHash("sha256").update(value).digest("hex");
const statement=z.object({name:z.string(),beforeStatement:z.string(),afterStatement:z.string(),beforeBodySha256:z.string(),afterBodySha256:z.string(),edits:z.array(z.object({before:z.string(),after:z.string()})),wholeReversalExact:z.literal(true)});
const manifest=z.object({newModels:z.literal(0),newColumns:z.literal(0),newTriggers:z.literal(0),newServices:z.literal(0),newFunctions:z.array(z.object({name:z.string(),bodySha256:z.string()})),successors:z.array(statement),normal85Untouched:z.literal(true),fragment:z.object({path:z.string(),sha256:z.string(),bytes:z.number()})}).parse(JSON.parse(source("deploy/controlled-safe-response85.manifest.json")));
const body=(value:string)=>value.slice(value.indexOf("$$")+2,value.lastIndexOf("$$;"));
describe("current safe response exact owned source",()=>{
 it("retains all fourteen complete old bodies reversibly without changing original guard predicates",()=>{
  expect(manifest.successors.map(row=>row.name).sort()).toEqual(["freeholder_controlled_writer","freeholder_controlled_operation_admissible","freeholder_controlled_zero_closure_valid","freeholder_controlled_collection_writer","freeholder_controlled_target_operation_admissible","freeholder_controlled_proration_source","freeholder_controlled_original_period_source","freeholder_controlled_collection_inventory","freeholder_controlled_cash_application_shape","freeholder_controlled_cash_bank_invoice","freeholder_controlled_receipt_bank_observation","freeholder_controlled_subscription_route_ready","freeholder_atomic_auxiliary_fee_prepost_bank","freeholder_atomic_auxiliary_fee_ready"].sort());
  for(const row of manifest.successors){let reversed=row.afterStatement;for(const edit of [...row.edits].reverse()){expect(reversed.split(edit.after)).toHaveLength(2);reversed=reversed.replace(edit.after,()=>edit.before);}expect(reversed).toBe(row.beforeStatement);expect(sha(body(row.beforeStatement))).toBe(row.beforeBodySha256);expect(sha(body(row.afterStatement))).toBe(row.afterBodySha256);}
 });
 it("pins the latest receipt-owner auxiliary reader rather than its superseded initial copy",()=>{
  const prior=z.object({successors:z.array(z.object({name:z.string(),afterBodySha256:z.string()}))}).parse(JSON.parse(source("deploy/atomic-auxiliary-fee-closure-owner85.manifest.json")));
  const current=manifest.successors.find(row=>row.name==="freeholder_atomic_auxiliary_fee_prepost_bank");expect(current?.beforeBodySha256).toBe(prior.successors.find(row=>row.name==="freeholder_atomic_auxiliary_fee_prepost_bank")?.afterBodySha256);
  expect(current?.afterStatement).toContain("target_owner.subscription_charge_receipt_id=receipt_row.id");
  expect(current?.afterStatement).toContain("source_cash=origin_fact.actual->'raw'->'cash';");
 });
 it("has exactly three new headers and keeps safe UNKNOWN retention separate from authority",()=>{
  expect(manifest.newFunctions.map(row=>row.name).sort()).toEqual(["freeholder_controlled_safe_response_valid","freeholder_controlled_safe_call_admissible","freeholder_controlled_safe_response_ready"].sort());
  const sql=source(manifest.fragment.path);expect(sha(sql)).toBe(manifest.fragment.sha256);expect(Buffer.byteLength(sql)).toBe(manifest.fragment.bytes);
  expect(sql).toContain("context='authority' AND count_value<>0");expect(sql).toContain("SAFE positive/UNKNOWN");
  const origin=source("deploy/subscription-controlled-provider80.fragment.sql");expect(origin).not.toContain("controlled_provider_safe_response.v1");
 });
 it("starts a new rollout with actual fresh backend/prepared checks and sorted NOWAIT locks",()=>{
  const sql=source(manifest.fragment.path),first=sql.indexOf("DO $$"),definition=sql.indexOf("CREATE FUNCTION");expect(first).toBeGreaterThan(-1);expect(first).toBeLessThan(definition);
  const guard=sql.slice(first,definition);expect(guard.match(/PERFORM pg_stat_clear_snapshot\(\)/g)).toHaveLength(4);expect(guard).toContain("pg_prepared_xacts");expect(guard).toContain("ACCESS EXCLUSIVE MODE NOWAIT");
  expect(guard).toMatch(/subscription_controlled_calls,subscription_controlled_charge_origins,subscription_controlled_closures,\s+subscription_controlled_facts,subscription_controlled_finishes,subscription_controlled_operations,\s+subscription_controlled_resources,subscription_controlled_stops,subscription_controlled_verifications/);
 });
 it("validates actual stored admission only after insert while BEFORE checks NEW directly",()=>{
  const runtime=source("src/modules/subscriptions/controlled-provider-runtime.ts"),insert=runtime.indexOf("await ctx.tx.insert(subscriptionControlledCalls)"),stored=runtime.indexOf("freeholder_controlled_safe_call_admissible(");expect(insert).toBeGreaterThan(-1);expect(stored).toBeGreaterThan(insert);
  const writer=manifest.successors.find(row=>row.name==="freeholder_controlled_writer")?.afterStatement;expect(writer).toContain("payload->>'responseProjectionProtocol' IS DISTINCT FROM 'controlled_provider_safe_response.v1'");expect(writer).not.toContain("freeholder_controlled_safe_call_admissible(NEW.id)");
 });
 it("retains distinct original frame/result/PG/reference roles without copying or re-signing old FIN",()=>{
  const proof=source("src/modules/subscriptions/controlled-provider-safe-response-proof.ts");for(const name of ["originalSignedFrameDigest","originalSdkResultDigest","originalFinishPgSha256","originalFramePgSha256","originalResultPgSha256","safeViewDigest","safeViewPgSha256"])expect(proof).toContain(name);
  expect(proof).toContain('const REFERENCE_PURPOSE="controlled-historical-fin-reference.v1"');expect(proof).not.toContain("signProviderReadProof(");expect(proof).not.toContain("insert(subscriptionControlledFinishes)");
  expect(source("src/modules/subscriptions/controlled-provider-execution.ts")).toContain("verificationView?.requiresFreshObservation");
 });
});
