// Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0
// PREPARED/UNRUN. Finite source-preservation controls, not live qualification.
import {createHash} from "node:crypto";
import {readFileSync} from "node:fs";
import {resolve} from "node:path";
import {describe,expect,it} from "vitest";
const read=(path:string)=>readFileSync(resolve(process.cwd(),path),"utf8"),sha=(body:string)=>createHash("sha256").update(body).digest("hex");
const tail=read("deploy/atomic-credit-fee-partition84.fragment.sql");
const successors=JSON.parse(read("deploy/atomic-credit-fee-successors84.wip.json")) as {functions:Array<{signature:string;beforeStatement:string;afterStatement:string;beforeBodySha256:string;afterBodySha256:string;changes:Array<{before:string;after:string}>}>};
const ready=JSON.parse(read("deploy/atomic-credit-fee-readiness84.source.json")) as {sourceDependencies:Array<{signature:string;bodySha256:string}>;checks:Array<{table:string;name:string;pgGetExpr:string}>;foreignKeys:Array<{table:string;name:string}>;newTriggers:Array<{name:string;table:string;function:string;tgtype:number;deferrable:boolean;initiallyDeferred:boolean}>};
function body(statement:string){const start=statement.indexOf("AS $$"),end=statement.lastIndexOf("$$;");if(start<0||end<=start)throw Error("A complete original dollar-quoted function body is required.");return statement.slice(start+5,end);}
describe("finite B original bodies and mandatory actual purpose birth",()=>{
 it("recovers every complete original business function by reversing only the approved literal edits",()=>{
  expect(successors.functions.map(row=>row.signature).sort()).toEqual(["freeholder_credit_fee_receipt()","freeholder_credit_fee_is_collected(uuid,text)","freeholder_guard_invoice_credit()","freeholder_subscription_proration_receipt()"].sort());
  for(const row of successors.functions){let rewound=row.afterStatement;for(const delta of [...row.changes].reverse()){expect(rewound.split(delta.after)).toHaveLength(2);rewound=rewound.replace(delta.after,()=>delta.before);}expect(rewound).toBe(row.beforeStatement);expect(sha(body(rewound))).toBe(row.beforeBodySha256);expect(sha(body(row.afterStatement))).toBe(row.afterBodySha256);expect(tail).toContain(row.afterStatement);}
 });
 it("requires the genuine actual purpose child even when the original scalar happens to coincide",()=>{
  expect(tail).toContain("IF is_declared OR requires_atomic THEN RAISE EXCEPTION");expect(tail).toContain("IF funding_purpose.funding_id IS NOT NULL OR is_declared THEN RAISE EXCEPTION");
  expect(tail).toContain("parent_xid IS DISTINCT FROM mod(pg_current_xact_id()::text::numeric,4294967296)::text");expect(tail).toContain("NEW.parent_fingerprint IS DISTINCT FROM encode(sha256(convert_to(to_jsonb(actual_parent)::text,'UTF8')),'hex')");
  expect(tail).not.toContain("current_setting('freeholder.allow");expect(tail).not.toContain("variable_conflict");expect(tail).not.toContain("check_function_bodies");
 });
 it("declares all four actual guards and pins their exact enabled/deferrable identities",()=>{
  expect(ready.newTriggers).toHaveLength(4);for(const trigger of ready.newTriggers){const declaration=trigger.deferrable?`CREATE CONSTRAINT TRIGGER ${trigger.name} AFTER INSERT ON ${trigger.table} DEFERRABLE INITIALLY DEFERRED`:`CREATE TRIGGER ${trigger.name} BEFORE INSERT OR UPDATE OR DELETE ON ${trigger.table}`;expect(tail).toContain(declaration);expect(tail).toContain(`actual_trigger.tgname='${trigger.name}'`);expect(tail).toContain(`actual_trigger.tgfoid=to_regprocedure('${trigger.function}')`);expect(tail).toContain(`actual_trigger.tgtype=${trigger.tgtype}`);}expect(tail).toContain("actual_trigger.tgenabled IN('O','A')");expect(tail).toContain("actual_trigger.tgqual IS NULL");
 });
 it("pins all complete actual source bodies, all fourteen FKs and eight exact CHECK expressions without a deparser exemption",()=>{
  expect(ready.foreignKeys).toHaveLength(14);expect(ready.checks).toHaveLength(8);
  for(const dependency of ready.sourceDependencies){expect(dependency.bodySha256).toMatch(/^[a-f0-9]{64}$/);expect(tail).toContain(`to_regprocedure('${dependency.signature}')`);expect(tail).toContain(`'${dependency.bodySha256}'`);}
  for(const check of ready.checks){expect(tail).toContain(`actual_check.conname='${check.name}'`);expect(tail).toContain(check.pgGetExpr.replaceAll("'","''"));}expect(tail).toContain("actual_fk.confdeltype='r'");expect(tail).toContain("actual_index.indimmediate");expect(tail).toContain("actual_index.indcollation::text");
 });
 it("retains full current bank/namespace and exact private owner deltas rather than a transaction-wide exclusion",()=>{
  expect(tail).toContain("purpose.economics->>'postgresSourceRevision'");expect(tail).toContain("physical_count NOT BETWEEN 1 AND 5000");expect(tail).toContain("beforeProrationProjections");expect(tail).toContain("beforeSubscriptionProjections");
  expect(tail).toContain("source_capacity.bank_namespace_revision IS DISTINCT FROM purpose.economics->>'bankNamespaceRevision'");expect(tail).toContain("actual_quote.planned_collection_id");
  expect(tail).not.toMatch(/WHERE\s+NOT\s*\([^\n]*xmin/);expect(tail).not.toContain("set_config('freeholder.credit_allowed'");
 });
 it("wires both new physical families into actual shared parent/undo/export consumers and keeps signing keys acyclic",()=>{
  const adapter=read("src/modules/invoicing/controlled-provider-financial-witness.ts"),subscriptions=read("src/modules/subscriptions/service.ts");
  const witness=read("src/modules/invoicing/atomic-credit-fee-financial.ts");for(const name of ["invoice_credit_funding_atomic_fee_partitions","invoice_credit_reservation_atomic_fee_partitions"]){expect(witness).toContain(name);expect(subscriptions).toContain(name);}expect(adapter).toContain("atomicCreditFundings:atomicCreditFeeTables.fundings");expect(adapter).toContain("atomicCreditReservations:atomicCreditFeeTables.reservations");expect(adapter).toContain("atomicCreditFinancialWitness");expect(adapter).toContain("exportAtomicCreditFinancialHistory");expect(subscriptions).toContain("exportAtomicCreditFinancialHistory");
  const declaration=read("src/modules/invoicing/atomic-credit-fee-declaration-proof.ts");expect(declaration).toContain('from "./original-cash-evidence-keys"');expect(declaration).not.toContain("process.env");
 });
});
