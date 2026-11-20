// Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0
// Synthetic digest inputs test historical comparison, NEVER bank authority.
import { describe,expect,it } from "vitest";
import { controlledObservationEntries,type ObservationFingerprint } from "@/modules/invoicing/controlled-cash-observation-revision";
import type { ControlledCashInspectionAncestry } from "@/modules/subscriptions/controlled-provider-cash-inspection-ancestry";
const id="11111111-1111-4111-8111-111111111111",other="22222222-2222-4222-8222-222222222222",pg="a".repeat(64),canonical="b".repeat(64),foreign="c".repeat(64);
const row=(domain:ObservationFingerprint["domain"]="postgres_row",fingerprint=pg):ObservationFingerprint=>({table:"merchant_cash_return_observations",id,fingerprint,domain});
const owned=(overrides:Partial<ControlledCashInspectionAncestry["entries"][number]>={}):ControlledCashInspectionAncestry["entries"][number]=>({table:"merchant_cash_return_observations",id,fingerprint:pg,dependencyFingerprint:canonical,...overrides});
describe("exact returned-own causal comparison",()=>{
 it("keeps every current occurrence and separates PostgreSQL from canonical dependency bytes",()=>{
  const result=controlledObservationEntries([row(),row("dependency_canonical",canonical)],{entries:[owned()]});
  expect(result.full).toEqual([{key:`merchant_cash_return_observations:${id}`,postgres_row:pg,dependency_canonical:canonical}]);expect(result.causal).toEqual([]);expect(result.physicalRowCount).toBe(1);
 });
 it("does not remove an unrelated repeated capture or raw positive fact",()=>{
  const result=controlledObservationEntries([row(),{table:"merchant_refund_observation_captures",id:other,fingerprint:foreign,domain:"postgres_row"},{table:"subscription_controlled_facts",id:other,fingerprint:pg,domain:"postgres_row"}],{entries:[owned()]});
  expect(result.full).toHaveLength(3);expect(result.causal.map(value=>value.key)).toEqual([`merchant_refund_observation_captures:${other}`,`subscription_controlled_facts:${other}`]);
 });
 it("keeps identical UUIDs in different tables as different physical identities",()=>{
  const result=controlledObservationEntries([row(),{...row(),table:"merchant_cash_return_primary_observations"}],{entries:[owned()]});expect(result.physicalRowCount).toBe(2);expect(result.causal).toHaveLength(1);
 });
 it("preserves the entire historical view when no genuinely returned ancestry is supplied",()=>{
  const result=controlledObservationEntries([row(),{...row(),id:other}]);expect(result.causal).toEqual(result.full);
 });
 it("refuses an altered PostgreSQL row even when its canonical digest matches",()=>{
  expect(()=>controlledObservationEntries([row("postgres_row",foreign),row("dependency_canonical",canonical)],{entries:[owned()]})).toThrow();
 });
 it("refuses an altered canonical dependency even when the PostgreSQL digest matches",()=>{
  expect(()=>controlledObservationEntries([row(),row("dependency_canonical",foreign)],{entries:[owned()]})).toThrow();
 });
 it("refuses conflicting copies in the same hash domain",()=>{
  expect(()=>controlledObservationEntries([row(),row("postgres_row",foreign)])).toThrow();
 });
 it("refuses duplicate removal requests rather than consuming the same own row twice",()=>{
  expect(()=>controlledObservationEntries([row()],{entries:[owned(),owned()]})).toThrow();
 });
 it("refuses an ancestry entry absent from complete current coverage",()=>{
  expect(()=>controlledObservationEntries([row()],{entries:[owned({id:other})]})).toThrow();
 });
 it("never treats a stable schedule projection as an exact own bank row",()=>{
  expect(()=>controlledObservationEntries([row("schedule_stable")],{entries:[owned()]})).toThrow();
 });
 it("counts distinct physical identities across both hash domains under one5000 bound",()=>{
  const rows=Array.from({length:5000},(_,index)=>({...row(),id:`physical-${index}`}));
  expect(controlledObservationEntries([...rows,...rows.map(value=>({...value,domain:"dependency_canonical" as const,fingerprint:canonical}))]).physicalRowCount).toBe(5000);
  expect(()=>controlledObservationEntries([...rows,{...row(),id:"physical-5000"}])).toThrow();
 });
 it("rejects malformed fingerprints before either current or causal revision can be used",()=>{
  expect(()=>controlledObservationEntries([row("postgres_row","unknown")])).toThrow();
 });
 it("refuses a table delimiter that could collide with an existing composite financial identity",()=>{
  expect(()=>controlledObservationEntries([{...row(),table:"merchant_cash_return_observations:foreign"}])).toThrow();
  const composite={...row(),table:"legacy_bank_feedback",id:`${pg}:${id}`};expect(controlledObservationEntries([composite]).full[0]?.key).toBe(`legacy_bank_feedback:${pg}:${id}`);
 });
 it("keeps an authentic own admission-lineage row in full history while comparing its exact original birth causally",()=>{
  const birth:ObservationFingerprint={table:"subscription_controlled_cash_inspection_lineages",id,fingerprint:pg,domain:"postgres_row"};
  const result=controlledObservationEntries([row(),birth],{entries:[owned({table:"subscription_controlled_cash_inspection_lineages"})]});expect(result.full).toHaveLength(2);expect(result.causal).toEqual([{key:`merchant_cash_return_observations:${id}`,postgres_row:pg}]);
 });
 it("cannot remove another read's or an altered admission-lineage row",()=>{
  const birth:ObservationFingerprint={table:"subscription_controlled_cash_inspection_lineages",id:other,fingerprint:foreign,domain:"postgres_row"};
  expect(()=>controlledObservationEntries([birth],{entries:[owned({table:"subscription_controlled_cash_inspection_lineages"})]})).toThrow();
  expect(()=>controlledObservationEntries([{...birth,id}],{entries:[owned({table:"subscription_controlled_cash_inspection_lineages"})]})).toThrow();
 });
});
