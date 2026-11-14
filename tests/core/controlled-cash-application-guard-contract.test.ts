// Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0
// PREPARED/UNRUN declaration fence, NOT PostgreSQL or money qualification.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe,expect,it } from "vitest";
const text=readFileSync(new URL("../../deploy/subscription-controlled-cash-application82.fragment.sql",import.meta.url),"utf8");
describe("unapplied controlled application guard security boundary",()=>{
 it("adds only its independent functions and guards without replacing or disabling any existing authority",()=>{
  expect([...text.matchAll(/CREATE FUNCTION (\w+)/g)].map(match=>match[1])).toEqual(["freeholder_controlled_cash_application_shape","freeholder_controlled_cash_application_guard"]);
  expect(text).not.toMatch(/CREATE OR REPLACE|DROP (?:FUNCTION|TRIGGER|CONSTRAINT)|DISABLE TRIGGER|SET session_replication_role/i);
 });
 it("cannot mistake structural membership, a marker or an allowed flag for the missing actual bank/parent producer",()=>{
  const shape=text.slice(text.indexOf("CREATE FUNCTION freeholder_controlled_cash_application_shape"),text.indexOf("CREATE FUNCTION freeholder_controlled_cash_application_guard"));
  expect(shape).toContain("REQUIRED dependency");expect(shape).not.toMatch(/RETURN\s+true\b/i);
  expect(shape).not.toMatch(/current_setting|set_config|EXECUTE/i);
  expect(shape.trim()).toMatch(/RETURN false;\s*END \$\$;\s*--> statement-breakpoint$/);
 });
 it("defers all three actual canonical boundaries so the final same-transaction receipt/payment state is checked",()=>{
  const declarations=[...text.matchAll(/CREATE CONSTRAINT TRIGGER (\w+) AFTER INSERT OR UPDATE ON (\w+) DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION freeholder_controlled_cash_application_guard\(\);/g)];
  expect(declarations.map(match=>[match[1],match[2]])).toEqual([
   ["subscription_controlled_cash_payment_complete","payments"],["subscription_controlled_cash_route_complete","merchant_agreement_payment_routes"],["subscription_controlled_cash_invoice_complete","invoices"],
  ]);
  expect(text).toContain("freeholder_controlled_cash_application_shape(target_payment_uuid) IS DISTINCT FROM true");
  expect(text).toContain("freeholder_controlled_cash_application_shape(candidate.id) IS DISTINCT FROM true");
 });
 it("retains all three exact alias-corrected old financial fragments byte-for-byte",()=>{
  for(const[file,sha]of[
   ["subscription-commercial-attestation80.fragment.sql","5649de7281153981fb85546374970817b1ebd4fed879b0383b986b687c5968c2"],
   ["subscription-agreement-fee80.fragment.sql","629960b834f9aef9daff35aa11db2782c31cba2e1efa0240be4e09ca222eae68"],
   ["subscription-gross-proration80.fragment.sql","0a39e21367e9c5184260e39b5fa4c9ef9fcbcbcf90071ae7413545c62c5bbeb0"],
  ])expect(createHash("sha256").update(readFileSync(new URL(`../../deploy/${file}`,import.meta.url))).digest("hex")).toBe(sha);
 });
});
