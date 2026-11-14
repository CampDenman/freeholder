// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.38: authentic returned-own ancestry for historical comparison ONLY.
import { sql } from "drizzle-orm";
import { ServiceError, type Tx } from "@/core/service";
import { merchantTaxDigest } from "./merchant-tax-store";
import { originalInventoryComparison, originalInventoryPartialClosureEvidence, type OriginalInventoryComparison, type OriginalInventoryPartialClosureEvidence } from "./original-cash-inventory-causal-contract";
import { originalCashOperationFacts, originalCashRecoveryOperation, originalCashRecoveryOwner, originalCashRecoveryFinancialWitness } from "./original-cash-recovery-store";
import { cashNamespaceKey } from "./original-cash-recovery-proof";
import { merchantReturnedCashEvidenceSchema } from "./merchant-returned-cash-contract";
import { originalInventoryStatesAgree } from "./original-cash-inventory-causal-policy";
import {originalPartialTarget} from "./original-cash-partial-contract";
import type {z} from "zod";
const contexts = new WeakSet<object>();
export type OriginalInventoryCausalContext = Readonly<{
  kind: "inspection";
  comparison: OriginalInventoryComparison;
  operation: Awaited<ReturnType<typeof originalCashRecoveryOperation>>;
  facts: Awaited<ReturnType<typeof originalCashOperationFacts>>;
  owner: Awaited<ReturnType<typeof originalCashRecoveryOwner>>;
  entries: readonly { table: string; id: string; postgresFingerprint: string; dependencyFingerprint: string }[];
}>;
export type OriginalInventoryClosureComparisonContext = Readonly<{
  kind: "closure";
  closure: Awaited<ReturnType<typeof originalCashRecoveryFinancialWitness>>["closures"][number];
  operation: Awaited<ReturnType<typeof originalCashRecoveryOperation>>;
  facts: Awaited<ReturnType<typeof originalCashOperationFacts>>;
  owner: Awaited<ReturnType<typeof originalCashRecoveryOwner>>;
  entries: readonly { table: string; id: string; postgresFingerprint: string; dependencyFingerprint: string }[];
}>;
export type OriginalInventoryPartialClosureComparisonContext=Readonly<{
  kind:"partial_closure";
  closure:Awaited<ReturnType<typeof originalCashOperationFacts>>[number];
  closureEvidence:OriginalInventoryPartialClosureEvidence;
  target:z.infer<typeof originalPartialTarget>;
  targetFact:Awaited<ReturnType<typeof originalCashOperationFacts>>[number];
  operation:Awaited<ReturnType<typeof originalCashRecoveryOperation>>;
  facts:Awaited<ReturnType<typeof originalCashOperationFacts>>;
  owner:Awaited<ReturnType<typeof originalCashRecoveryOwner>>;
  entries:readonly{table:string;id:string;postgresFingerprint:string;dependencyFingerprint:string}[];
}>;
export type OriginalInventoryProjectionContext = OriginalInventoryCausalContext | OriginalInventoryClosureComparisonContext | OriginalInventoryPartialClosureComparisonContext;
export function originalInventoryCausalRefusal(): never { throw new ServiceError("conflict", "Retain the exact full current inventory. Only this genuinely returned, nonce-bound original read's authenticated own ancestry may reconstruct its signed historical preimage."); }
export function requireOriginalInventoryCausalContext(context: OriginalInventoryProjectionContext) {
  if (!contexts.has(context)) originalInventoryCausalRefusal();
}
export async function readOriginalInventoryCausalContext(tx: Tx, recoveryId: string, operationId: string): Promise<OriginalInventoryCausalContext> {
  const owner = await originalCashRecoveryOwner(tx, recoveryId), operation = await originalCashRecoveryOperation(tx, operationId);
  const parsed=originalInventoryComparison.safeParse(operation.request.inventoryComparison);
  if(!parsed.success)originalInventoryCausalRefusal();
  const comparison=parsed.data;
  if (operation.recoveryId !== recoveryId || operation.kind !== "inspection" || operation.request.auxiliaryOperationId
    || comparison.recoveryId !== recoveryId || comparison.operationId !== operation.id || comparison.callerId !== operation.caller.id
    || comparison.nonceHash !== operation.nonceHash || comparison.namespaceKey !== owner.namespaceKey || owner.namespaceKey !== cashNamespaceKey(owner.owner.cash)
    || comparison.sourceCashDigest !== merchantTaxDigest(owner.owner.cash) || comparison.sourceRevision !== operation.request.sourceRevision
    || comparison.sourceRevision !== merchantTaxDigest({ cash: owner.owner.cash, history: comparison.sourceHistoryDigest })) originalInventoryCausalRefusal();
  const facts = await originalCashOperationFacts(tx, operation.id), finishes = facts.filter(row => row.kind === "finish"), last = facts.at(-1);
  if (finishes.length !== 1 || !last || last.id !== finishes[0]?.id || last.evidence.outcome !== "returned" || last.evidence.callerInstanceId !== operation.caller.id
    || facts.some(row => row.recoveryId !== recoveryId || row.operationId !== operation.id || !["primary", "refund", "state", "finish"].includes(row.kind))
    || !facts.some(row => row.kind === "primary") || !facts.some(row => row.kind === "state")) originalInventoryCausalRefusal();
  const states=facts.filter(row=>row.kind==="state").map(row=>{const value=merchantReturnedCashEvidenceSchema.safeParse(row.evidence);if(!value.success)originalInventoryCausalRefusal();return value.data;});
  const bank=states.at(-1),cash=owner.owner.cash;
  if(!bank||!originalInventoryStatesAgree(states,bank))originalInventoryCausalRefusal();
  if (!bank.refundsComplete || !bank.disputesComplete || bank.providerPlatformAccountId !== cash.providerPlatformAccountId || bank.chargeAccountId !== cash.chargeAccountId
    || bank.providerApiVersion !== cash.providerApiVersion || bank.paymentProviderRef !== cash.providerRef || bank.amountMinor !== cash.amountMinor || bank.currency !== cash.currency) originalInventoryCausalRefusal();
  for(const fact of facts.filter(row=>row.kind==="primary")){
    const primary=fact.evidence;
    if(primary.providerRef!==cash.providerRef||primary.status!=="succeeded"||primary.amountMinor!==cash.amountMinor||primary.currency!==cash.currency
      ||primary.providerPlatformAccountId!==cash.providerPlatformAccountId||(primary.providerAccountId??null)!==cash.chargeAccountId
      ||primary.providerApiVersion!==cash.providerApiVersion||primary.providerChargeRef!==bank.providerChargeRef)originalInventoryCausalRefusal();
  }
  for(const fact of facts.filter(row=>row.kind==="refund")){
    const refund=fact.evidence;
    if(refund.providerPlatformAccountId!==cash.providerPlatformAccountId||(refund.providerAccountId??null)!==cash.chargeAccountId
      ||refund.providerApiVersion!==cash.providerApiVersion||refund.paymentProviderRef!==cash.providerRef||refund.providerChargeRef!==bank.providerChargeRef
      ||!bank.refunds.some(row=>row.providerRef===refund.providerRef&&row.paymentProviderRef===refund.paymentProviderRef&&row.chargeRef===refund.providerChargeRef
        &&row.amountMinor===refund.amountMinor&&row.currency===refund.currency&&row.status===(refund.providerStatus??refund.status)))originalInventoryCausalRefusal();
  }
  const rows = await tx.execute<{ table: string; id: string; fingerprint: string }>(sql`
    select 'original_cash_recovery_operations'::text as table, r.id::text as id, encode(sha256(convert_to(to_jsonb(r)::text,'UTF8')),'hex') as fingerprint from original_cash_recovery_operations r where r.id=${operation.id}::uuid
    union all select 'original_cash_recovery_facts', r.id::text, encode(sha256(convert_to(to_jsonb(r)::text,'UTF8')),'hex') from original_cash_recovery_facts r where r.operation_id=${operation.id}::uuid
    order by 1,2 limit 5001`);
  if (rows.length !== facts.length + 1 || rows.length > 5000) originalInventoryCausalRefusal();
  const canonical = new Map<string,string>(); canonical.set(`original_cash_recovery_operations:${operation.id}`,merchantTaxDigest(operation));
  for(const row of facts)canonical.set(`original_cash_recovery_facts:${row.id}`,merchantTaxDigest(row));
  const entries = rows.map(row => {
    const key = `${row.table}:${row.id}`, dependencyFingerprint = canonical.get(key);
    if (!dependencyFingerprint || comparison.preimageEntries.some(entry => entry.table === row.table && entry.id === row.id)) originalInventoryCausalRefusal();
    return { table: row.table, id: row.id, postgresFingerprint: row.fingerprint, dependencyFingerprint };
  });
  // Admission signature binds the exact genuine caller/nonce and complete
  // preimage; no later read, hosting stop or arbitrary supplied UUID is enough.
  const context = Object.freeze({ kind: "inspection" as const, comparison, owner, operation, facts, entries }); contexts.add(context); return context;
}
/** Rebuild feedback namespaces with the EXISTING exact exclude-operation
 * selector. No actual raw feedback occurrence may disappear or be adopted. */
export async function originalInventoryCausalFeedback(tx: Tx, paymentIds: readonly string[], receiptIds: readonly string[], context: OriginalInventoryProjectionContext) {
  requireOriginalInventoryCausalContext(context);
  const full = await originalCashRecoveryFinancialWitness(tx, paymentIds, receiptIds);
  if(context.kind!=="inspection")return{full,causal:full};
  const causal = await originalCashRecoveryFinancialWitness(tx, paymentIds, receiptIds, context.operation.id);
  const key = (row: typeof full.feedback[number]) => merchantTaxDigest({ ...row.namespace, originalResourceRefs: [], feedbackId: row.feedback.id });
  const actual = new Map(full.feedback.map(row => [key(row), row]));
  if (actual.size !== full.feedback.length || causal.feedback.length !== full.feedback.length) originalInventoryCausalRefusal();
  const ownRefs = new Set(context.facts.filter(row => row.kind === "refund").map(row => row.evidence.providerRef).filter((ref): ref is string => typeof ref === "string"));
  for (const row of causal.feedback) {
    const before = actual.get(key(row));
    if (!before || merchantTaxDigest(before.feedback) !== merchantTaxDigest(row.feedback)
      || row.namespace.originalResourceRefs.some(ref => !before.namespace.originalResourceRefs.includes(ref))
      || before.namespace.originalResourceRefs.some(ref => !row.namespace.originalResourceRefs.includes(ref) && !ownRefs.has(ref))) originalInventoryCausalRefusal();
  }
  return { full, causal };
}

/** Closure comparison owns exactly ONE immutable closure row. It never owns
 * its GET/facts, never uses the GET historical projection and grants no money. */
export async function readOriginalInventoryClosureContext(tx:Tx,recoveryId:string,closureId:string):Promise<OriginalInventoryClosureComparisonContext>{
  const owner=await originalCashRecoveryOwner(tx,recoveryId);
  const witness=await originalCashRecoveryFinancialWitness(tx,owner.paymentId?[owner.paymentId]:[],owner.subscriptionChargeReceiptId?[owner.subscriptionChargeReceiptId]:[]);
  const closure=witness.closures.find(row=>row.id===closureId&&row.recoveryId===recoveryId);
  if(!closure||witness.closures.filter(row=>row.operationId===closure.operationId).length!==1)originalInventoryCausalRefusal();
  const returned=await readOriginalInventoryCausalContext(tx,recoveryId,closure.operationId);
  const rows=await tx.execute<{fingerprint:string}>(sql`select encode(sha256(convert_to(to_jsonb(r)::text,'UTF8')),'hex') as fingerprint from original_cash_recovery_closures r where r.id=${closure.id}::uuid`);
  const row=rows[0];if(rows.length!==1||!row)originalInventoryCausalRefusal();
  const context:OriginalInventoryClosureComparisonContext=Object.freeze({kind:"closure",closure,owner,operation:returned.operation,facts:returned.facts,
    entries:[{table:"original_cash_recovery_closures",id:closure.id,postgresFingerprint:row.fingerprint,dependencyFingerprint:merchantTaxDigest(closure)}]});
  contexts.add(context);return context;
}

/** A partial closure owns exactly its ONE actual signed fact, not its target,
 * GET, raw packets, another closure or an entire durable fact kind. */
export async function readOriginalInventoryPartialClosureContext(tx:Tx,recoveryId:string,closureFactId:string):Promise<OriginalInventoryPartialClosureComparisonContext>{
  const owner=await originalCashRecoveryOwner(tx,recoveryId);
  if(!owner.paymentId||!owner.owner.cash.applied)originalInventoryCausalRefusal();
  const witness=await originalCashRecoveryFinancialWitness(tx,[owner.paymentId],[]),closure=witness.facts.find(row=>row.id===closureFactId&&row.recoveryId===recoveryId&&row.kind==="partial_closure"&&row.operationId===null);
  if(!closure)originalInventoryCausalRefusal();const parsed=originalInventoryPartialClosureEvidence.safeParse(closure.evidence);if(!parsed.success)originalInventoryCausalRefusal();const closureEvidence=parsed.data;
  const targetFact=witness.facts.find(row=>row.id===closureEvidence.targetFactId&&row.recoveryId===recoveryId&&row.kind==="partial_target"&&row.operationId===null);
  if(!targetFact)originalInventoryCausalRefusal();const parsedTarget=originalPartialTarget.safeParse(targetFact.evidence);if(!parsedTarget.success)originalInventoryCausalRefusal();const target=parsedTarget.data;
  if(target.paymentId!==owner.paymentId||target.targetKey!==closureEvidence.targetKey||target.sourceDigest!==closureEvidence.sourceDigest
    ||target.customerReturnedMinor!==closureEvidence.customerReturnedMinor||target.feeTargetMinor!==closureEvidence.feeTargetMinor||target.recipientTargetMinor!==closureEvidence.recipientTargetMinor)originalInventoryCausalRefusal();
  const returned=await readOriginalInventoryCausalContext(tx,recoveryId,closureEvidence.originalInventoryOperationId);
  // The retained declaration itself was based on an authentic real returned
  // original read too; no current/historical snapshot is synthesized for it.
  const declaration=await originalCashRecoveryOperation(tx,target.originalInventoryOperationId),declarationFacts=await originalCashOperationFacts(tx,declaration.id),declarationFinish=declarationFacts.at(-1);
  if(declaration.recoveryId!==recoveryId||declaration.kind!=="inspection"||declaration.request.auxiliaryOperationId
    ||declarationFacts.filter(row=>row.kind==="finish").length!==1||declarationFacts.some(row=>row.recoveryId!==recoveryId||row.operationId!==declaration.id||!["primary","refund","state","finish"].includes(row.kind))
    ||declarationFinish?.kind!=="finish"||declarationFinish.evidence.outcome!=="returned"||declarationFinish.evidence.callerInstanceId!==declaration.caller.id)originalInventoryCausalRefusal();
  const declarationStates=declarationFacts.filter(row=>row.kind==="state").map(row=>{const actual=merchantReturnedCashEvidenceSchema.safeParse(row.evidence);if(!actual.success)originalInventoryCausalRefusal();return actual.data;}),declarationBank=declarationStates.at(-1);
  if(!declarationBank||!originalInventoryStatesAgree(declarationStates,declarationBank)||declarationBank.paymentProviderRef!==owner.owner.cash.providerRef
    ||declarationBank.providerPlatformAccountId!==owner.owner.cash.providerPlatformAccountId||declarationBank.chargeAccountId!==owner.owner.cash.chargeAccountId||declarationBank.providerApiVersion!==owner.owner.cash.providerApiVersion
    ||declarationBank.amountMinor!==owner.owner.cash.amountMinor||declarationBank.currency!==owner.owner.cash.currency)originalInventoryCausalRefusal();
  // Genuine historical v1 declarations stay v1: no preimage is invented or
  // re-signed. A known v2 declaration additionally authenticates its header.
  if(declaration.request.inventoryComparison!==undefined)await readOriginalInventoryCausalContext(tx,recoveryId,declaration.id);
  const rows=await tx.execute<{fingerprint:string}>(sql`select encode(sha256(convert_to(to_jsonb(r)::text,'UTF8')),'hex') as fingerprint from original_cash_recovery_facts r where r.id=${closure.id}::uuid`);
  const row=rows[0];if(rows.length!==1||!row)originalInventoryCausalRefusal();
  const context:OriginalInventoryPartialClosureComparisonContext=Object.freeze({kind:"partial_closure",closure,closureEvidence,target,targetFact,owner,operation:returned.operation,facts:returned.facts,
    entries:[{table:"original_cash_recovery_facts",id:closure.id,postgresFingerprint:row.fingerprint,dependencyFingerprint:merchantTaxDigest(closure)}]});
  contexts.add(context);return context;
}

/** Recheck the ACTUAL full PostgreSQL row in its separate hash domain before
 * any companion projects a key. Canonical RF equality is checked separately. */
export async function assertOriginalInventoryOwnRowsCurrent(tx:Tx,context:OriginalInventoryProjectionContext){
 requireOriginalInventoryCausalContext(context);
 const allowed=new Set(["original_cash_recovery_operations","original_cash_recovery_facts","original_cash_recovery_closures"]);
 if(context.entries.length>5000||context.entries.some(row=>!allowed.has(row.table)))originalInventoryCausalRefusal();
 for(const table of [...new Set(context.entries.map(row=>row.table))]){
  const entries=context.entries.filter(row=>row.table===table),ids=sql.join(entries.map(row=>sql`${row.id}::uuid`),sql`, `);
  const rows=await tx.execute<{id:string;fingerprint:string}>(sql`select r.id::text as id,encode(sha256(convert_to(to_jsonb(r)::text,'UTF8')),'hex') as fingerprint from ${sql.identifier(table)} r where r.id in(${ids}) order by r.id limit 5001`);
  if(rows.length!==entries.length||rows.some(row=>!entries.some(entry=>entry.id===row.id&&entry.postgresFingerprint===row.fingerprint)))originalInventoryCausalRefusal();
 }
}
