// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.38: reconstruct one signed historical preimage; keep FULL current proof.
import type { ServiceContext } from "@/core/service";
import { merchantTaxDigest } from "./merchant-tax-store";
import { boundOriginalCashRecovery } from "./original-cash-recovery-current";
import { merchantRefundCashHistoryForOriginalInventory } from "./merchant-refund-history";
import { readOriginalInventoryCausalContext, originalInventoryCausalRefusal } from "./original-cash-inventory-causal-proof";
import { originalInventoryPreimagesEqual } from "./original-cash-inventory-preimage";
import { ORIGINAL_INVENTORY_CAUSAL_PROTOCOL } from "./original-cash-inventory-causal-contract";
export async function currentOriginalCashInventoryCausal(ctx:ServiceContext,recoveryId:string,operationId:string){
  const {cash}=await boundOriginalCashRecovery(ctx,recoveryId);
  const own=await readOriginalInventoryCausalContext(ctx.tx,recoveryId,operationId);
  // FULL current graph, callers and budget are checked independently FIRST.
  // No caller or raw money occurrence is removed from these current results.
  const full=await merchantRefundCashHistoryForOriginalInventory(ctx,cash);
  if(full.history.incomplete||!full.history.creatorsQuiesced||full.preimageEntries.length>5000)originalInventoryCausalRefusal();
  const fullCurrentRevision=merchantTaxDigest({cash,history:full.history.digest});
  for(const row of own.entries){
    if(!full.preimageEntries.some(entry=>entry.table===row.table&&entry.id===row.id))originalInventoryCausalRefusal();
  }
  const causal=await merchantRefundCashHistoryForOriginalInventory(ctx,cash,own);
  const causalRevision=merchantTaxDigest({cash,history:causal.history.digest});
  if(causal.history.incomplete||!originalInventoryPreimagesEqual(own.comparison.preimageEntries,causal.preimageEntries)
    ||merchantTaxDigest(own.comparison.controlledResolutionPreimages)!==merchantTaxDigest(causal.controlledResolutionPreimages)
    ||causal.history.digest!==own.comparison.sourceHistoryDigest||causalRevision!==own.comparison.sourceRevision)originalInventoryCausalRefusal();
  const after=await merchantRefundCashHistoryForOriginalInventory(ctx,cash);
  if(after.history.incomplete||!after.history.creatorsQuiesced||after.history.digest!==full.history.digest
    ||!originalInventoryPreimagesEqual(full.preimageEntries,after.preimageEntries)
    ||merchantTaxDigest(full.controlledResolutionPreimages)!==merchantTaxDigest(after.controlledResolutionPreimages))originalInventoryCausalRefusal();
  return{protocol:ORIGINAL_INVENTORY_CAUSAL_PROTOCOL,recoveryId,operationId,cash,history:full.history,revision:fullCurrentRevision,fullCurrentRevision,causalRevision,
    fullPhysicalCount:full.preimageEntries.length,ownEvidenceEntries:own.entries,ownEvidenceDigest:merchantTaxDigest(own.entries)};
}
