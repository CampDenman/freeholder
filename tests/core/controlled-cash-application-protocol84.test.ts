// Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0
// PREPARED/UNRUN source contract; not SQL parsing, migration or native proof.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe,expect,it } from "vitest";
const read=(path:string)=>readFileSync(new URL(`../../${path}`,import.meta.url),"utf8");
const owned=read("deploy/controlled-cash-application-protocol84.fragment.sql");
describe("genuine future controlled application admission boundary",()=>{
 it("preserves the frozen bank-policy/order fragments and changes no old function body",()=>{
  expect(createHash("sha256").update(read("deploy/subscription-controlled-current-bank82.fragment.sql")).digest("hex")).toBe("b4b4c082356b0da4364c3ea46ef1314b040cdf3472bcd3c6f0ae9ce08198b28e");
  expect(createHash("sha256").update(read("deploy/controlled-bank-read-order84.fragment.sql")).digest("hex")).toBe("0f824c3a92018890f80e46763d3a915c47c1dde22ddfc4865ddecdddfc8bebce");
  expect(owned).not.toContain("CREATE OR REPLACE FUNCTION");expect(owned).not.toContain("CREATE FUNCTION guard_merchant_agreement_payment_route");
 });
 it("uses real UUID parent/source FKs and lifetime receipt/payment uniqueness, never a planned payment UUID",()=>{
  expect(owned).toContain("receipt_id uuid PRIMARY KEY REFERENCES subscription_provider_charge_receipts(id)");expect(owned).toContain("CONSTRAINT controlled_cash_links_payment_key UNIQUE(payment_id)");
  expect(owned).toContain("CREATE TRIGGER controlled_cash_payment_birth AFTER INSERT ON payments");expect(owned).toContain("VALUES(receipt_proof.receipt_id,receipt_proof.id,admitted_batch.id,NEW.id");
  expect(owned).toContain("actual_entry.family='payments' AND actual_entry.identity=NEW.id::text");expect(owned).toContain("pg_trigger_depth()<2");
 });
 it("keeps the full PG preimage and immutable bank/current namespace domains separate, retaining new callback debt",()=>{
  expect(owned).toContain("actual_entries IS DISTINCT FROM admitted_batch.before_entries");expect(owned).toContain("actual_revision IS DISTINCT FROM admitted_batch.parent_pg_revision");
  expect(owned).toContain("actual_bank.immutable_bank_fingerprint IS DISTINCT FROM NEW.immutable_bank_revision");expect(owned).toContain("actual_bank.bank_fingerprint IS DISTINCT FROM NEW.namespace_revision");
  expect(owned).toContain("IF total_count>5000");expect(owned).not.toContain("admitted_source_history_digest=NEW.parent_pg_revision");expect(owned).not.toContain("current_setting(");
 });
 it("registers all three as private/noTTL and exports only exact-owned safe columns with one combined bound",()=>{
  for(const table of ["controlled_cash_application_batches","controlled_cash_application_receipts","controlled_cash_application_links"]){expect(read("src/core/search/registry.ts")).toContain(`${table}:`);expect(read("src/core/retention/registry.ts")).toContain(`${table}:`);}
  const helper=read("src/modules/invoicing/controlled-cash-application-witnesses.ts");expect(helper).toContain("if(input.profileId)refuse()");expect(helper).toContain("resource_row.subscription_id=batch_row.subscription_id");
  expect(helper).toContain("existing+batches.length+receipts.length+links.length>5000");expect(helper).toContain("options.merchant?sql");expect(helper).not.toContain("select batch_row.* from controlled_cash_application_batches batch_row where batch_row.id in");
 });
});
