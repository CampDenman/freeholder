// Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0
// PREPARED/UNRUN source preservation; not business/provider acceptance.
import {createHash} from "node:crypto";
import {readFileSync} from "node:fs";
import {describe,expect,it} from "vitest";
import manifest from "../../deploy/original-cash-inventory-causal84.manifest.json";
import keyExtraction from "../../deploy/original-cash-key-extraction-root-source-20261114.json";
import originalFeeContinuation from "../../deploy/atomic-credit-original-fee-root-continuation-20261114.json";
const read=(path:string)=>readFileSync(new URL(`../../${path}`,import.meta.url)),hash=(body:Uint8Array|string)=>createHash("sha256").update(body).digest("hex");
describe("original inventory v2 bounded source preservation",()=>{
 it("preserves the complete old RF and parent readers before additive comparison companions",()=>{for(const row of manifest.unchangedPrefixes)expect(hash(read(row.path).subarray(0,row.bytes))).toBe(row.sha256);});
 it("preserves old HMAC/schema/raw classification/safe export and whole natives through only the exact auxiliary schema additions",()=>{
  for(const row of manifest.unchanged){let source=read(row.path).toString();
   if(row.path==="src/modules/invoicing/controlled-canonical-bank-principal.ts"){
    const exact=originalFeeContinuation.files.find(file=>file.path===row.path);
    expect(exact).toBeDefined();if(!exact)throw Error("Require the one exact reviewed original-fee source continuation.");
    expect(hash(source)).toBe(exact.afterSha256);
    for(const delta of [...exact.finiteDelta].reverse()){
     expect(source.split(delta.after)).toHaveLength(2);source=source.replace(delta.after,()=>delta.before);
    }
    expect(hash(source)).toBe(exact.beforeSha256);
   }
   if(row.path===keyExtraction.storePath){
    expect(hash(source)).toBe(keyExtraction.storeAfterSha256);
    expect(read(keyExtraction.leafPath).toString()).toContain(keyExtraction.exactFunctionBlock);
    expect(hash(keyExtraction.exactFunctionBlock)).toBe(keyExtraction.functionBlockSha256);
    for(const delta of [...keyExtraction.finiteDelta].reverse()){
     expect(source.split(delta.after)).toHaveLength(2);source=source.replace(delta.after,()=>delta.before);
    }
    expect(hash(source)).toBe(keyExtraction.storeBeforeSha256);
   }
   if(row.path==="src/modules/invoicing/original-cash-recovery-schema.ts")for(const insertion of [", \"atomic_fee_target\", \"atomic_fee_closure\"", ",'atomic_fee_target','atomic_fee_closure'", "  uniqueIndex(\"original_cash_atomic_fee_target\").on(t.recoveryId, sql`(${t.evidence}->>'targetKey')`).where(sql`${t.kind}='atomic_fee_target'`),\n", "  uniqueIndex(\"original_cash_atomic_fee_closure\").on(t.recoveryId, sql`(${t.evidence}->>'targetFactId')`, sql`(${t.evidence}->>'revision')`).where(sql`${t.kind}='atomic_fee_closure'`),\n"]){
    expect(source.split(insertion)).toHaveLength(2);source=source.replace(insertion,"");
   }
   expect(hash(source)).toBe(row.sha256);
  }
 });
 it("retains each exact original default inventory/digest expression",()=>{for(const row of [...manifest.protectedDefaultDigestExpressions,...manifest.protectedLegacyBlocks]){expect(hash(row.literal)).toBe(row.sha256);expect(read(row.path).toString()).toContain(row.literal);}});
 it("keeps full caller/current evidence separate from inspection and closure-only historical comparisons",()=>{const history=read("src/modules/invoicing/merchant-refund-history.ts").toString(),current=read("src/modules/invoicing/original-cash-inventory-causal.ts").toString(),closure=read("src/modules/invoicing/original-cash-closure-current.ts").toString();expect(history).toContain("readControlledOriginalCallers(ctx,graph,subscriptionIds)");expect(history).toContain('context?.kind==="inspection"?context.operation.id:undefined');expect(current).toContain("revision:fullCurrentRevision");expect(current).toContain("originalInventoryPreimagesEqual(full.preimageEntries,after.preimageEntries)");expect(closure).toContain("causalRevision!==own.closure.revision");expect(closure).not.toContain("own.comparison.sourceRevision");expect(closure).not.toContain("currentOriginalCashInventoryCausal(");});
 it("requires genuinely returned last FIN and excludes private v2 request bodies from the safe archive",()=>{const proof=read("src/modules/invoicing/original-cash-inventory-causal-proof.ts").toString(),archive=read("src/modules/invoicing/original-cash-invoice-history.ts").toString();expect(proof).toContain('finishes.length !== 1');expect(proof).toContain('last.evidence.outcome !== "returned"');expect(proof).toContain('last.id !== finishes[0]?.id');expect(proof).toContain("originalCashRecoveryFinancialWitness(tx, paymentIds, receiptIds, context.operation.id)");expect(archive).not.toContain("inventoryComparison");expect(archive).not.toContain("row.request");expect(archive).not.toContain("row.authentication");});
 it("takes the real v2 complete entry prefix before bound or money claims and never late-locks from the comparison reader",()=>{const prefix=read("src/modules/invoicing/original-cash-inventory-prefix.ts").toString(),service=read("src/modules/invoicing/original-cash-recovery-service.ts").toString(),current=read("src/modules/invoicing/original-cash-inventory-causal.ts").toString();expect(prefix).toContain('if(operation.request.inventoryComparison===undefined)return null');expect(prefix.indexOf("await lockContactIdentityForRead(ctx.tx)")).toBeLessThan(prefix.indexOf('for(const id of ids("resource"))'));expect(prefix.indexOf('for(const id of ids("resource"))')).toBeLessThan(prefix.indexOf('for(const id of ids("subscription"))'));expect(prefix).toContain("pg_try_advisory_xact_lock");expect(prefix).toContain("merchantTaxDigest(await discoverOriginalInventoryPrefix(ctx.tx,input))!==merchantTaxDigest(before)");expect(prefix).not.toContain("where s.contact_id in");expect(service).toContain("await lockOriginalInventoryPrefix(ctx,{recoveryId,operationId});");expect(current).not.toContain("lockOriginalInventoryPrefix(");expect(current).not.toContain("pg_advisory_xact_lock");});

 it("requires one genuinely new server v2 declaration to trigger a real extra GET without changing v1 sequence",()=>{const target=read("src/modules/invoicing/original-cash-partial-service.ts").toString(),flow=read("src/modules/invoicing/original-cash-partial.ts").toString();expect(target).toContain('requiresFreshInventory: z.literal(true).optional()');expect(target).toContain('if (existing) return { targetFactId: existing.id }');expect(target).toContain('...(v2?{requiresFreshInventory:true as const}:{})');expect(flow).toContain('if(requiresFreshInventory)operationId=await inspectOriginalCashInventory(recoveryId,actor)');});
 it("does not clear old principal debt or use fee/partial closure facts as a whole-return grant",()=>{const source=read("src/modules/invoicing/original-cash-principal.ts").toString();expect(source).toContain('payment.refundedMinor!==payment.amountMinor');expect(source).toContain('currentClosures.length!==1');expect(source).toContain('malformed=true;continue');expect(source).toContain('protocol:"freeholder.original-cash-whole-closure-principal.v2"');expect(source).not.toContain('reviewRequired=false');expect(source).not.toContain('fact.kind==="atomic_fee_closure"');expect(source).toContain('currentBankPrincipalMatches(');expect(source).toContain('merchantTaxDigest(currentControlled) !== merchantTaxDigest(controlled)');});

 it("projects only the exact partial closure fact and separates full current source from accepted original economics",()=>{const proof=read("src/modules/invoicing/original-cash-inventory-causal-proof.ts").toString(),current=read("src/modules/invoicing/original-cash-partial-closure-current.ts").toString(),source=read("src/modules/invoicing/original-cash-partial-source-v2.ts").toString();expect(proof).toContain('kind:"partial_closure"');expect(proof).toContain('table:"original_cash_recovery_facts",id:closure.id');expect(current).toContain('closurePreInsertRevision!==own.closureEvidence.revision');expect(current).toContain('suppliesWholeReturnAuthority:false');expect(current).toContain('suppliesPrincipalAuthority:false');expect(current).toContain('currentSource.currentSourceRevision!==sourceSnapshot.currentSourceRevision');expect(source).toContain('const{atomicRefundRevision,...acceptedPolicy}=source.invoiceFeePolicy');expect(source).toContain('source:{...physicalSource,invoiceFeePolicy:acceptedPolicy},atomicFeeEpoch:targets');expect(source).toContain('targets.unassignedDutyMinor!==atomic.unassignedDutyMinor');});

});
