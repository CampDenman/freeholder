// Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0
// PREPARED/UNRUN read-only SQL primitive checks, NOT actual batch acceptance.
// Starts no runtime jobs/provider, inserts no rows and fabricates no context.
import { afterAll,beforeAll,describe,expect,it } from "vitest";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { db } from "@/core/db";
import { merchantTaxDigest } from "@/modules/invoicing/merchant-tax-store";
import { hasDatabase,closeDb } from "../helpers/spine";
describe.runIf(hasDatabase)("future exact controlled-stage SQL primitives (not native money qualification)",()=>{
 beforeAll(async()=>{const[row]=await db().execute<{ready:boolean}>(sql`select to_regprocedure('freeholder_controlled_cash_ascii_canonical(jsonb)') is not null and to_regprocedure('freeholder_controlled_cash_stage(uuid,uuid,uuid)') is not null and to_regprocedure('freeholder_controlled_cash_before_settlement(uuid)') is not null as ready`);expect(row?.ready).toBe(true);});
 afterAll(closeDb);
 it.each([0,1,Number.MAX_SAFE_INTEGER])("keeps the explicit safe integer %s JS-canonical digest domain distinct from PG row hashing",async amount=>{
  const body={originalOwnerDigest:"a".repeat(64),payment:{id:randomUUID(),invoiceId:randomUUID(),provider:"stripe",method:"provider_schedule",currency:"CAD",amountMinor:amount,requestHash:"b".repeat(64),createdAt:"2026-11-13T12:30:00.123Z"},record:null,route:{providerAccountId:null,providerPaymentIntentRef:"pi_original",applicationFeeMinor:0,originKind:"provider_schedule",originalChargeReceiptId:randomUUID()}};
  const[row]=await db().execute<{digest:string}>(sql`select encode(sha256(convert_to(freeholder_controlled_cash_ascii_canonical(${JSON.stringify(body)}::jsonb),'UTF8')),'hex') as digest`);expect(row?.digest).toBe(merchantTaxDigest(body));
 });
 it.each([{unsupported_key:1},{amountMinor:-1},{amountMinor:0.5},{amountMinor:9007199254740992},{providerRef:"pi_nonAscii_é"}])("fails unsupported commercial canonical input %j without inventing hash equivalence",async body=>{await expect(db().execute(sql`select freeholder_controlled_cash_ascii_canonical(${JSON.stringify(body)}::jsonb)`)).rejects.toThrow();});
 it("cannot invent current payment birth, settlement or a complete stage for unknown UUIDs",async()=>{
  const batchId=randomUUID(),paymentId=randomUUID();await expect(db().execute(sql`select freeholder_controlled_cash_validate_birth(${batchId}::uuid,${paymentId}::uuid)`)).rejects.toThrow();
  await expect(db().execute(sql`select freeholder_controlled_cash_before_settlement(${paymentId}::uuid)`)).rejects.toThrow();
  await expect(db().execute(sql`select freeholder_controlled_cash_stage(${batchId}::uuid,null,null)`)).rejects.toThrow();
 });
});
