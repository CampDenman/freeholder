// Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0
// DTO/security controls; these do not stand in for native financial proof.
import { readFileSync } from "node:fs";
import { describe,expect,it } from "vitest";
import { controlledProviderCashObservationAuthority as authority } from "@/modules/invoicing/controlled-cash-observation-authority";
import { CONTROLLED_COLLECTION_PROTOCOL } from "@/modules/subscriptions/controlled-provider-collection-contract";
const collectionId="11111111-1111-4111-8111-111111111111",receiptId="22222222-2222-4222-8222-222222222222",inspectionId="33333333-3333-4333-8333-333333333333";
const input={collectionId,receiptId,requiredProtocol:CONTROLLED_COLLECTION_PROTOCOL};
describe("private debt-observing authority boundary",()=>{
 it("is a system-only non-external query with no money mutation class",()=>{
  expect(authority.def).toMatchObject({name:"invoicing.controlledProviderCashObservationAuthority",kind:"query",permission:"system",external:false});expect(authority.def.writeClass).toBeUndefined();
 });
 it("requires exact source IDs and the actual expanded producer protocol",()=>{
  expect(authority.def.input.safeParse(input).success).toBe(true);
  for(const value of [{collectionId,receiptId},{...input,requiredProtocol:"controlled_zero.v1"},{...input,receiptId:"pi_equalAmount"}])expect(authority.def.input.safeParse(value).success).toBe(false);
 });
 it("accepts only an actual inspection ID as a candidate for returned-own verification",()=>{
  expect(authority.def.input.safeParse({...input,inspectionId}).success).toBe(true);expect(authority.def.input.safeParse({...input,inspectionId:"finished"}).success).toBe(false);
 });
 it("refuses public money/coverage/source/caller overrides at the strict DTO",()=>{
  for(const injected of [{allowed:true},{principalSafe:true},{sourceRevision:"a".repeat(64)},{excludeUnadmittedOperationId:inspectionId},{ignoreCallerId:inspectionId},{amountMinor:1}])expect(authority.def.input.safeParse({...input,...injected}).success).toBe(false);
 });
 it("does not import post-application classification/state or call a payment writer",()=>{
  const source=readFileSync(new URL("../../src/modules/invoicing/controlled-cash-observation-parent.ts",import.meta.url),"utf8");
  for(const forbidden of ["controlledCollectionState","controlledTargetRawClassification","merchantRefundCashHistory","readControlledReceiptNamespace","createPayment","settlePayment","callAsSystem(","set_config("])expect(source).not.toContain(forbidden);
 });
 it("keeps the application-only authority unavailable in the ordinary module registry",()=>{
  const source=readFileSync(new URL("../../src/modules/invoicing/service.ts",import.meta.url),"utf8");expect(source).toContain('import controlledCashObservationAuthorityServices from "./controlled-cash-observation-authority"');expect(source).not.toContain('from "./controlled-cash-application-authority"');
 });
});
